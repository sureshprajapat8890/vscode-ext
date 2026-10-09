import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { Loader, Plugin } from 'esbuild';

const LOADERS: Record<string, Loader> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.jsx': 'jsx',
  '.js': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A filter matching source files under `projectRoot` but outside node_modules. esbuild filters are
 * Go regexes (no lookaheads), so it enumerates the project's top-level entries instead of
 * excluding node_modules. Windows drive letters match in either case.
 */
export function projectSourceFilter(projectRoot: string): RegExp | undefined {
  let top: string[];
  try {
    top = readdirSync(projectRoot).filter((n) => n !== 'node_modules');
  } catch {
    return undefined;
  }
  if (top.length === 0) return undefined;
  const root = escapeRegExp(projectRoot).replace(
    /^([A-Za-z]):/,
    (_m, d: string) => `[${d.toLowerCase()}${d.toUpperCase()}]:`,
  );
  const sep = '[\\\\/]';
  return new RegExp(
    `^${root}${sep}(?:${top.map(escapeRegExp).join('|')})(?:${sep}.*)?\\.(?:tsx|ts|jsx|js|mjs|cjs)$`,
  );
}

/**
 * Serves the editor's unsaved contents for project files that are open and dirty, so the preview
 * can update while typing (`rnLens.updateMode: "onType"`). Everything else is read from disk.
 */
export function unsavedBuffersPlugin(
  projectRoot: string,
  readUnsaved: (file: string) => string | undefined,
): Plugin {
  return {
    name: 'rnlens-unsaved-buffers',
    setup(build) {
      const filter = projectSourceFilter(projectRoot);
      if (!filter) return;
      build.onLoad({ filter }, (args) => {
        if (args.path.split(/[\\/]/).includes('node_modules')) return undefined;
        const contents = readUnsaved(args.path);
        if (contents === undefined) return undefined;
        return { contents, loader: LOADERS[path.extname(args.path).toLowerCase()] ?? 'js' };
      });
    },
  };
}
