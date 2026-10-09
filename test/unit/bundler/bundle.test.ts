import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLoadStripper } from '../../../src/bundler/BundlerService';
import {
  assetCacheDir,
  createBuildOptions,
  flowCacheDir,
  type ExtensionPaths,
} from '../../../src/bundler/buildOptions';
import { createFlowStripMemory } from '../../../src/bundler/plugins/flowStrip';
import { mockRegistryPlugin } from '../../../src/bundler/plugins/mockRegistry';
import { resolveRuntimeDeps, type RuntimeDeps } from '../../../src/bundler/runtimeDeps';
import type { BundleKey, PreviewTarget } from '../../../src/bundler/types';

const repoRoot = path.resolve(__dirname, '../../..');
const projectRoot = path.join(__dirname, '../fixtures/hello-project');
const components = path.join(projectRoot, 'components');

let paths: ExtensionPaths;
let deps: RuntimeDeps;

beforeAll(async () => {
  paths = {
    vendorDir: path.join(repoRoot, 'vendor'),
    runtimeDir: path.join(repoRoot, 'webview', 'runtime'),
    mocksDir: path.join(repoRoot, 'src', 'mocks'),
    cacheDir: mkdtempSync(path.join(os.tmpdir(), 'rnlens-test-')),
  };
  deps = await resolveRuntimeDeps(projectRoot, paths.vendorDir);
});

afterAll(() => {
  rmSync(paths.cacheDir, { recursive: true, force: true });
});

function target(
  file: string,
  exportName: string,
  variant?: PreviewTarget['variant'],
): PreviewTarget {
  return { kind: 'component', file: path.join(components, file), exportName, variant };
}

async function bundle(
  t: PreviewTarget,
  platform: BundleKey['platform'] = 'ios',
  root = projectRoot,
) {
  const mocks = mockRegistryPlugin({
    projectRoot: root,
    mocksDir: paths.mocksDir,
    runtimeDir: paths.runtimeDir,
  });
  const options = createBuildOptions({
    key: { projectRoot: root, platform, target: t },
    deps: root === projectRoot ? deps : await resolveRuntimeDeps(root, paths.vendorDir),
    paths,
    getTarget: () => t,
    mockPlugin: mocks.plugin,
    sourcemap: true,
    flowMemory: createFlowStripMemory(),
    loadStripper: defaultLoadStripper,
  });
  const result = await esbuild.build({ ...options, metafile: true });
  const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
  const files = Object.keys(result.metafile.inputs).map((p) => p.replace(/\\/g, '/'));
  return { result, js, files, mocked: mocks.used() };
}

