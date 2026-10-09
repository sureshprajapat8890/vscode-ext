import { describe, expect, it, vi } from 'vitest';
import { BundlerService } from '../../../src/bundler/BundlerService';
import type { RuntimeDeps } from '../../../src/bundler/runtimeDeps';
import type { BundleKey } from '../../../src/bundler/types';

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

/** Fake esbuild whose rebuilds complete only when the test resolves them. */
function fakeEsbuild() {
  const pending: Deferred[] = [];
  const contexts: { disposed: boolean; rebuilds: number }[] = [];
  const esbuild = {
    context: vi.fn(async () => {
      const state = { disposed: false, rebuilds: 0 };
      contexts.push(state);
      return {
        rebuild: () => {
          state.rebuilds++;
          return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        },
        dispose: async () => {
          state.disposed = true;
        },
      };
    }),
  };
  const output = (text: string) => ({
    warnings: [{ text: 'w', location: { file: 'src/A.tsx', line: 2, column: 4, lineText: 'x' } }],
    outputFiles: [
      { path: '/p/.rnlens/out/preview.js', text },
      { path: '/p/.rnlens/out/preview.js.map', text: '{"map":1}' },
      { path: '/p/.rnlens/out/preview.css', text: '.a{}' },
    ],
  });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { esbuild, pending, contexts, output, flush };
}

function service(fake: ReturnType<typeof fakeEsbuild>, onDepsWarning = vi.fn()) {
  return new BundlerService({
    vendorDir: '/v',
    loadEsbuild: async () => fake.esbuild as never,
    resolveDeps: vi.fn(async () => deps),
    onDepsWarning,
  });
}

describe('BundlerService', () => {
  it('returns code, css, map and absolute warning locations', async () => {
    const fake = fakeEsbuild();
    const onWarn = vi.fn();
    const bundler = service(fake, onWarn);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].resolve(fake.output('code'));
    const r = await result;
    expect(r).toMatchObject({ ok: true, code: 'code', css: '.a{}', map: '{"map":1}' });
    expect(r.warnings[0]).toMatchObject({ line: 2, column: 4, lineText: 'x' });
    expect(r.warnings[0].file?.replace(/\\/g, '/')).toMatch(/\/p\/src\/A\.tsx$/);
    expect(onWarn).toHaveBeenCalledWith('note');
    expect(bundler.contextCount).toBe(1);
  });

  it('reuses one context per key and creates separate ones for other keys', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const a1 = bundler.build(key());
    await fake.flush();
    fake.pending[0].resolve(fake.output('1'));
    await a1;
    const a2 = bundler.build(key());
    const b = bundler.build(key('/p/B.tsx'));
    await fake.flush();
    fake.pending.slice(1).forEach((d) => d.resolve(fake.output('2')));
    await Promise.all([a2, b]);
    expect(fake.esbuild.context).toHaveBeenCalledTimes(2);
    expect(bundler.contextCount).toBe(2);
  });

  it('coalesces builds requested while one is running into a single follow-up', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const first = bundler.build(key());
    await fake.flush();
    const second = bundler.build(key());
    const third = bundler.build(key());
    expect(third).toBe(second);
    expect(fake.contexts[0].rebuilds).toBe(1);

    fake.pending[0].resolve(fake.output('old'));
    expect((await first).ok && (await first)).toMatchObject({ code: 'old' });
    await fake.flush();
    expect(fake.contexts[0].rebuilds).toBe(2);
    fake.pending[1].resolve(fake.output('new'));
    expect(await second).toMatchObject({ code: 'new' });

    const fourth = bundler.build(key());
    await fake.flush();
    expect(fake.contexts[0].rebuilds).toBe(3);
    fake.pending[2].resolve(fake.output('later'));
    expect(await fourth).toMatchObject({ code: 'later' });
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

  it('reports unexpected exceptions and context start-up failures, then retries', async () => {
    const fake = fakeEsbuild();
    const bundler = service(fake);
    const result = bundler.build(key());
    await fake.flush();
    fake.pending[0].reject(new Error('boom'));
    expect(await result).toMatchObject({ ok: false, errors: [{ text: 'boom' }] });

    const failing = new BundlerService({
      vendorDir: '/v',
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
    fake.pending.at(-1)?.resolve(fake.output('ok'));
    expect(await retry).toMatchObject({ ok: true, code: 'ok' });
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
      vendorDir: '/v',
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
    void bundler.build(key('/p/A.tsx'));
    void bundler.build(key('/p/B.tsx'));
    await fake.flush();
    await bundler.release(key('/p/A.tsx'));
    await bundler.release(key('/p/missing.tsx'));
    expect(bundler.contextCount).toBe(1);
    expect(fake.contexts[0].disposed).toBe(true);
    await bundler.dispose();
    expect(bundler.contextCount).toBe(0);
    expect(fake.contexts[1].disposed).toBe(true);
  });

  it('tolerates disposing a context that failed to start', async () => {
    const bundler = new BundlerService({
      vendorDir: '/v',
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
