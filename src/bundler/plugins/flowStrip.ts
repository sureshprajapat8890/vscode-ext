import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';

/** Strips Flow types from source. Injected so the (large) parser loads only when needed. */
export type StripFlow = (source: string) => string;

/** The comments (and blank space) before the first statement. */
const LEADING_COMMENTS = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;
const FLOW_SYNTAX = /^\s*(?:import|export)\s+(?:type|typeof)\s+[{*\w]/m;

/** An `@flow` pragma anywhere in the leading comments, or Flow-only `import type`/`export type`. */
export function looksLikeFlow(source: string): boolean {
  const header = LEADING_COMMENTS.exec(source.slice(0, 8192))?.[0] ?? '';
  return /@flow\b/.test(header) || FLOW_SYNTAX.test(source);
}

export interface FlowStripOptions {
  /** Directory for stripped files, keyed by path + mtime + size. */
  cacheDir: string;
  loadStripper: () => Promise<StripFlow>;
  /** Shared across builds: files known not to need stripping, and stripped results. */
  memory: FlowStripMemory;
}

export interface FlowStripMemory {
  plain: Set<string>;
  stripped: Map<string, string>;
}

export function createFlowStripMemory(): FlowStripMemory {
  return { plain: new Set(), stripped: new Map() };
}

/**
 * Strips Flow types from JavaScript inside `node_modules` that esbuild can't parse. Results are
 * memoised in memory for warm rebuilds and cached on disk across sessions.
 */
export function flowStripPlugin(options: FlowStripOptions): Plugin {
  let stripper: Promise<StripFlow> | undefined;
  return {
    name: 'rnlens-flow-strip',
    setup(build) {
      build.onLoad({ filter: /[\\/]node_modules[\\/].*\.(?:js|jsx|mjs|cjs)$/ }, async (args) => {
        const { plain, stripped } = options.memory;
        if (plain.has(args.path)) return undefined;
        const loader = /\.(?:mjs|cjs)$/.test(args.path) ? 'js' : 'jsx';
        const memo = stripped.get(args.path);
        if (memo !== undefined) return { contents: memo, loader };

        const source = await readFile(args.path, 'utf8');
        if (!looksLikeFlow(source)) {
          plain.add(args.path);
          // Already read; hand it over rather than have esbuild read it again.
          return { contents: source, loader };
        }

        const info = await stat(args.path);
        const key = createHash('sha1')
          .update(`${args.path}\0${info.mtimeMs}\0${info.size}`)
          .digest('hex');
        const cached = path.join(options.cacheDir, `${key}.js`);
        let contents: string | undefined;
        try {
          contents = await readFile(cached, 'utf8');
        } catch {
          try {
            stripper ??= options.loadStripper();
            contents = (await stripper)(source);
          } catch {
            // Not Flow after all (or unparseable): let esbuild report the real error.
            plain.add(args.path);
            return undefined;
          }
          await mkdir(options.cacheDir, { recursive: true });
          await writeFile(cached, contents);
        }
        stripped.set(args.path, contents);
        return { contents, loader };
      });
    },
  };
}
