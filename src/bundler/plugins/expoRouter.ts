import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';

const NAMESPACE = 'rnlens-router-ctx';
const ROUTE_FILE = /\.[tj]sx?$/;
/** Same exclusions as expo-router's own `_ctx` (API routes, middleware, +html, +native-intent). */
const IGNORED = /(?:\+api|^\+middleware|^\+html|^\+native-intent)\.[tj]sx?$/;

/** Route files under `appDir` as require.context keys (`./(tabs)/index.tsx`), sorted. */
export function listRouteFiles(appDir: string): string[] {
  const keys: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules')
          visit(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (
        ROUTE_FILE.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !IGNORED.test(entry.name)
      ) {
        keys.push(`./${prefix}${entry.name}`);
      }
    }
  };
  visit(appDir, '');
  return keys.sort();
}

/**
 * Source of a module equivalent to expo-router's `_ctx` (`require.context(appRoot, true, …)`,
 * a Metro-only feature): every route file is imported statically and exposed through the same
 * `ctx(key)` / `ctx.keys()` / `ctx.resolve(key)` interface.
 */
export function routerContextSource(appDir: string): string {
  const keys = listRouteFiles(appDir);
  const imports = keys.map(
    (key, i) => `import * as route${i} from ${JSON.stringify(path.join(appDir, key))};`,
  );
  const entries = keys.map((key, i) => `  ${JSON.stringify(key)}: route${i},`);
  return [
    ...imports,
    `const routes = {`,
    ...entries,
    `};`,
    `export function ctx(key) {`,
    `  if (!(key in routes)) throw new Error('RN Lens: no route file ' + key + ' in ' + ${JSON.stringify(appDir)});`,
    `  return routes[key];`,
    `}`,
    `ctx.keys = () => Object.keys(routes);`,
    `ctx.resolve = (key) => key;`,
    `ctx.id = 'rnlens:router-ctx';`,
    '',
  ].join('\n');
}

/** Replaces `expo-router/_ctx` with a generated route context for `appDir` (re-listed every build). */
export function expoRouterPlugin(appDir: string): Plugin {
  return {
    name: 'rnlens-expo-router',
    setup(build) {
      build.onResolve({ filter: /^expo-router\/_ctx$/ }, () => ({
        path: 'ctx',
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: routerContextSource(appDir),
        loader: 'js',
        resolveDir: appDir,
        watchDirs: [appDir],
      }));
    },
  };
}

/** `process.env` values expo-router reads at build time under Metro. */
export function expoRouterDefines(projectRoot: string, appDir: string): Record<string, string> {
  const relative = `./${path.relative(projectRoot, appDir).split(path.sep).join('/')}`;
  return {
    'process.env.EXPO_ROUTER_APP_ROOT': JSON.stringify(relative),
    'process.env.EXPO_ROUTER_ABS_APP_ROOT': JSON.stringify(appDir),
    'process.env.EXPO_ROUTER_IMPORT_MODE': JSON.stringify('sync'),
  };
}
