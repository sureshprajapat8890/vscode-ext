import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BuildOptions, Plugin } from 'esbuild';
import { WEB_CAPABLE_PACKAGES } from '../mocks';
import { EMPTY_PROJECT_CONFIG, type ProjectConfig } from '../project/config';
import type { ModuleRecord } from './refresh/hotPlan';
import { aliasesPlugin } from './plugins/aliases';
import { assetsPlugin } from './plugins/assets';
import { expoRouterDefines, expoRouterPlugin } from './plugins/expoRouter';
import { externalizePlugin, type VendorRef } from './plugins/externalize';
import { flowStripPlugin, type FlowStripMemory, type StripFlow } from './plugins/flowStrip';
import { metroDevClientsPlugin } from './plugins/metroDevClients';
import {
  findPlatformSpecificNames,
  platformExtensionsPlugin,
  WEB_RESOLVE_EXTENSIONS,
} from './plugins/platformExtensions';
import {
  projectSourcePlugin,
  type ProjectSourceOptions,
  type Transform,
} from './plugins/projectSource';
import { rnAliasPlugin } from './plugins/rnAlias';
import { singleReactPlugin } from './plugins/singleReact';
import { VENDOR_ENTRY, vendorEntryPlugin } from './plugins/vendorEntry';
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

/** What both the app and vendor builds share. */
export interface BuildInput {
  key: BundleKey;
  deps: RuntimeDeps;
  paths: ExtensionPaths;
  /** Aliases, defines, decorators and plugins from settings / Babel / rnlens.config.js. */
  config?: ProjectConfig;
  /** Current target; read on every build so variant switches don't need a new context. */
  getTarget: () => PreviewTarget;
  mockPlugin: Plugin;
  /** Emit an external source map (only the on-demand mapping contexts do). */
  sourcemap: boolean;
}

export interface AppBuildInput extends BuildInput {
  /** Collects the modules the vendor bundle must provide. */
  vendorKeys: Map<string, VendorRef>;
  transform: Transform;
  transformCache: ProjectSourceOptions['cache'];
  onModule: (file: string, record: ModuleRecord) => void;
  onEntry?: (source: string) => void;
  /** Unsaved editor contents for project files (onType mode). */
  readUnsaved?: (file: string) => string | undefined;
}

export interface VendorBuildInput extends BuildInput {
  getVendorKeys: () => ReadonlyMap<string, VendorRef>;
  flowMemory: FlowStripMemory;
  loadStripper: () => Promise<StripFlow>;
}

export const assetCacheDir = (cacheDir: string): string => path.join(cacheDir, 'assets');
export const flowCacheDir = (cacheDir: string): string => path.join(cacheDir, 'flow');
export const outDir = (projectRoot: string): string => path.join(projectRoot, '.rnlens', 'out');

function readTsconfig(projectRoot: string): string | undefined {
  try {
    return readFileSync(path.join(projectRoot, 'tsconfig.json'), 'utf8');
  } catch {
    return undefined;
  }
}

function baseOptions(input: BuildInput): BuildOptions & { write: false } {
  const { key, paths } = input;
  const { projectRoot } = key;
  const config = input.config ?? EMPTY_PROJECT_CONFIG;
  const routerAppDir = key.target.kind === 'app' ? key.target.routerAppDir : undefined;
  return {
    absWorkingDir: projectRoot,
    write: false,
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    sourcemap: input.sourcemap ? 'external' : false,
    sourcesContent: false,
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    resolveExtensions: WEB_RESOLVE_EXTENSIONS,
    mainFields: ['react-native', 'browser', 'module', 'main'],
    conditions: ['react-native', 'browser', 'import', 'default'],
    // Fallback lookups after the normal node_modules walk: Babel module-resolver roots, packages
    // the `expo` package nests (Expo's resolver exposes them to apps), then RN Lens's vendored copies.
    nodePaths: [
      ...config.aliasRoots,
      ...[path.join(projectRoot, 'node_modules', 'expo', 'node_modules')].filter((d) =>
        existsSync(d),
      ),
      path.join(paths.vendorDir, 'node_modules'),
    ],
    define: {
      __DEV__: 'true',
      'process.env.NODE_ENV': '"development"',
      // Expo packages switch between native and web implementations on EXPO_OS, and the preview
      // runs on web. (Project code sees the simulated platform through Platform.OS.)
      'process.env.EXPO_OS': '"web"',
      global: 'globalThis',
      ...projectDefines(projectRoot),
      ...(routerAppDir ? expoRouterDefines(projectRoot, routerAppDir) : {}),
      ...config.define,
    },
    banner: { js: PROCESS_SHIM },
    logLevel: 'silent',
  };
}