describe('preview bundle (real esbuild, vendor fallback)', () => {
  it('uses vendor React and react-native-web for a project without them', () => {
    expect(deps).toMatchObject({ reactSource: 'vendor', rnwSource: 'vendor', warnings: [] });
  });

  it('routes react-native through the RN Lens wrapper to react-native-web', async () => {
    const { js, files, result } = await bundle(target('Hello.tsx', 'default'));
    expect(files.some((f) => f.endsWith('webview/runtime/reactNative.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('webview/runtime/index.ts'))).toBe(true);
    expect(files.some((f) => f.includes('react-native-web/dist/'))).toBe(true);
    expect(files.some((f) => f.includes('/node_modules/react-native/'))).toBe(false);
    expect(js).toContain('"Hello"');
    expect(js).toContain('globalThis.__RNLENS_UNMOUNT__');
    expect(js.startsWith('var process = globalThis.process')).toBe(true);
    const map = result.outputFiles.find((f) => f.path.endsWith('.js.map'))?.text ?? '';
    expect(map).toContain('Hello.tsx');
  });

  it('contains exactly one copy of react and react-dom', async () => {
    const { files } = await bundle(target('Hello.tsx', 'default'));
    const reactCores = files.filter((f) => /\/react\/cjs\/react\.development\.js$/.test(f));
    const domCores = files.filter((f) =>
      /\/react-dom\/cjs\/react-dom-client\.development\.js$/.test(f),
    );
    expect(reactCores).toHaveLength(1);
    expect(domCores).toHaveLength(1);
    expect(reactCores[0]).toContain('vendor/node_modules/react/');
  });

  it.each([
    ['ios', 'ios'],
    ['android', 'native'],
    ['web', 'plain'],
  ] as const)('resolves platform files when simulating %s', async (platform, expected) => {
    const { js } = await bundle(target('Platformed.tsx', 'Platformed'), platform);
    expect(js).toContain(`label = "${expected}"`);
  });

  it('uses project mocks first, then preferred alternatives, then built-in mocks', async () => {
    const { files, mocked } = await bundle(target('Mocked.tsx', 'Mocked'));
    expect(mocked.map((m) => [m.specifier, m.source]).sort()).toEqual([
      ['@acme/native', 'project'],
      ['@react-native-async-storage/async-storage', 'built-in'],
      ['react-native-maps', 'project'],
    ]);
    expect(files.some((f) => f.endsWith('.rnlens/mocks/react-native-maps.ts'))).toBe(true);
    // @expo/vector-icons is installed, so react-native-vector-icons/* is redirected to it.
    expect(files.some((f) => f.endsWith('node_modules/@expo/vector-icons/MaterialIcons.js'))).toBe(
      true,
    );
  });

  it('falls back to the placeholder icon mock without @expo/vector-icons', async () => {
    const bare = path.join(__dirname, '../fixtures/bare-project');
    const t: PreviewTarget = {
      kind: 'component',
      file: path.join(bare, 'Placeholder.tsx'),
      exportName: 'Placeholder',
    };
    const { files, mocked } = await bundle(t, 'ios', bare);
    expect(mocked).toEqual([
      expect.objectContaining({
        specifier: 'react-native-vector-icons/Ionicons',
        source: 'built-in',
      }),
    ]);
    expect(files.some((f) => f.endsWith('src/mocks/react-native-vector-icons.tsx'))).toBe(true);
  });

  it('keeps installed polyfills, resolves platform index files, reads .env', async () => {
    const { js, mocked, files } = await bundle(target('Extras.tsx', 'Extras'));
    // The installed `events` package is used rather than a Node built-in auto-mock.
    expect(files).toContain('node_modules/events/index.js');
    expect(js).not.toContain('createAutoMock("events")');
    expect(js).toContain('screen = "ios"');
    expect(js).toContain('dir = "index mock"');
    expect(js).toContain('"http://local.override"');
    expect(js).not.toContain('shh');
    expect(mocked.map((m) => m.specifier)).toEqual(['dir-mock']);
  });

  it('auto-mocks React Native internals and Node built-ins; libraries resolve as on web', async () => {
    const { js, mocked } = await bundle(target('Internals.tsx', 'Internals'));
    expect(
      mocked
        .filter((m) => m.source === 'auto')
        .map((m) => m.specifier)
        .sort(),
    ).toEqual([
      'fs',
      'node:async_hooks',
      'react-native/Libraries/Utilities/codegenNativeComponent',
    ]);
    expect(js).toMatch(/createAutoMock\d*\("node:async_hooks"\)/);
    expect(js).toContain(`which = "web"`);
    expect(js).not.toContain(`which = "native"`);
  });

  it('strips Flow types from node_modules and caches the result on disk', async () => {
    const { js } = await bundle(target('Flowed.tsx', 'Flowed'));
    expect(js).toContain('p.label');
    expect(js).not.toContain('{|');
    const cached = readdirSync(flowCacheDir(paths.cacheDir));
    expect(cached).toHaveLength(1);
  });

  it('turns images into RN asset objects, inlining small ones and caching large ones', async () => {
    const { js } = await bundle(target('Pictures.tsx', 'Pictures'));
    // dot.png → highest density dot@3x.png (12×6 px) → logical 4×2.
    expect(js).toMatch(/uri: "data:image\/png;base64,[^"]+", width: 4, height: 2, scale: 3/);
    expect(js).toMatch(
      /uri: globalThis\.__RNLENS_ASSET_BASE__ \+ "\/[0-9a-f]{40}\.png", width: 200, height: 200, scale: 1/,
    );
    expect(readdirSync(assetCacheDir(paths.cacheDir))).toHaveLength(1);
  });

  it('renders a variant from the colocated .preview file', async () => {
    const variantFile = path.join(components, 'Button.preview.tsx');
    const { js, files } = await bundle(
      target('Button.tsx', 'Button', { file: variantFile, name: 'Disabled' }),
    );
    expect(files.some((f) => f.endsWith('components/Button.preview.tsx'))).toBe(true);
    expect(js).toMatch(/var Shown = Disabled;|const Shown = Disabled;/);
    expect(js).toContain('title: "Disabled"');
  });

  it('resolves tsconfig "paths" aliases', async () => {
    const { js } = await bundle(target('Aliased.tsx', 'Aliased'));
    expect(js).toMatch(/label = "(plain|ios)"/);
  });

  it('bundles the bare React Native fixture app (project react, vendor react-dom)', async () => {
    const bare = path.join(repoRoot, 'test', 'fixtures', 'bare-rn-app');
    const t: PreviewTarget = {
      kind: 'component',
      file: path.join(bare, 'App.tsx'),
      exportName: 'default',
    };
    const { js, files } = await bundle(t, 'android', bare);
    expect(js).toContain('Bare React Native fixture');
    expect(files.some((f) => f.includes('react-native-web/dist/'))).toBe(true);
    expect(files.some((f) => /(^|\/)node_modules\/react-native\//.test(f))).toBe(false);
  });

  it('reports syntax errors with file locations', async () => {
    await expect(bundle(target('Broken.tsx', 'Broken'))).rejects.toMatchObject({
      errors: [expect.objectContaining({ location: expect.objectContaining({ line: 3 }) })],
    });
  });

  it('never writes bundle output to the project', () => {
    expect(existsSync(path.join(projectRoot, '.rnlens', 'out'))).toBe(false);
  });
});
