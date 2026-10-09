import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultLoadStripper } from '../../../src/bundler/BundlerService';
import { createBuildOptions } from '../../../src/bundler/buildOptions';
import { createFlowStripMemory } from '../../../src/bundler/plugins/flowStrip';
import { mockRegistryPlugin } from '../../../src/bundler/plugins/mockRegistry';
import { resolveRuntimeDeps } from '../../../src/bundler/runtimeDeps';
import type { AppTarget } from '../../../src/bundler/types';
import { detectAppEntry } from '../../../src/project/appEntry';

const repoRoot = path.resolve(__dirname, '../../..');
const fixtures = path.join(repoRoot, 'test', 'fixtures');
const paths = {
  vendorDir: path.join(repoRoot, 'vendor'),
  runtimeDir: path.join(repoRoot, 'webview', 'runtime'),
  mocksDir: path.join(repoRoot, 'src', 'mocks'),
  cacheDir: mkdtempSync(path.join(os.tmpdir(), 'rnlens-apps-')),
};
afterAll(() => rmSync(paths.cacheDir, { recursive: true, force: true }));

async function bundleApp(projectRoot: string, platform: 'ios' | 'android' = 'ios') {
  const entry = detectAppEntry(projectRoot, platform);
  if ('error' in entry) throw new Error(entry.error);
  const target: AppTarget = {
    kind: 'app',
    file: entry.file,
    mode: entry.mode,
    routerAppDir: entry.routerAppDir,
  };
  const mocks = mockRegistryPlugin({
    projectRoot,
    mocksDir: paths.mocksDir,
    runtimeDir: paths.runtimeDir,
  });
  const result = await esbuild.build({
    ...createBuildOptions({
      key: { projectRoot, platform, target },
      deps: await resolveRuntimeDeps(projectRoot, paths.vendorDir),
      paths,
      getTarget: () => target,
      mockPlugin: mocks.plugin,
      sourcemap: false,
      flowMemory: createFlowStripMemory(),
      loadStripper: defaultLoadStripper,
    }),
    metafile: true,
  });
  return {
    entry,
    js: result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '',
    files: Object.keys(result.metafile.inputs).map((f) => f.replace(/\\/g, '/')),
    mocked: mocks.used(),
  };
}

describe('app previews (real esbuild)', () => {
  it('bundles the Expo + React Navigation fixture from index.ts', async () => {
    const { entry, js, files } = await bundleApp(path.join(fixtures, 'expo-app'));
    expect(entry).toMatchObject({ mode: 'module', description: 'package.json "main" (index.ts)' });
    expect(js).toContain('Home screen');
    expect(js).toContain('Badge: default');
    expect(files.some((f) => f.includes('@react-navigation/native-stack'))).toBe(true);
    // Exactly one react-dom client, reached through RN Lens's root-tracking wrapper.
    expect(files.filter((f) => /react-dom-client\.development\.js$/.test(f))).toHaveLength(1);
    expect(files.some((f) => f.endsWith('webview/runtime/reactDomClient.ts'))).toBe(true);
  }, 60_000);

  it('resolves .android files when simulating Android', async () => {
    const { js } = await bundleApp(path.join(fixtures, 'expo-app'), 'android');
    expect(js).toContain('Badge: Android');
    expect(js).not.toContain('Badge: default');
  }, 60_000);

  it('bundles the expo-router fixture with a generated route context', async () => {
    const root = path.join(fixtures, 'router-app');
    const { entry, js, mocked } = await bundleApp(root);
    expect(entry).toMatchObject({
      description: 'expo-router',
      routerAppDir: path.join(root, 'app'),
    });
    expect(js).toContain('"./(tabs)/_layout.tsx"');
    expect(js).toContain('"./modal.tsx"');
    expect(js).not.toContain('"./+html.tsx"');
    expect(mocked.map((m) => m.specifier)).toContain('@expo/metro-runtime');
  }, 60_000);
});
