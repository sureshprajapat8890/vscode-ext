import path from 'node:path';
import * as esbuild from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBuildOptions } from '../../../src/bundler/buildOptions';
import { resolveRuntimeDeps, type RuntimeDeps } from '../../../src/bundler/runtimeDeps';
import type { BundleKey } from '../../../src/bundler/types';

const repoRoot = path.resolve(__dirname, '../../..');
const vendorDir = path.join(repoRoot, 'vendor');
const projectRoot = path.join(__dirname, '../fixtures/hello-project');
const components = path.join(projectRoot, 'components');

function key(file: string, exportName: string, platform: BundleKey['platform'] = 'ios'): BundleKey {
  return {
    projectRoot,
    platform,
    target: { kind: 'component', file: path.join(components, file), exportName },
  };
}

async function bundle(k: BundleKey, deps: RuntimeDeps) {
  return esbuild.build({ ...createBuildOptions(k, deps, vendorDir), metafile: true });
}

/** Normalised input paths from a metafile (forward slashes). */
function inputs(meta: esbuild.Metafile): string[] {
  return Object.keys(meta.inputs).map((p) => p.replace(/\\/g, '/'));
}

describe('preview bundle (real esbuild, vendor fallback)', () => {
  let deps: RuntimeDeps;

  beforeAll(async () => {
    deps = await resolveRuntimeDeps(projectRoot, vendorDir);
  });

  it('uses vendor React and react-native-web for a project without them', () => {
    expect(deps.reactSource).toBe('vendor');
    expect(deps.rnwSource).toBe('vendor');
    expect(deps.warnings).toEqual([]);
  });

  it('bundles a component with react-native aliased to react-native-web', async () => {
    const result = await bundle(key('Hello.tsx', 'default'), deps);
    const files = inputs(result.metafile);
    expect(files.some((f) => f.includes('react-native-web/dist/'))).toBe(true);
    expect(files.some((f) => f.includes('/node_modules/react-native/'))).toBe(false);
    expect(files.some((f) => f.endsWith('components/Hello.tsx'))).toBe(true);

    const js = result.outputFiles.find((f) => f.path.endsWith('.js'));
    const map = result.outputFiles.find((f) => f.path.endsWith('.js.map'));
    expect(js?.text).toContain('"Hello"');
    expect(js?.text).toContain('globalThis.__RNLENS_UNMOUNT__');
    expect(js?.text.startsWith('var process = globalThis.process')).toBe(true);
    expect(map?.text).toContain('Hello.tsx');
  });

  it('contains exactly one copy of react and react-dom', async () => {
    const result = await bundle(key('Hello.tsx', 'default'), deps);
    const files = inputs(result.metafile);
    const reactCores = files.filter((f) => /\/react\/cjs\/react\.development\.js$/.test(f));
    const reactDomCores = files.filter((f) =>
      /\/react-dom\/cjs\/react-dom-client\.development\.js$/.test(f),
    );
    expect(reactCores).toHaveLength(1);
    expect(reactDomCores).toHaveLength(1);
    expect(reactCores[0]).toContain('vendor/node_modules/react/');
  });

  it.each([
    ['ios', 'ios'],
    ['android', 'native'],
    ['web', 'plain'],
  ] as const)('resolves platform files when simulating %s', async (platform, expected) => {
    const result = await bundle(key('Platformed.tsx', 'Platformed', platform), deps);
    const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
    expect(js).toContain(`label = "${expected}"`);
  });

  it('reports syntax errors with absolute file locations', async () => {
    await expect(bundle(key('Broken.tsx', 'Broken'), deps)).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          location: expect.objectContaining({ line: 3 }),
        }),
      ],
    });
  });
});
