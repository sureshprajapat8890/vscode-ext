import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type * as esbuildApi from 'esbuild';
import type { BuildContext, BuildOptions, Message } from 'esbuild';
import { createBuildOptions, type ExtensionPaths } from './buildOptions';
import { createFlowStripMemory, type StripFlow } from './plugins/flowStrip';
import { mockRegistryPlugin, type MockUse } from './plugins/mockRegistry';
import { resolveRuntimeDeps, type RuntimeDeps } from './runtimeDeps';
import {
  bundleKeyId,
  type BuildMessage,
  type BundleKey,
  type BundleResult,
  type BundleSuccess,
  type PreviewTarget,
} from './types';

type Esbuild = Pick<typeof esbuildApi, 'context'>;

export interface BundlerServiceOptions extends ExtensionPaths {
  /** Loads esbuild lazily on first build; injectable for tests. */
  loadEsbuild?: () => Promise<Esbuild>;
  /** Loads the Flow type stripper lazily, the first time a Flow file is seen. */
  loadStripper?: () => Promise<StripFlow>;
  resolveDeps?: (projectRoot: string, vendorDir: string) => Promise<RuntimeDeps>;
  onDepsWarning?: (message: string) => void;
}

interface Entry {
  context: Promise<BuildContext<BuildOptions & { write: false }>>;
  /** Latest target requested for this context (variants may change between builds). */
  current: { target: PreviewTarget };
  mocksUsed: () => MockUse[];
  /** Second context emitting source maps, created on the first runtime error that needs one. */
  mapContext: Promise<BuildContext<BuildOptions & { write: false }>> | undefined;
  running: Promise<BundleResult> | undefined;
  queued: Promise<BundleResult> | undefined;
}

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
 * Identifies generated code independently of whether it carries a source map comment, so a map
 * built later can be checked against the bundle actually running in the preview.
 */
export function bundleFingerprint(code: string): string {
  const withoutMapComment = code.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, '\n');
  return createHash('sha1').update(withoutMapComment).digest('hex');
}

export const defaultLoadStripper = async (): Promise<StripFlow> => {
  const { default: flowRemoveTypes } = await import('flow-remove-types');
  return (source) => flowRemoveTypes(source, { all: true }).toString();
};

/**
 * Owns one esbuild context per (project, target, platform). Rebuilds requested while one is
 * running are coalesced into a single follow-up build, so the newest file contents always win
 * and no more than two builds per key are ever outstanding.
 */
export class BundlerService {
  private readonly entries = new Map<string, Entry>();
  private readonly deps = new Map<string, Promise<RuntimeDeps>>();
  private flowMemory = createFlowStripMemory();
  private esbuild: Promise<Esbuild> | undefined;

  constructor(private readonly options: BundlerServiceOptions) {}

  get contextCount(): number {
    return this.entries.size;
  }

  /** Builds (or rebuilds) the bundle for `key`. Never rejects: failures are returned as results. */
  build(key: BundleKey): Promise<BundleResult> {
    const id = bundleKeyId(key);
    let entry = this.entries.get(id);
    if (!entry) {
      const mocks = mockRegistryPlugin({
        projectRoot: key.projectRoot,
        mocksDir: this.options.mocksDir,
        runtimeDir: this.options.runtimeDir,
      });
      const current = { target: key.target };
      const created: Entry = {
        current,
        context: this.createContext(key, () => current.target, mocks.plugin, false),
        mocksUsed: mocks.used,
        mapContext: undefined,
        running: undefined,
        queued: undefined,
      };
      // A context that failed to start is dropped so the next build retries from scratch.
      created.context.catch(() => {
        if (this.entries.get(id) === created) this.entries.delete(id);
      });
      this.entries.set(id, created);
      entry = created;
    }
    entry.current.target = key.target;
    return this.schedule(entry, key);
  }