/** Resolution rules shared by both builds (after the project's own plugins). */
function resolutionPlugins(input: BuildInput): Plugin[] {
  const { key, deps, paths } = input;
  const { projectRoot, platform } = key;
  const config = input.config ?? EMPTY_PROJECT_CONFIG;
  const routerAppDir = key.target.kind === 'app' ? key.target.routerAppDir : undefined;
  return [
    input.mockPlugin,
    aliasesPlugin(config.aliases, projectRoot, platform),
    singleReactPlugin(deps.reactResolveDir, paths.runtimeDir),
    rnAliasPlugin(deps.rnwResolveDir, paths.runtimeDir),
    platformExtensionsPlugin(platform, findPlatformSpecificNames(projectRoot)),
    webCapablePlugin(WEB_CAPABLE_PACKAGES),
    metroDevClientsPlugin(),
    ...(routerAppDir ? [expoRouterPlugin(routerAppDir)] : []),
  ];
}

/**
 * The app bundle: the virtual entry and the project's own modules (each a cacheable CommonJS
 * module registered with React Refresh). Everything else is external, required from the vendor
 * bundle by key. Rebuilt on every change; small, so fast.
 */
export function createAppBuildOptions(input: AppBuildInput): BuildOptions & { write: false } {
  const { key, paths } = input;
  const { projectRoot } = key;
  const config = input.config ?? EMPTY_PROJECT_CONFIG;
  return {
    ...baseOptions(input),
    entryPoints: [ENTRY_SPECIFIER],
    // Never written (write: false); only names the in-memory outputs.
    outfile: path.join(outDir(projectRoot), 'app.js'),
    format: 'cjs',
    metafile: true,
    plugins: [
      externalizePlugin(projectRoot, input.vendorKeys),
      // The project's own esbuild plugins (rnlens.config.js) get the first say after that.
      ...config.plugins,
      virtualEntryPlugin(
        input.getTarget,
        projectRoot,
        paths.runtimeDir,
        config.decorators,
        input.onEntry,
      ),
      ...resolutionPlugins(input),
      projectSourcePlugin({
        projectRoot,
        transform: input.transform,
        readUnsaved: input.readUnsaved,
        cache: input.transformCache,
        onModule: input.onModule,
        tsconfigRaw: readTsconfig(projectRoot),
      }),
      assetsPlugin({ cacheDir: assetCacheDir(paths.cacheDir) }),
    ],
  };
}

/**
 * The vendor bundle: React, react-native-web, node_modules, mocks and RN Lens's runtime, exposed to
 * the app bundle through a module registry. Rebuilt only when the app starts using new modules,
 * so the React instance (and component state) survives edits.
 */
export function createVendorBuildOptions(input: VendorBuildInput): BuildOptions & { write: false } {
  const { key, paths } = input;
  const { projectRoot } = key;
  const config = input.config ?? EMPTY_PROJECT_CONFIG;
  return {
    ...baseOptions(input),
    entryPoints: [VENDOR_ENTRY],
    outfile: path.join(outDir(projectRoot), 'vendor.js'),
    metafile: true,
    format: 'iife',
    plugins: [
      vendorEntryPlugin(input.getVendorKeys, projectRoot),
      ...config.plugins,
      virtualEntryPlugin(input.getTarget, projectRoot, paths.runtimeDir, config.decorators),
      ...resolutionPlugins(input),
      assetsPlugin({ cacheDir: assetCacheDir(paths.cacheDir) }),
      flowStripPlugin({
        cacheDir: flowCacheDir(paths.cacheDir),
        memory: input.flowMemory,
        loadStripper: input.loadStripper,
      }),
    ],
  };
}
