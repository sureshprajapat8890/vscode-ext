import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BundlerService,
  bundleFingerprint,
  importersFrom,
} from '../../../src/bundler/BundlerService';
import type { RuntimeDeps } from '../../../src/bundler/runtimeDeps';
import type { BundleKey } from '../../../src/bundler/types';

const PATHS = {
  vendorDir: '/v',
  runtimeDir: '/r',
  mocksDir: '/m',
  cacheDir: mkdtempSync(path.join(os.tmpdir(), 'rnlens-svc-')),
};

const deps: RuntimeDeps = {
  reactResolveDir: '/v',
  reactSource: 'vendor',
  reactVersion: '19.2.8',
  rnwResolveDir: '/v',
  rnwSource: 'vendor',
  rnwVersion: '0.21.4',
  warnings: ['note'],
};

function key(file = '/p/A.tsx'): BundleKey {
  return {
    projectRoot: '/p',
    platform: 'ios',
    target: { kind: 'component', file, exportName: 'default' },
  };
}

interface Deferred {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

interface FakeContext {
  kind: 'app' | 'vendor';
  sourcemap: unknown;
  plugins: { name: string }[];
  disposed: boolean;
  rebuilds: number;
}

function output(text: string, name = 'app', map = '{"map":1}') {
  return {
    warnings: [{ text: 'w', location: { file: 'src/A.tsx', line: 2, column: 4, lineText: 'x' } }],
    metafile: { inputs: {}, outputs: {} },
    outputFiles: [
      { path: `/p/.rnlens/out/${name}.js`, text },
      { path: `/p/.rnlens/out/${name}.js.map`, text: map },
      { path: `/p/.rnlens/out/${name}.css`, text: `.${name}{}` },
    ],
  };
}

/**
 * Fake esbuild. App rebuilds complete only when the test resolves them (`pending`); vendor
 * rebuilds complete at once.
 */
function fakeEsbuild() {
  const pending: Deferred[] = [];
  const contexts: FakeContext[] = [];
  const esbuild = {
    transform: vi.fn(async (code: string) => ({ code })),
    context: vi.fn(
      async (options: { outfile: string; sourcemap: unknown; plugins: { name: string }[] }) => {
        const kind = options.outfile.endsWith('vendor.js') ? 'vendor' : 'app';
        const state: FakeContext = {
          kind,
          sourcemap: options.sourcemap,
          plugins: options.plugins,
          disposed: false,
          rebuilds: 0,
        };
        contexts.push(state);
        return {
          rebuild: () => {
            state.rebuilds++;
            if (kind === 'vendor') {
              return Promise.resolve(output(`vendor ${state.rebuilds}`, 'vendor'));
            }
            return new Promise((resolve, reject) => pending.push({ resolve, reject }));
          },
          dispose: async () => {
            state.disposed = true;
          },
        };
      },
    ),
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const of = (kind: FakeContext['kind']) => contexts.filter((c) => c.kind === kind);
  return { esbuild, pending, contexts, of, flush };
}

function service(fake: ReturnType<typeof fakeEsbuild>, onDepsWarning = vi.fn()) {
  return new BundlerService({
    ...PATHS,
    loadEsbuild: async () => fake.esbuild as never,
    resolveDeps: vi.fn(async () => deps),
    onDepsWarning,
  });
}

describe('BundlerService', () => {
  it('returns app and vendor code, css and absolute warning locations', async () => {
    const fake = fakeEsbuild();
    const onWarn = vi.fn();
    const bundler = service(fake, onWarn);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].resolve(output('code'));
    const r = await result;
    expect(r).toMatchObject({
      ok: true,
      app: { code: 'code', css: '.app{}' },
      vendor: { code: 'vendor 1', css: '.vendor{}', version: bundleFingerprint('vendor 1') },
      entryHash: undefined,
      modules: new Map(),
      importers: new Map(),
    });
    if (!r.ok) throw new Error('expected success');
    expect(r.warnings[0]).toMatchObject({ line: 2, column: 4, lineText: 'x' });
    expect(r.warnings[0].file?.replace(/\\/g, '/')).toMatch(/\/p\/src\/A\.tsx$/);
    expect(onWarn).toHaveBeenCalledWith('note');
    expect(bundler.contextCount).toBe(1);
  });

  it('rebuilds only the app while it uses no new modules', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const first = bundler.build(key());
    await fake.flush();
    fake.pending[0].resolve(output('1'));
    const r1 = await first;
    const second = bundler.build(key());
    await fake.flush();
    fake.pending[1].resolve(output('2'));
    const r2 = await second;
    expect(r2).toMatchObject({
      ok: true,
      app: { code: '2' },
    });
    // Same vendor build: the webview keeps running the one it has.
    expect(r1.ok && r2.ok && r2.vendor.version === r1.vendor.version).toBe(true);
    expect(fake.of('vendor')).toHaveLength(1);
    expect(fake.of('vendor')[0].rebuilds).toBe(1);
  });

  it('reuses one pair of contexts per key and creates separate ones for other keys', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const a1 = bundler.build(key());
    await fake.flush();
    fake.pending[0].resolve(output('1'));
    await a1;
    const a2 = bundler.build(key());
    const b = bundler.build(key('/p/B.tsx'));
    await fake.flush();
    fake.pending.slice(1).forEach((d) => d.resolve(output('2')));
    await Promise.all([a2, b]);
    expect(fake.of('app')).toHaveLength(2);
    expect(fake.of('vendor')).toHaveLength(2);
    expect(bundler.contextCount).toBe(2);
  });

