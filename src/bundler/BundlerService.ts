import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type * as esbuildApi from 'esbuild';
import type { BuildContext, BuildOptions, Message, Metafile } from 'esbuild';
import { EMPTY_PROJECT_CONFIG, type ProjectConfig } from '../project/config';
import {
  createAppBuildOptions,
  createVendorBuildOptions,
  type ExtensionPaths,
} from './buildOptions';
import { createFlowStripMemory, type StripFlow } from './plugins/flowStrip';
import type { VendorRef } from './plugins/externalize';
import { mockRegistryPlugin, type MockUse } from './plugins/mockRegistry';
import type { ProjectSourceOptions } from './plugins/projectSource';
import type { ModuleRecord } from './refresh/hotPlan';
import { resolveRuntimeDeps, type RuntimeDeps } from './runtimeDeps';
import {
  bundleKeyId,
  type BuildMessage,
  type BundleKey,
  type BundleResult,
  type MockedPackage,
  type PreviewTarget,
} from './types';

type Esbuild = Pick<typeof esbuildApi, 'context' | 'transform'>;
type Context = BuildContext<BuildOptions & { write: false }>;

export interface BundlerServiceOptions extends ExtensionPaths {
  /** Loads esbuild lazily on first build; injectable for tests. */
  loadEsbuild?: () => Promise<Esbuild>;
  /** Loads the Flow type stripper lazily, the first time a Flow file is seen. */
  loadStripper?: () => Promise<StripFlow>;
  resolveDeps?: (projectRoot: string, vendorDir: string) => Promise<RuntimeDeps>;
  /** Project configuration (aliases, rnlens.config.js, …); none when omitted. */
  resolveProjectConfig?: (projectRoot: string) => Promise<ProjectConfig>;
  /** Contents of open, unsaved documents (`onType` mode); undefined to read from disk. */
  readUnsaved?: (file: string) => string | undefined;
  onDepsWarning?: (message: string) => void;
  onProjectNote?: (message: string) => void;
}

interface VendorBuild {
  version: string;
  code: string;
  css: string;
  /** How many vendor keys it was built with (keys only ever grow). */
  keyCount: number;
  moduleCount: number;
  mocksUsed: MockUse[];
}

interface Entry {
  /** Target of the build in progress (variants may change between builds). */
  current: { target: PreviewTarget };
  app: Promise<Context>;
  vendor: Promise<Context> | undefined;
  vendorKeys: Map<string, VendorRef>;
  vendorBuild: VendorBuild | undefined;
  appMocksUsed: () => MockUse[];
  vendorMocksUsed: () => MockUse[];
  /** Bare imports that failed to resolve in an earlier build; auto-mocked from then on. */
  unresolved: Set<string>;
  transformCache: ProjectSourceOptions['cache'];
  /** Filled in while an app build runs. */
  building: { modules: Map<string, ModuleRecord>; entrySource: string | undefined } | undefined;
  /** Contexts emitting source maps, created on the first runtime error that needs one. */
  appMap: Promise<Context> | undefined;
  vendorMap: Promise<Context> | undefined;
  /** Builds waiting for the one in progress, one per target (variants share an entry). */
  queued: Map<string, Promise<BundleResult>>;
  /** The most recently scheduled build; builds run one after another. */
  tail: Promise<BundleResult> | undefined;
}

export interface MappedBundle {
  map: string;
  fingerprint: string;
}

/** Owner of builds requested without one (single-consumer callers and tests). */
const DEFAULT_OWNER = {};

/** How many times a build may be retried after auto-mocking newly found missing packages. */
const MAX_MISSING_PACKAGE_RETRIES = 3;

function toBuildMessage(m: Message, root: string): BuildMessage {
  const loc = m.location;
  const message: BuildMessage = { text: m.text };
  if (loc) {
    message.file = path.resolve(root, loc.file);
    message.line = loc.line;
    message.column = loc.column;
    message.lineText = loc.lineText;
  }
  return message;
}