  /**
   * Rebuilds the current target with a source map (in a separate, lazily created context, so
   * normal rebuilds skip map generation). Returns undefined if no context exists or the build fails.
   * Callers should compare `fingerprint` with the running bundle's before trusting the map.
   */
  async sourceMapFor(key: BundleKey): Promise<{ map: string; fingerprint: string } | undefined> {
    const entry = this.entries.get(bundleKeyId(key));
    if (!entry) return undefined;
    if (!entry.mapContext) {
      const mocks = mockRegistryPlugin({
        projectRoot: key.projectRoot,
        mocksDir: this.options.mocksDir,
        runtimeDir: this.options.runtimeDir,
      });
      entry.mapContext = this.createContext(key, () => entry.current.target, mocks.plugin, true);
    }
    let context: BuildContext<BuildOptions & { write: false }>;
    try {
      context = await entry.mapContext;
    } catch {
      // The context never started; try again next time.
      entry.mapContext = undefined;
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
      // A failed build (e.g. a syntax error introduced since) leaves the context usable.
      return undefined;
    }
  }

  /** Disposes the context for `key`, if any. */
  async release(key: BundleKey): Promise<void> {
    const id = bundleKeyId(key);
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    await this.disposeEntry(entry);
  }

  /** Forgets cached dependency resolution for a project (e.g. after package.json changes). */
  invalidateProject(projectRoot: string): void {
    this.deps.delete(projectRoot);
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
    this.deps.clear();
    await Promise.all(entries.map((e) => this.disposeEntry(e)));
  }

  private schedule(entry: Entry, key: BundleKey): Promise<BundleResult> {
    if (entry.queued) {
      return entry.queued;
    }
    if (entry.running) {
      const queued = entry.running.then(() => {
        entry.queued = undefined;
        return this.start(entry, key);
      });
      entry.queued = queued;
      return queued;
    }
    return this.start(entry, key);
  }

  private start(entry: Entry, key: BundleKey): Promise<BundleResult> {
    const run = this.runOnce(entry, key);
    entry.running = run;
    void run.then(() => {
      if (entry.running === run) entry.running = undefined;
    });
    return run;
  }

  private async runOnce(entry: Entry, key: BundleKey): Promise<BundleResult> {
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    try {
      const ctx = await entry.context;
      const result = await ctx.rebuild();
      const success: BundleSuccess = {
        ok: true,
        code: '',
        css: '',
        buildMs: 0,
        warnings: result.warnings.map((w) => toBuildMessage(w, key.projectRoot)),
        mocked: entry
          .mocksUsed()
          .map(({ specifier, source, note }) => ({ specifier, source, note })),
      };
      for (const file of result.outputFiles) {
        if (file.path.endsWith('.js')) success.code = file.text;
        else if (file.path.endsWith('.css')) success.css = file.text;
      }
      success.buildMs = elapsed();
      return success;
    } catch (err) {
      if (isEsbuildFailure(err)) {
        return {
          ok: false,
          errors: err.errors.map((e) => toBuildMessage(e, key.projectRoot)),
          warnings: err.warnings.map((w) => toBuildMessage(w, key.projectRoot)),
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

  private async createContext(
    key: BundleKey,
    getTarget: () => PreviewTarget,
    mockPlugin: esbuildApi.Plugin,
    sourcemap: boolean,
  ) {
    const [esbuild, deps] = await Promise.all([this.loadEsbuild(), this.depsFor(key.projectRoot)]);
    const { vendorDir, runtimeDir, mocksDir, cacheDir } = this.options;
    return esbuild.context(
      createBuildOptions({
        key,
        deps,
        paths: { vendorDir, runtimeDir, mocksDir, cacheDir },
        getTarget,
        mockPlugin,
        sourcemap,
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

  private async disposeEntry(entry: Entry): Promise<void> {
    await Promise.all(
      [entry.context, entry.mapContext].map(async (context) => {
        try {
          await (await context)?.dispose();
        } catch {
          // The context never came up (e.g. esbuild failed to load); nothing to dispose.
        }
      }),
    );
  }
}
