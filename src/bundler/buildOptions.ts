import path from 'node:path';
import type { BuildOptions } from 'esbuild';
import { resolveExtensionsFor } from './plugins/platformExtensions';
import { rnAliasPlugin } from './plugins/rnAlias';
import { singleReactPlugin } from './plugins/singleReact';
import type { RuntimeDeps } from './runtimeDeps';
import type { BundleKey } from './types';
import { ENTRY_SPECIFIER, virtualEntryPlugin } from './virtualEntry';

/** Many RN libraries read `process.env.*` at runtime; browsers have no `process`. */
const PROCESS_SHIM =
  'var process = globalThis.process || (globalThis.process = { env: { NODE_ENV: "development" } });';

/** esbuild options for a preview bundle. Output is kept in memory (`write: false`). */
export function createBuildOptions(
  key: BundleKey,
  deps: RuntimeDeps,
  vendorDir: string,
): BuildOptions & { write: false } {
  const { projectRoot, platform, target } = key;
  return {
    entryPoints: [ENTRY_SPECIFIER],
    // Never written (write: false); only names the in-memory outputs.
    outfile: path.join(projectRoot, '.rnlens', 'out', 'preview.js'),
    absWorkingDir: projectRoot,
    write: false,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: 'external',
    sourcesContent: true,
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    resolveExtensions: resolveExtensionsFor(platform),
    mainFields: ['react-native', 'browser', 'module', 'main'],
    conditions: ['react-native', 'browser', 'import', 'default'],
    // Fallback lookup for packages the project lacks (after the normal node_modules walk).
    nodePaths: [path.join(vendorDir, 'node_modules')],
    define: {
      __DEV__: 'true',
      'process.env.NODE_ENV': '"development"',
      'process.env.EXPO_OS': JSON.stringify(platform),
      global: 'globalThis',
    },
    banner: { js: PROCESS_SHIM },
    logLevel: 'silent',
    plugins: [
      virtualEntryPlugin(target, projectRoot),
      singleReactPlugin(deps.reactResolveDir),
      rnAliasPlugin(deps.rnwResolveDir),
    ],
  };
}
