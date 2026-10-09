import { existsSync } from 'node:fs';
import path from 'node:path';
import type { BuildOptions, Plugin } from 'esbuild';
import { WEB_CAPABLE_PACKAGES } from '../mocks';
import { assetsPlugin } from './plugins/assets';
import { flowStripPlugin, type FlowStripMemory, type StripFlow } from './plugins/flowStrip';
import {
  findPlatformSpecificNames,
  platformExtensionsPlugin,
  WEB_RESOLVE_EXTENSIONS,
} from './plugins/platformExtensions';
import { rnAliasPlugin } from './plugins/rnAlias';
import { singleReactPlugin } from './plugins/singleReact';
import { webCapablePlugin } from './plugins/webCapable';
import { projectDefines } from './projectEnv';
import type { RuntimeDeps } from './runtimeDeps';
import type { BundleKey, PreviewTarget } from './types';
import { ENTRY_SPECIFIER, virtualEntryPlugin } from './virtualEntry';

/** Many RN libraries read `process.env.*` at runtime; browsers have no `process`. */
const PROCESS_SHIM =
  'var process = globalThis.process || (globalThis.process = { env: { NODE_ENV: "development" } });';

export interface ExtensionPaths {
  vendorDir: string;
  /** Preview runtime sources (`rnlens:runtime`, the react-native wrapper). */
  runtimeDir: string;
  /** Built-in mock modules. */
  mocksDir: string;
  /** Writable cache root (Flow-stripped files, large assets). */
  cacheDir: string;
}

export interface BuildInput {
  key: BundleKey;
  deps: RuntimeDeps;
  paths: ExtensionPaths;
  /** Current target; read on every build so variant switches don't need a new context. */
  getTarget: () => PreviewTarget;
  mockPlugin: Plugin;
  /** Emit an external source map (only the on-demand mapping context does). */
  sourcemap: boolean;
  flowMemory: FlowStripMemory;
  loadStripper: () => Promise<StripFlow>;
}

export const assetCacheDir = (cacheDir: string): string => path.join(cacheDir, 'assets');
export const flowCacheDir = (cacheDir: string): string => path.join(cacheDir, 'flow');

/** esbuild options for a preview bundle. Output is kept in memory (`write: false`). */
export function createBuildOptions(input: BuildInput): BuildOptions & { write: false } {
  const { key, deps, paths } = input;
  const { projectRoot, platform } = key;
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
    sourcemap: input.sourcemap ? 'external' : false,
    sourcesContent: false,
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    resolveExtensions: WEB_RESOLVE_EXTENSIONS,
    mainFields: ['react-native', 'browser', 'module', 'main'],
    conditions: ['react-native', 'browser', 'import', 'default'],
    // Fallback lookups after the normal node_modules walk: packages the `expo` package nests
    // (Expo's resolver exposes them to apps), then RN Lens's vendored copies.
    nodePaths: [
      ...[path.join(projectRoot, 'node_modules', 'expo', 'node_modules')].filter((d) =>
        existsSync(d),
      ),
      path.join(paths.vendorDir, 'node_modules'),
    ],
    define: {
      __DEV__: 'true',
      'process.env.NODE_ENV': '"development"',
      'process.env.EXPO_OS': JSON.stringify(platform),
      global: 'globalThis',
      ...projectDefines(projectRoot),
    },
    banner: { js: PROCESS_SHIM },
    logLevel: 'silent',
    plugins: [
      virtualEntryPlugin(input.getTarget, projectRoot, paths.runtimeDir),
      input.mockPlugin,
      singleReactPlugin(deps.reactResolveDir),
      rnAliasPlugin(deps.rnwResolveDir, paths.runtimeDir),
      platformExtensionsPlugin(platform, findPlatformSpecificNames(projectRoot)),
      webCapablePlugin(WEB_CAPABLE_PACKAGES),
      assetsPlugin({ cacheDir: assetCacheDir(paths.cacheDir) }),
      flowStripPlugin({
        cacheDir: flowCacheDir(paths.cacheDir),
        memory: input.flowMemory,
        loadStripper: input.loadStripper,
      }),
    ],
  };
}