function isEsbuildFailure(err: unknown): err is { errors: Message[]; warnings: Message[] } {
  return !!err && typeof err === 'object' && Array.isArray((err as { errors?: unknown }).errors);
}

/**
 * Bare package specifiers from esbuild "Could not resolve" errors, or undefined if any error is
 * something else (a syntax error, a missing relative file) that mocking can't fix.
 */
export function missingPackages(errors: readonly Message[]): string[] | undefined {
  const names: string[] = [];
  for (const e of errors) {
    const m = /^Could not resolve "([^"]+)"/.exec(e.text);
    const spec = m?.[1];
    if (!spec || spec.startsWith('.') || path.isAbsolute(spec) || spec.startsWith('rnlens:')) {
      return undefined;
    }
    if (!names.includes(spec)) names.push(spec);
  }
  return names.length > 0 ? names : undefined;
}

/**
 * Identifies generated code independently of whether it carries a source map comment, so a map
 * built later can be checked against the bundle actually running in the preview.
 */
export function bundleFingerprint(code: string): string {
  const withoutMapComment = code.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, '\n');
  return createHash('sha1').update(withoutMapComment).digest('hex');
}

/** Real modules in a build (esbuild also lists `define` values as inputs). */
function countModules(metafile: Metafile | undefined): number {
  return Object.keys(metafile?.inputs ?? {}).filter((i) => !i.startsWith('<define:')).length;
}

/** Reverse import graph of an app build's metafile: module → modules importing it (absolute). */
export function importersFrom(metafile: Metafile, projectRoot: string): Map<string, string[]> {
  const toId = (p: string): string =>
    /^[a-z-]+:/i.test(p) && !/^[a-z]:[\\/]/i.test(p) ? p : path.resolve(projectRoot, p);
  const importers = new Map<string, string[]>();
  for (const [input, info] of Object.entries(metafile.inputs)) {
    for (const imp of info.imports) {
      if (imp.external) continue;
      const target = toId(imp.path);
      importers.set(target, [...(importers.get(target) ?? []), toId(input)]);
    }
  }
  return importers;
}

function mergeMocks(...lists: MockUse[][]): MockedPackage[] {
  const merged = new Map<string, MockedPackage>();
  for (const list of lists) {
    for (const { specifier, source, note, importers } of list) {
      const existing = merged.get(specifier);
      if (existing) {
        existing.importers = [...new Set([...(existing.importers ?? []), ...importers])];
      } else {
        merged.set(specifier, { specifier, source, note, importers: [...importers] });
      }
    }
  }
  return [...merged.values()];
}

export const defaultLoadStripper = async (): Promise<StripFlow> => {
  const { default: flowRemoveTypes } = await import('flow-remove-types');
  return (source) => flowRemoveTypes(source, { all: true }).toString();
};

/**
 * Owns the esbuild contexts of each (project, target, platform): an app bundle (the project's own
 * code, rebuilt on every change and applied with React Fast Refresh) and a vendor bundle
 * (everything else, rebuilt only when the app starts using new modules). Rebuilds requested while
 * one is running are coalesced into a single follow-up build per target, so the newest contents
 * win. Entries are shared by every owner (preview panel) showing the same target.
 */
export class BundlerService {
  private readonly entries = new Map<string, Entry>();
  /** Who uses each entry; kept across `reset` so a restarted entry stays shared. */
  private readonly owners = new Map<string, Set<object>>();
  private readonly deps = new Map<string, Promise<RuntimeDeps>>();
  private readonly configs = new Map<string, Promise<ProjectConfig>>();
  private flowMemory = createFlowStripMemory();
  private esbuild: Promise<Esbuild> | undefined;

  constructor(private readonly options: BundlerServiceOptions) {}

  /** Live (project, target, platform) entries, each holding an app and a vendor context. */
  get contextCount(): number {
    return this.entries.size;
  }

