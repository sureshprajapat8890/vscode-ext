import path from 'node:path';
import type * as esbuildApi from 'esbuild';
import type { BuildContext, BuildOptions, Message } from 'esbuild';
import { createBuildOptions } from './buildOptions';
import { resolveRuntimeDeps, type RuntimeDeps } from './runtimeDeps';
import {
  bundleKeyId,
  type BuildMessage,
  type BundleKey,
  type BundleResult,
  type BundleSuccess,
} from './types';

type Esbuild = Pick<typeof esbuildApi, 'context'>;

export interface BundlerServiceOptions {
  vendorDir: string;
  /** Loads esbuild lazily on first build; injectable for tests. */
  loadEsbuild?: () => Promise<Esbuild>;
  resolveDeps?: (projectRoot: string, vendorDir: string) => Promise<RuntimeDeps>;
  onDepsWarning?: (message: string) => void;
}

interface Entry {
  context: Promise<BuildContext<BuildOptions & { write: false }>>;
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
 * Owns one esbuild context per (project, target, platform). Rebuilds requested while one is
 * running are coalesced into a single follow-up build, so the newest file contents always win
 * and no more than two builds per key are ever outstanding.
 */
export class BundlerService {
  private readonly entries = new Map<string, Entry>();
  private readonly deps = new Map<string, Promise<RuntimeDeps>>();
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
      const created: Entry = {
        context: this.createContext(key),
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
    return this.schedule(entry, key);
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
        map: '',
        buildMs: 0,
        warnings: result.warnings.map((w) => toBuildMessage(w, key.projectRoot)),
      };
      for (const file of result.outputFiles) {
        if (file.path.endsWith('.js.map')) success.map = file.text;
        else if (file.path.endsWith('.js')) success.code = file.text;
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

  private async createContext(key: BundleKey) {
    const [esbuild, deps] = await Promise.all([this.loadEsbuild(), this.depsFor(key.projectRoot)]);
    return esbuild.context(createBuildOptions(key, deps, this.options.vendorDir));
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
    try {
      const ctx = await entry.context;
      await ctx.dispose();
    } catch {
      // The context never came up (e.g. esbuild failed to load); nothing to dispose.
    }
  }
}
