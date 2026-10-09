import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import type { SimulatedPlatform } from '../types';

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const PLAIN_EXTENSIONS = [...SOURCE_EXTENSIONS, '.mjs', '.cjs', '.json'];

/**
 * esbuild's global `resolveExtensions`: `.web.*` first, then plain — how libraries resolve on
 * web (Expo's Metro web config does the same). Library `.native` / `.ios` files usually call native
 * modules, so they are never picked for code in node_modules.
 */
export const WEB_RESOLVE_EXTENSIONS = [
  ...SOURCE_EXTENSIONS.map((ext) => `.web${ext}`),
  ...PLAIN_EXTENSIONS,
];

/** Platform suffixes tried for the project's own code, most specific first. */
export function platformSuffixes(platform: SimulatedPlatform): string[] {
  return platform === 'web' ? ['web'] : ['web', platform, 'native'];
}

/**
 * Full extension order for the project's own code: `.web.*`, `.<platform>.*`, `.native.*`, plain.
 */
export function resolveExtensionsFor(platform: SimulatedPlatform): string[] {
  return [
    ...platformSuffixes(platform).flatMap((s) => SOURCE_EXTENSIONS.map((ext) => `.${s}${ext}`)),
    ...PLAIN_EXTENSIONS,
  ];
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * For a relative import, the platform-specific file to use, if any: tries `<base>.<suffix>.<ext>`
 * and `<base>/index.<suffix>.<ext>` for each suffix in order. Returns undefined when the import
 * names an existing file or no platform variant exists (esbuild's normal resolution applies).
 */
export function findPlatformVariant(
  base: string,
  platform: SimulatedPlatform,
  exists: (p: string) => boolean = isFile,
): string | undefined {
  if (exists(base)) return undefined;
  for (const suffix of platformSuffixes(platform)) {
    for (const ext of SOURCE_EXTENSIONS) {
      const file = `${base}.${suffix}${ext}`;
      if (exists(file)) return file;
    }
  }
  if (!existsSync(base)) return undefined;
  for (const suffix of platformSuffixes(platform)) {
    for (const ext of SOURCE_EXTENSIONS) {
      const file = path.join(base, `index.${suffix}${ext}`);
      if (exists(file)) return file;
    }
  }
  return undefined;
}

const inNodeModules = (file: string): boolean => file.split(/[\\/]/).includes('node_modules');

/** Directories never scanned for platform-specific files. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.rnlens',
  '.expo',
  'ios',
  'android',
  'dist',
  'build',
  'coverage',
]);
const PLATFORM_FILE = /^(.+)\.(?:ios|android|native)\.(?:tsx|ts|jsx|js)$/;
const MAX_SCANNED_ENTRIES = 50_000;

/**
 * Import names (the last path segment, without extension) that have platform-specific variants in
 * the project's own code: `Screen.ios.tsx` → `Screen`, `Header/index.android.tsx` → `Header`.
 */
export function findPlatformSpecificNames(projectRoot: string): Set<string> {
  const names = new Set<string>();
  let scanned = 0;
  const visit = (dir: string, depth: number): void => {
    if (depth > 20 || scanned > MAX_SCANNED_ENTRIES) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      scanned++;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          visit(path.join(dir, entry.name), depth + 1);
        }
        continue;
      }
      const m = PLATFORM_FILE.exec(entry.name);
      if (!m) continue;
      names.add(m[1] === 'index' ? path.basename(dir) : m[1]);
    }
  };
  visit(projectRoot, 0);
  return names;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Resolves relative imports in the project's own code (not node_modules) to `.ios` / `.android`
 * / `.native` variants of the simulated platform, so `Platform`-specific screens render as they
 * would on that OS. Only imports whose last segment names a known platform-specific file reach
 * JavaScript, which keeps rebuilds fast (esbuild evaluates the filter natively).
 */
export function platformExtensionsPlugin(
  platform: SimulatedPlatform,
  platformSpecificNames: ReadonlySet<string>,
): Plugin {
  return {
    name: 'rnlens-platform-extensions',
    setup(build) {
      if (platform === 'web' || platformSpecificNames.size === 0) return;
      const names = [...platformSpecificNames].map(escapeRegExp).join('|');
      const filter = new RegExp(`^\\.\\.?/(?:.*/)?(?:${names})$`);
      build.onResolve({ filter }, (args) => {
        if (args.namespace !== 'file' || !args.importer || inNodeModules(args.importer))
          return undefined;
        const variant = findPlatformVariant(path.resolve(args.resolveDir, args.path), platform);
        return variant ? { path: variant } : undefined;
      });
    },
  };
}