  it('coalesces builds requested while one is running into a single follow-up', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const app = () => fake.of('app')[0];
    const first = bundler.build(key());
    await fake.flush();
    const second = bundler.build(key());
    const third = bundler.build(key());
    expect(third).toBe(second);
    expect(app().rebuilds).toBe(1);

    fake.pending[0].resolve(output('old'));
    expect(await first).toMatchObject({ app: { code: 'old' } });
    await fake.flush();
    expect(app().rebuilds).toBe(2);
    fake.pending[1].resolve(output('new'));
    expect(await second).toMatchObject({ app: { code: 'new' } });

    const fourth = bundler.build(key());
    await fake.flush();
    expect(app().rebuilds).toBe(3);
    fake.pending[2].resolve(output('later'));
    expect(await fourth).toMatchObject({ app: { code: 'later' } });
  });

  it('turns esbuild failures into error results with locations', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].reject({
      errors: [
        {
          text: 'Unexpected "("',
          location: { file: '/p/A.tsx', line: 3, column: 1, lineText: 'x(' },
        },
      ],
      warnings: [],
    });
    expect(await result).toMatchObject({
      ok: false,
      errors: [{ text: 'Unexpected "("', line: 3, column: 1 }],
    });
  });

  it('restarts both contexts to auto-mock packages that are not installed', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].reject({
      errors: [{ text: 'Could not resolve "react-native-maps"' }],
      warnings: [],
    });
    await fake.flush();
    expect(fake.of('app')).toHaveLength(2);
    expect(fake.of('app')[0].disposed).toBe(true);
    fake.pending[1].resolve(output('mocked'));
    expect(await result).toMatchObject({ ok: true, app: { code: 'mocked' } });
  });

  it('reports unexpected exceptions and context start-up failures, then retries', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].reject(new Error('boom'));
    expect(await result).toMatchObject({ ok: false, errors: [{ text: 'boom' }] });

    const failing = new BundlerService({
      ...PATHS,
      loadEsbuild: async () => fake.esbuild as never,
      resolveDeps: vi
        .fn()
        .mockRejectedValueOnce(new Error('vendor missing'))
        .mockResolvedValue(deps),
    });
    expect(await failing.build(key())).toMatchObject({
      ok: false,
      errors: [{ text: 'vendor missing' }],
    });
    await fake.flush();
    expect(failing.contextCount).toBe(0);
    const retry = failing.build(key());
    await fake.flush();
    fake.pending.at(-1)?.resolve(output('ok'));
    expect(await retry).toMatchObject({ ok: true, app: { code: 'ok' } });
  });

  it('reports non-Error throwables as text', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].reject('plain string');
    expect(await result).toMatchObject({ ok: false, errors: [{ text: 'plain string' }] });
  });

  it('caches dependency resolution per project until invalidated', async () => {
    const fake = fakeEsbuild();
    const resolveDeps = vi.fn(async () => deps);
    const bundler = new BundlerService({
      ...PATHS,
      loadEsbuild: async () => fake.esbuild as never,
      resolveDeps,
    });
    void bundler.build(key('/p/A.tsx'));
    void bundler.build(key('/p/B.tsx'));
    await fake.flush();
    expect(resolveDeps).toHaveBeenCalledTimes(1);
    bundler.invalidateProject('/p');
    void bundler.build(key('/p/C.tsx'));
    await fake.flush();
    expect(resolveDeps).toHaveBeenCalledTimes(2);
  });

  it('releases and disposes contexts', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const a = bundler.build(key('/p/A.tsx'));
    const b = bundler.build(key('/p/B.tsx'));
    await fake.flush();
    fake.pending.forEach((d) => d.resolve(output('x')));
    await Promise.all([a, b]);
    await bundler.release(key('/p/A.tsx'));
    await bundler.release(key('/p/missing.tsx'));
    expect(bundler.contextCount).toBe(1);
    expect(fake.contexts.filter((c) => c.disposed)).toHaveLength(2);
    await bundler.dispose();
    expect(bundler.contextCount).toBe(0);
    expect(fake.contexts.every((c) => c.disposed)).toBe(true);
  });

  it('shares contexts between owners until the last one releases them', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const [panelA, panelB] = [{}, {}];
    const a = bundler.build(key(), panelA);
    const b = bundler.build(key(), panelB);
    await fake.flush();
    fake.pending[0].resolve(output('a'));
    await a;
    await fake.flush();
    fake.pending[1].resolve(output('b'));
    await b;
    expect(fake.of('app')).toHaveLength(1);
    await bundler.release(key(), panelA);
    expect(bundler.contextCount).toBe(1);
    expect(fake.contexts.some((c) => c.disposed)).toBe(false);
    await bundler.release(key(), panelA); // releasing twice is harmless
    expect(bundler.contextCount).toBe(1);
    await bundler.release(key(), panelB);
    expect(bundler.contextCount).toBe(0);
    expect(fake.contexts.every((c) => c.disposed)).toBe(true);
  });

  it('resets contexts without forgetting their owners', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const owner = {};
    const first = bundler.build(key(), owner);
    await fake.flush();
    fake.pending[0].resolve(output('1'));
    await first;
    await bundler.reset(key());
    expect(bundler.contextCount).toBe(0);
    const second = bundler.build(key());
    await fake.flush();
    fake.pending[1].resolve(output('2'));
    await second;
    await bundler.release(key()); // the default owner leaves; `owner` still uses it
    expect(bundler.contextCount).toBe(1);
    await bundler.release(key(), owner);
    expect(bundler.contextCount).toBe(0);
  });

  it('coalesces queued builds per target, so panels with different variants get their own', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const plain = key();
    const variant: BundleKey = {
      ...plain,
      target: { ...plain.target, variant: { file: '/p/A.preview.tsx', name: 'Primary' } },
    } as BundleKey;
    const first = bundler.build(plain);
    await fake.flush();
    const forVariant = bundler.build(variant);
    const forPlain = bundler.build(plain);
    expect(forPlain).not.toBe(forVariant);
    expect(bundler.build(variant)).toBe(forVariant);
    fake.pending[0].resolve(output('first'));
    await first;
    await fake.flush();
    fake.pending[1].resolve(output('variant'));
    expect(await forVariant).toMatchObject({ app: { code: 'variant' } });
    await fake.flush();
    fake.pending[2].resolve(output('plain'));
    expect(await forPlain).toMatchObject({ app: { code: 'plain' } });
    expect(fake.of('app')[0].rebuilds).toBe(3);
  });

  it('keeps one context across variant switches and builds the latest target', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const plain = key();
    const variant: BundleKey = {
      ...plain,
      target: {
        kind: 'component',
        file: '/p/A.tsx',
        exportName: 'default',
        variant: { file: '/p/A.preview.tsx', name: 'Primary' },
      },
    };
    const first = bundler.build(plain);
    await fake.flush();
    fake.pending[0].resolve(output('plain'));
    await first;
    const second = bundler.build(variant);
    await fake.flush();
    fake.pending[1].resolve(output('variant'));
    expect(await second).toMatchObject({ ok: true, app: { code: 'variant' } });
    expect(fake.of('app')).toHaveLength(1);
    expect(fake.of('app')[0].plugins.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'rnlens-externalize',
        'rnlens-virtual-entry',
        'rnlens-project-source',
      ]),
    );
    expect(fake.of('vendor')[0].plugins.map((p) => p.name)).toContain('rnlens-vendor-entry');
  });

  it('builds source maps on demand in separate contexts and fingerprints the code', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    expect(await bundler.sourceMapsFor(key())).toEqual({});
    const built = bundler.build(key());
    await fake.flush();
    fake.pending[0].resolve(output('const a = 1;\n'));
    await built;
    const mapped = bundler.sourceMapsFor(key());
    await fake.flush();
    fake.pending[1].resolve(output('const a = 1;\n//# sourceMappingURL=app.js.map\n'));
    expect(await mapped).toEqual({
      app: { map: '{"map":1}', fingerprint: bundleFingerprint('const a = 1;\n') },
      vendor: { map: '{"map":1}', fingerprint: bundleFingerprint('vendor 1') },
    });
    expect(fake.contexts.map((c) => [c.kind, c.sourcemap])).toEqual([
      ['app', false],
      ['vendor', false],
      ['app', 'external'],
      ['vendor', 'external'],
    ]);

    const failing = bundler.sourceMapsFor(key());
    await fake.flush();
    fake.pending[2].reject(new Error('boom'));
    expect((await failing).app).toBeUndefined();
    await bundler.release(key());
    expect(fake.contexts.every((c) => c.disposed)).toBe(true);
  });

  it('clearCache disposes contexts and deletes the cache directory', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    mkdirSync(path.join(PATHS.cacheDir, 'flow'), { recursive: true });
    writeFileSync(path.join(PATHS.cacheDir, 'flow', 'x.js'), '');
    void bundler.build(key());
    await fake.flush();
    await bundler.clearCache();
    expect(bundler.contextCount).toBe(0);
    expect(fake.contexts[0].disposed).toBe(true);
    expect(existsSync(PATHS.cacheDir)).toBe(false);
  });

  it('tolerates disposing a context that failed to start', async () => {
    const bundler = new BundlerService({
      ...PATHS,
      loadEsbuild: async () => {
        throw new Error('no esbuild');
      },
      resolveDeps: async () => deps,
    });
    const result = bundler.build(key());
    await expect(bundler.release(key())).resolves.toBeUndefined();
    expect(await result).toMatchObject({ ok: false, errors: [{ text: 'no esbuild' }] });
  });
});

describe('importersFrom', () => {
  it('reverses the metafile import graph with absolute ids, skipping externals', () => {
    const root = path.resolve('/p');
    const importers = importersFrom(
      {
        inputs: {
          'rnlens-entry:entry': {
            bytes: 1,
            imports: [{ path: 'src/A.tsx', kind: 'import-statement', original: './src/A' }],
          },
          'src/A.tsx': {
            bytes: 1,
            imports: [
              { path: 'src/theme.ts', kind: 'import-statement' },
              { path: 'rnlens-vendor-ref:/v/react', kind: 'require-call', external: true },
            ],
          },
        },
        outputs: {},
      },
      root,
    );
    expect(importers).toEqual(
      new Map([
        [path.join(root, 'src/A.tsx'), ['rnlens-entry:entry']],
        [path.join(root, 'src/theme.ts'), [path.join(root, 'src/A.tsx')]],
      ]),
    );
  });
});
