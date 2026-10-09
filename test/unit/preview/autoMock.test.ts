import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createAutoMock } from '../../../webview/runtime/autoMock';

describe('createAutoMock', () => {
  it('is callable, constructible, deeply chainable and not thenable', async () => {
    const mock = createAutoMock('pkg') as Record<string, never> & (() => unknown);
    expect(mock()).toBeUndefined();
    const nested = (mock as unknown as { a: { b: { c: () => unknown } } }).a.b;
    expect(nested.c()).toBeUndefined();
    expect((mock as unknown as { a: unknown }).a).toBe((mock as unknown as { a: unknown }).a);
    expect(typeof new (mock as unknown as new () => object)()).toBe('function');
    expect((mock as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(mock)).resolves.toBe(mock);
    expect(String(mock)).toBe('[RN Lens mock pkg]');
    expect((mock as unknown as { name: string }).name).toBe('pkg');
  });

  it('looks like a plain function component to React', () => {
    const mock = createAutoMock('pkg') as Record<string, unknown> & { prototype: object };
    expect(mock.$$typeof).toBeUndefined();
    expect(mock.defaultProps).toBeUndefined();
    expect((mock.prototype as { isReactComponent?: unknown }).isReactComponent).toBeUndefined();
    class Extended extends (mock as unknown as new () => object) {}
    expect(new Extended()).toBeInstanceOf(Extended);
  });

  it('supports default and named imports through esbuild CommonJS interop', async () => {
    // Bundle `import Default, { Named } from 'mocked'` where 'mocked' is a CommonJS module whose
    // exports are an auto-mock, then run it.
    const result = await esbuild.build({
      stdin: {
        contents: `import Default, { Named } from 'mocked'; globalThis.__out = { Default, Named };`,
        resolveDir: __dirname,
      },
      bundle: true,
      write: false,
      format: 'iife',
      plugins: [
        {
          name: 'mocked',
          setup(build) {
            build.onResolve({ filter: /^mocked$/ }, () => ({ path: 'mocked', namespace: 'm' }));
            build.onLoad({ filter: /.*/, namespace: 'm' }, () => ({
              contents: `module.exports = globalThis.__createAutoMock('mocked');`,
              loader: 'js',
            }));
          },
        },
      ],
    });
    const g = globalThis as {
      __createAutoMock?: unknown;
      __out?: { Default: unknown; Named: unknown };
    };
    g.__createAutoMock = createAutoMock;
    new Function(result.outputFiles[0].text)();
    expect(typeof g.__out?.Default).toBe('function');
    expect(typeof g.__out?.Named).toBe('function');
    delete g.__createAutoMock;
    delete g.__out;
  });
});
