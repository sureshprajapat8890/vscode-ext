import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Loader, Message, Plugin, TransformOptions } from 'esbuild';
import { analyzeForRefresh, wrapForHotReload } from '../refresh/refreshTransform';
import type { ModuleRecord } from '../refresh/hotPlan';
import { isProjectSource } from './externalize';

const LOADERS: Record<string, Loader> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.jsx': 'jsx',
  '.js': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const SOURCE_EXT = '\\.(?:tsx|ts|jsx|js|mjs|cjs)';
const SOURCE_FILE = new RegExp(`${SOURCE_EXT}$`);

/**
 * A filter matching source files under `projectRoot` but outside node_modules. esbuild filters are
 * Go regexes (no lookaheads), so it enumerates the project's top-level directories and source
 * files instead of excluding node_modules. Windows drive letters match in either case.
 */
export function projectSourceFilter(projectRoot: string): RegExp | undefined {
  const dirs: string[] = [];
  const files: string[] = [];
  try {
    for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') dirs.push(entry.name);
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(entry.name);
      }
    }
  } catch {
    return undefined;
  }
  const sep = '[\\\\/]';
  const alternatives = [
    ...(dirs.length > 0 ? [`(?:${dirs.map(escapeRegExp).join('|')})${sep}.*${SOURCE_EXT}`] : []),
    ...files.map(escapeRegExp),
  ];
  if (alternatives.length === 0) return undefined;
  const root = escapeRegExp(projectRoot).replace(
    /^([A-Za-z]):/,
    (_m, d: string) => `[${d.toLowerCase()}${d.toUpperCase()}]:`,
  );
  return new RegExp(`^${root}${sep}(?:${alternatives.join('|')})$`);
}

export type Transform = (source: string, options: TransformOptions) => Promise<{ code: string }>;

interface CachedModule {
  sourceHash: string;
  code: string;
  record: ModuleRecord;
}

export interface ProjectSourceOptions {
  projectRoot: string;
  /** esbuild's `transform` (the bundler's own esbuild instance). */
  transform: Transform;
  /** Unsaved editor contents (`onType` mode); undefined to read from disk. */
  readUnsaved?: (file: string) => string | undefined;
  /** Transformed modules by path; kept across builds so unchanged files aren't re-transformed. */
  cache: Map<string, CachedModule>;
  /** Called for every project module in a build (path → hash and boundary flag). */
  onModule: (file: string, record: ModuleRecord) => void;
  /** Raw tsconfig.json text (for JSX and decorator settings), if the project has one. */
  tsconfigRaw?: string;
}

function isEsbuildFailure(err: unknown): err is { errors: Message[] } {
  return !!err && typeof err === 'object' && Array.isArray((err as { errors?: unknown }).errors);
}

/**
 * App build: loads the project's own modules for hot updates. Each file is analysed for React
 * Refresh (components, hook signatures, boundary), converted to CommonJS so it runs as its own
 * cacheable module, and wrapped to reuse its previous exports unless the update plan re-runs it.
 * Unsaved editor contents are used when provided.
 */
export function projectSourcePlugin(options: ProjectSourceOptions): Plugin {
  return {
    name: 'rnlens-project-source',
    setup(build) {
      const filter = projectSourceFilter(options.projectRoot);
      if (!filter) return;
      build.onLoad({ filter }, async (args) => {
        if (!isProjectSource(options.projectRoot, args.path)) return undefined;
        const source = options.readUnsaved?.(args.path) ?? (await readFile(args.path, 'utf8'));
        const sourceHash = createHash('sha1').update(source).digest('hex');
        let cached = options.cache.get(args.path);
        if (cached?.sourceHash !== sourceHash) {
          const analysis = analyzeForRefresh(source, args.path);
          let cjs: string;
          try {
            cjs = (
              await options.transform(analysis.source, {
                loader: LOADERS[path.extname(args.path).toLowerCase()] ?? 'jsx',
                format: 'cjs',
                jsx: 'automatic',
                target: 'es2020',
                sourcemap: 'inline',
                sourcefile: args.path,
                tsconfigRaw: options.tsconfigRaw,
                logLevel: 'silent',
              })
            ).code;
          } catch (err) {
            if (isEsbuildFailure(err)) return { errors: err.errors };
            throw err;
          }
          cached = {
            sourceHash,
            code: wrapForHotReload(cjs, args.path, analysis.components),
            record: { hash: sourceHash, isBoundary: analysis.isBoundary },
          };
          options.cache.set(args.path, cached);
        }
        options.onModule(args.path, cached.record);
        return { contents: cached.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}