  /**
   * Builds (or rebuilds) the bundles for `key` on behalf of `owner` (e.g. a preview panel; panels
   * showing the same target share contexts). Never rejects: failures are returned as results.
   */
  build(key: BundleKey, owner: object = DEFAULT_OWNER): Promise<BundleResult> {
    const id = bundleKeyId(key);
    let owners = this.owners.get(id);
    if (!owners) this.owners.set(id, (owners = new Set()));
    owners.add(owner);
    let entry = this.entries.get(id);
    if (!entry) {
      const created: Entry = {
        current: { target: key.target },
        app: Promise.reject(new Error('not started')),
        vendor: undefined,
        vendorKeys: new Map(),
        vendorBuild: undefined,
        appMocksUsed: () => [],
        vendorMocksUsed: () => [],
        unresolved: new Set(),
        transformCache: new Map(),
        building: undefined,
        appMap: undefined,
        vendorMap: undefined,
        queued: new Map(),
        tail: undefined,
      };
      created.app.catch(() => undefined);
      this.entries.set(id, created);
      this.startContexts(created, key, id);
      entry = created;
    }
    return this.schedule(entry, key);
  }

  /**
   * Rebuilds the current bundles with source maps (in separate, lazily created contexts, so normal
   * rebuilds skip map generation). Callers should compare each `fingerprint` with the running
   * bundle's before trusting a map.
   */
  async sourceMapsFor(key: BundleKey): Promise<{ app?: MappedBundle; vendor?: MappedBundle }> {
    const entry = this.entries.get(bundleKeyId(key));
    if (!entry) return {};
    entry.appMap ??= this.createAppContext(entry, key, true, new Map());
    entry.vendorMap ??= this.createVendorContext(entry, key, true);
    const [app, vendor] = await Promise.all([
      this.mapFrom(entry, 'appMap'),
      this.mapFrom(entry, 'vendorMap'),
    ]);
    return { app, vendor };
  }

  /** `owner` no longer needs `key`; its contexts are disposed once no owner needs them. */
  async release(key: BundleKey, owner: object = DEFAULT_OWNER): Promise<void> {
    const id = bundleKeyId(key);
    const owners = this.owners.get(id);
    owners?.delete(owner);
    if (owners && owners.size > 0) return;
    this.owners.delete(id);
    await this.reset(key);
  }

  /** Disposes the contexts for `key` (if any); the next build starts from scratch. */
  async reset(key: BundleKey): Promise<void> {
    const id = bundleKeyId(key);
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    await this.disposeEntry(entry);
  }

  /** Forgets cached dependency resolution and configuration for a project. */
  invalidateProject(projectRoot: string): void {
    this.deps.delete(projectRoot);
    this.configs.delete(projectRoot);
  }

  /** Disposes every context and deletes the on-disk cache (Flow-stripped files, large assets). */
  async clearCache(): Promise<void> {
    await this.dispose();
    this.flowMemory = createFlowStripMemory();
    await rm(this.options.cacheDir, { recursive: true, force: true });
  }

  async dispose(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.owners.clear();
    this.deps.clear();
    this.configs.clear();
    await Promise.all(entries.map((e) => this.disposeEntry(e)));
  }

  private async mapFrom(
    entry: Entry,
    which: 'appMap' | 'vendorMap',
  ): Promise<MappedBundle | undefined> {
    let context: Context;
    try {
      context = (await entry[which]) as Context;
    } catch {
      entry[which] = undefined; // never started; try again next time
      return undefined;
    }
    try {
      const result = await context.rebuild();
      const code = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text;
      const map = result.outputFiles.find((f) => f.path.endsWith('.js.map'))?.text;
      return code !== undefined && map !== undefined
        ? { map, fingerprint: bundleFingerprint(code) }
        : undefined;
    } catch {
      return undefined; // e.g. a syntax error introduced since; the context stays usable
    }
  }

