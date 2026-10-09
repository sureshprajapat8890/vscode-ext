import path from 'node:path';
import * as esbuild from 'esbuild';
import { defaultLoadStripper } from '../../../src/bundler/BundlerService';
import {
  createAppBuildOptions,
  createVendorBuildOptions,
  type ExtensionPaths,
} from '../../../src/bundler/buildOptions';
import type { VendorRef } from '../../../src/bundler/plugins/externalize';
import { createFlowStripMemory } from '../../../src/bundler/plugins/flowStrip';
import { mockRegistryPlugin, type MockUse } from '../../../src/bundler/plugins/mockRegistry';
import type { ModuleRecord } from '../../../src/bundler/refresh/hotPlan';
import { resolveRuntimeDeps } from '../../../src/bundler/runtimeDeps';
import type { BundleKey, PreviewTarget } from '../../../src/bundler/types';
import type { ProjectConfig } from '../../../src/project/config';

const repoRoot = path.resolve(__dirname, '../../..');

export function extensionPaths(cacheDir: string): ExtensionPaths {
  return {
    vendorDir: path.join(repoRoot, 'vendor'),
    runtimeDir: path.join(repoRoot, 'webview', 'runtime'),
    mocksDir: path.join(repoRoot, 'src', 'mocks'),
    cacheDir,
  };
}

export interface PreviewBuild {
  appJs: string;
  vendorJs: string;
  /** Both bundles' code. */
  js: string;
  /** Inputs of both builds (forward slashes, relative to the project where possible). */
  files: string[];
  appFiles: string[];
  mocked: MockUse[];
  modules: Map<string, ModuleRecord>;
  vendorKeys: Map<string, VendorRef>;
}

/** Builds a preview's app and vendor bundles with real esbuild, as BundlerService does. */
export async function buildPreview(options: {
  projectRoot: string;
  target: PreviewTarget;
  platform?: BundleKey['platform'];
  paths: ExtensionPaths;
  config?: ProjectConfig;
  readUnsaved?: (file: string) => string | undefined;
  sourcemap?: boolean;
}): Promise<PreviewBuild> {
  const { projectRoot, target, paths } = options;
  const key: BundleKey = { projectRoot, platform: options.platform ?? 'ios', target };
  const deps = await resolveRuntimeDeps(projectRoot, paths.vendorDir);
  const mockOptions = {
    projectRoot,
    mocksDir: paths.mocksDir,
    runtimeDir: paths.runtimeDir,
    configMocks: options.config?.mocks,
  };
  const appMocks = mockRegistryPlugin(mockOptions);
  const vendorMocks = mockRegistryPlugin(mockOptions);
  const vendorKeys = new Map<string, VendorRef>();
  const modules = new Map<string, ModuleRecord>();
  const shared = {
    key,
    deps,
    paths,
    config: options.config,
    getTarget: () => target,
    sourcemap: options.sourcemap ?? false,
  };
  const app = await esbuild.build(
    createAppBuildOptions({
      ...shared,
      mockPlugin: appMocks.plugin,
      vendorKeys,
      transform: (source, transformOptions) => esbuild.transform(source, transformOptions),
      transformCache: new Map(),
      onModule: (file, record) => modules.set(file, record),
      readUnsaved: options.readUnsaved,
    }),
  );
  const vendor = await esbuild.build({
    ...createVendorBuildOptions({
      ...shared,
      mockPlugin: vendorMocks.plugin,
      getVendorKeys: () => vendorKeys,
      flowMemory: createFlowStripMemory(),
      loadStripper: defaultLoadStripper,
    }),
    metafile: true,
  });
  const js = (r: esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] }): string =>
    r.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
  const inputs = (r: esbuild.BuildResult): string[] =>
    Object.keys(r.metafile?.inputs ?? {}).map((p) => p.replace(/\\/g, '/'));
  const appJs = js(app);
  const vendorJs = js(vendor);
  return {
    appJs,
    vendorJs,
    js: `${appJs}\n${vendorJs}`,
    files: [...inputs(app), ...inputs(vendor)],
    appFiles: inputs(app),
    mocked: [...appMocks.used(), ...vendorMocks.used()],
    modules,
    vendorKeys,
  };
}