  /** (Re)creates an entry's app context; a context that fails to start drops the entry. */
  private startContexts(entry: Entry, key: BundleKey, id: string): void {
    entry.app = this.createAppContext(entry, key, false);
    entry.vendor = undefined;
    entry.vendorBuild = undefined;
    entry.app.catch(() => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
    });
  }

  /**
   * Runs builds of an entry one at a time. Requests for a target that already has a build waiting
   * share it: that build reads files when it starts, so it includes every change made so far.
   */
  private schedule(entry: Entry, key: BundleKey): Promise<BundleResult> {
    const targetId = JSON.stringify(key.target);
    const waiting = entry.queued.get(targetId);
    if (waiting) return waiting;
    const previous = entry.tail;
    const run = previous
      ? previous.then(() => {
          entry.queued.delete(targetId);
          return this.runOnce(entry, key);
        })
      : this.runOnce(entry, key);
    if (previous) entry.queued.set(targetId, run);
    entry.tail = run;
    void run.then(() => {
      if (entry.tail === run) entry.tail = undefined;
    });
    return run;
  }

  private async runOnce(entry: Entry, key: BundleKey): Promise<BundleResult> {
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    const root = key.projectRoot;
    entry.current.target = key.target;
    for (let attempt = 0; ; attempt++) {
      try {
        const app = await entry.app;
        const building = {
          modules: new Map<string, ModuleRecord>(),
          entrySource: undefined as string | undefined,
        };
        entry.building = building;
        const appResult = await app.rebuild().finally(() => {
          entry.building = undefined;
        });
        const { modules, entrySource } = building;

        if (!entry.vendorBuild || entry.vendorBuild.keyCount !== entry.vendorKeys.size) {
          entry.vendor ??= this.createVendorContext(entry, key, false);
          const vendorResult = await (await entry.vendor).rebuild();
          const code = vendorResult.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
          entry.vendorBuild = {
            version: bundleFingerprint(code),
            code,
            css: vendorResult.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '',
            keyCount: entry.vendorKeys.size,
            moduleCount: countModules(vendorResult.metafile),
            mocksUsed: entry.vendorMocksUsed(),
          };
        }

        const vendor = entry.vendorBuild;
        return {
          ok: true,
          app: {
            code: appResult.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '',
            css: appResult.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '',
          },
          vendor: { version: vendor.version, code: vendor.code, css: vendor.css },
          entryHash:
            entrySource === undefined
              ? undefined
              : createHash('sha1').update(entrySource).digest('hex'),
          modules,
          importers: importersFrom(appResult.metafile ?? { inputs: {}, outputs: {} }, root),
          buildMs: elapsed(),
          moduleCount: countModules(appResult.metafile) + vendor.moduleCount,
          warnings: appResult.warnings.map((w) => toBuildMessage(w, root)),
          mocked: mergeMocks(entry.appMocksUsed(), vendor.mocksUsed),
        };
      } catch (err) {
        if (isEsbuildFailure(err)) {
          // Packages that aren't installed (often optional native dependencies) become
          // auto-mocks: rebuild with them mocked rather than failing the preview.
          const missing = missingPackages(err.errors)?.filter((s) => !entry.unresolved.has(s));
          if (missing && missing.length > 0 && attempt < MAX_MISSING_PACKAGE_RETRIES) {
            for (const s of missing) entry.unresolved.add(s);
            const previous = [entry.app, entry.vendor, entry.appMap, entry.vendorMap];
            entry.appMap = undefined;
            entry.vendorMap = undefined;
            this.startContexts(entry, key, bundleKeyId(key));
            void this.disposeContexts(previous);
            continue;
          }
          return {
            ok: false,
            errors: err.errors.map((e) => toBuildMessage(e, root)),
            warnings: err.warnings.map((w) => toBuildMessage(w, root)),
            buildMs: elapsed(),
          };
        }
        return {
          ok: false,
          errors: [{ text: err instanceof Error ? err.message : String(err) }],
          warnings: [],
          buildMs: elapsed(),
        };
      }
    }
  }

  private async loadContextInputs(projectRoot: string) {
    return Promise.all([
      this.loadEsbuild(),
      this.depsFor(projectRoot),
      this.configFor(projectRoot),
    ]);
  }

  private mockPlugin(entry: Entry, key: BundleKey, config: ProjectConfig) {
    return mockRegistryPlugin({
      projectRoot: key.projectRoot,
      mocksDir: this.options.mocksDir,
      runtimeDir: this.options.runtimeDir,
      configMocks: config.mocks,
      unresolved: entry.unresolved,
    });
  }

  private async createAppContext(
    entry: Entry,
    key: BundleKey,
    sourcemap: boolean,
    vendorKeys: Map<string, VendorRef> = entry.vendorKeys,
  ): Promise<Context> {
    const [esbuild, deps, config] = await this.loadContextInputs(key.projectRoot);
    const mocks = this.mockPlugin(entry, key, config);
    if (!sourcemap) entry.appMocksUsed = mocks.used;
    const { vendorDir, runtimeDir, mocksDir, cacheDir } = this.options;
    return esbuild.context(
      createAppBuildOptions({
        key,
        deps,
        paths: { vendorDir, runtimeDir, mocksDir, cacheDir },
        config,
        getTarget: () => entry.current.target,
        mockPlugin: mocks.plugin,
        sourcemap,
        vendorKeys,
        transform: (source, options) => esbuild.transform(source, options),
        transformCache: entry.transformCache,
        onModule: (file, record) => {
          if (!sourcemap) entry.building?.modules.set(file, record);
        },
        onEntry: (source) => {
          if (!sourcemap && entry.building) entry.building.entrySource = source;
        },
        readUnsaved: this.options.readUnsaved,
      }),
    );
  }

  private async createVendorContext(
    entry: Entry,
    key: BundleKey,
    sourcemap: boolean,
  ): Promise<Context> {
    const [esbuild, deps, config] = await this.loadContextInputs(key.projectRoot);
    const mocks = this.mockPlugin(entry, key, config);
    if (!sourcemap) entry.vendorMocksUsed = mocks.used;
    const { vendorDir, runtimeDir, mocksDir, cacheDir } = this.options;
    return esbuild.context(
      createVendorBuildOptions({
        key,
        deps,
        paths: { vendorDir, runtimeDir, mocksDir, cacheDir },
        config,
        getTarget: () => entry.current.target,
        mockPlugin: mocks.plugin,
        sourcemap,
        getVendorKeys: () => entry.vendorKeys,
        flowMemory: this.flowMemory,
        loadStripper: this.options.loadStripper ?? defaultLoadStripper,
      }),
    );
  }

  private loadEsbuild(): Promise<Esbuild> {
    this.esbuild ??= this.options.loadEsbuild?.() ?? import('esbuild');
    return this.esbuild;
  }

  private depsFor(projectRoot: string): Promise<RuntimeDeps> {
    let deps = this.deps.get(projectRoot);
    if (!deps) {
      const resolve = this.options.resolveDeps ?? resolveRuntimeDeps;
      deps = resolve(projectRoot, this.options.vendorDir).then((d) => {
        for (const w of d.warnings) this.options.onDepsWarning?.(w);
        return d;
      });
      deps.catch(() => this.deps.delete(projectRoot));
      this.deps.set(projectRoot, deps);
    }
    return deps;
  }

  private configFor(projectRoot: string): Promise<ProjectConfig> {
    let config = this.configs.get(projectRoot);
    if (!config) {
      const load = this.options.resolveProjectConfig;
      config = (load ? load(projectRoot) : Promise.resolve(EMPTY_PROJECT_CONFIG)).then((c) => {
        for (const note of c.notes) this.options.onProjectNote?.(note);
        return c;
      });
      config.catch(() => this.configs.delete(projectRoot));
      this.configs.set(projectRoot, config);
    }
    return config;
  }

  private async disposeContexts(contexts: (Promise<Context> | undefined)[]): Promise<void> {
    await Promise.all(
      contexts.map(async (context) => {
        try {
          await (await context)?.dispose();
        } catch {
          // The context never came up (e.g. esbuild failed to load); nothing to dispose.
        }
      }),
    );
  }

  private disposeEntry(entry: Entry): Promise<void> {
    return this.disposeContexts([entry.app, entry.vendor, entry.appMap, entry.vendorMap]);
  }
}
