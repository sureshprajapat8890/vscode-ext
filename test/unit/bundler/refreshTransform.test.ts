import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_NAME,
  analyzeForRefresh,
  topLevelRequires,
  wrapForHotReload,
} from '../../../src/bundler/refresh/refreshTransform';

describe('analyzeForRefresh', () => {
  it('registers top-level components (exported or not) with hook signatures', () => {
    const src = [
      `import { memo, useState } from 'react';`,
      `function Inner() { const [a, setA] = useState(1); return <View />; }`,
      `export function Counter() {`,
      `  const [n, setN] = useState(0);`,
      `  const ref = React.useRef(null);`,
      `  useEffect(() => { const inner = () => useFake(); }, []);`,
      `  return <Text>{n}</Text>;`,
      `}`,
      `export const Memo = memo(() => <View />);`,
      `const helper = () => 1;`,
    ].join('\n');
    const { components, isBoundary, source } = analyzeForRefresh(src, '/p/C.tsx');
    expect(source).toBe(src);
    expect(components).toEqual([
      { local: 'Inner', id: '/p/C.tsx#Inner', signature: 'useState(1)' },
      {
        local: 'Counter',
        id: '/p/C.tsx#Counter',
        signature: 'useState(0)\nuseRef(null)\nuseEffect',
      },
      { local: 'Memo', id: '/p/C.tsx#Memo', signature: '' },
    ]);
    expect(isBoundary).toBe(true);
  });

  it('names anonymous default exports so they can be registered', () => {
    const arrow = analyzeForRefresh(`export default () => <View />;`, '/p/A.tsx');
    expect(arrow.source).toBe(
      `const ${DEFAULT_EXPORT_NAME} = () => <View />;;export default ${DEFAULT_EXPORT_NAME};`,
    );
    expect(arrow.components.map((c) => c.local)).toEqual([DEFAULT_EXPORT_NAME]);
    expect(arrow.isBoundary).toBe(true);

    const fn = analyzeForRefresh(`export default function (p) { return <View />; }`, '/p/B.tsx');
    expect(fn.source).toBe(
      `export default function ${DEFAULT_EXPORT_NAME} (p) { return <View />; }`,
    );
    expect(fn.components.map((c) => c.id)).toEqual([`/p/B.tsx#${DEFAULT_EXPORT_NAME}`]);

    const named = analyzeForRefresh(
      `export default function Screen() { return <View />; }`,
      '/p/S.tsx',
    );
    expect(named.components.map((c) => c.local)).toEqual(['Screen']);
  });

  it('is not a boundary when anything other than components is exported', () => {
    expect(analyzeForRefresh(`export const theme = createContext('x');`, '/t.ts').isBoundary).toBe(
      false,
    );
    expect(
      analyzeForRefresh(
        `export const A = () => <V />; export const previews = { X: {} };`,
        '/a.tsx',
      ).isBoundary,
    ).toBe(false);
    expect(analyzeForRefresh(`export * from './x';`, '/a.ts').isBoundary).toBe(false);
    expect(analyzeForRefresh(`export { A } from './a';`, '/a.ts').isBoundary).toBe(false);
    expect(analyzeForRefresh(`registerRootComponent(App);`, '/index.ts').isBoundary).toBe(false);
    expect(analyzeForRefresh(`export enum Mode { A }`, '/e.ts').isBoundary).toBe(false);
    expect(analyzeForRefresh(`export const { a, b } = obj;`, '/d.ts').isBoundary).toBe(false);
  });

  it('ignores type-only exports when deciding boundaries, and survives syntax errors', () => {
    const src = `export type Props = { a: string }; export interface P {} export const A = () => <V />;`;
    expect(analyzeForRefresh(src, '/a.tsx').isBoundary).toBe(true);
    expect(analyzeForRefresh('export const = ;', '/x.ts')).toMatchObject({
      components: [],
      isBoundary: false,
    });
  });
});

describe('wrapForHotReload', () => {
  it('reuses cached exports, registers components and caches exports, keeping source map lines', async () => {
    const original = `import { useState } from 'react';\nexport default function Counter() {\n  const [n] = useState(0);\n  return <b>{n}</b>;\n}\n`;
    const analysis = analyzeForRefresh(original, '/p/Counter.tsx');
    const cjs = (
      await esbuild.transform(analysis.source, {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'cjs',
        sourcemap: 'inline',
        sourcefile: '/p/Counter.tsx',
      })
    ).code;
    const wrapped = wrapForHotReload(cjs, '/p/Counter.tsx', analysis.components);
    const lines = wrapped.split('\n');
    expect(
      lines[0].startsWith(
        'var __rnlensHot = globalThis.__RNLENS_HOT__; if (__rnlensHot && __rnlensHot.reuse(module, "/p/Counter.tsx")) { require("react/jsx-runtime"); require("react"); return; } ',
      ),
    ).toBe(true);
    expect(wrapped).toContain('__rnlensRefresh.register(Counter, "/p/Counter.tsx#Counter");');
    expect(wrapped.trimEnd().split('\n').at(-1)).toMatch(/^\/\/# sourceMappingURL=data:/);
    // Six trailer lines are added after the body; the body's line numbers are unchanged.
    expect(cjs.split('\n').length + 6).toBe(lines.length);

    // Run it as a CommonJS module against fake hot/refresh runtimes.
    const registered: string[] = [];
    const cache = new Map<string, unknown>();
    const g = globalThis as Record<string, unknown>;
    g.__RNLENS_REFRESH__ = {
      register: (_t: unknown, id: string) => registered.push(id),
      sign: () => undefined,
    };
    g.__RNLENS_HOT__ = {
      reuse: (m: { exports: unknown }, id: string) =>
        cache.has(id) ? ((m.exports = cache.get(id)), true) : false,
      store: (m: { exports: unknown }, id: string) => cache.set(id, m.exports),
    };
    const required: string[] = [];
    const run = () => {
      const module = { exports: {} as Record<string, unknown> };
      new Function('module', 'exports', 'require', wrapped)(
        module,
        module.exports,
        (specifier: string) => {
          required.push(specifier);
          return { useState: () => [0], jsx: () => null };
        },
      );
      return module.exports;
    };
    const first = run();
    expect(registered).toEqual(['/p/Counter.tsx#Counter']);
    required.length = 0;
    // Reused: cached exports, no re-registration, but its imports are still required (so a
    // changed module they import gets to run).
    expect(run()).toBe(first);
    expect(registered).toHaveLength(1);
    expect(required.sort()).toEqual(['react', 'react/jsx-runtime']);
    delete g.__RNLENS_REFRESH__;
    delete g.__RNLENS_HOT__;
  });
});

describe('topLevelRequires', () => {
  it('lists imports and re-exports as esbuild emits them, not nested requires', async () => {
    const source = [
      `import React from 'react';`,
      `import './side-effect';`,
      `import { a } from "./a";`,
      `export * from './b';`,
      `export { c } from './c';`,
      `export const lazy = () => require('./lazy');`,
      `export const value = [a, React];`,
    ].join('\n');
    const cjs = (await esbuild.transform(source, { loader: 'ts', format: 'cjs' })).code;
    expect(topLevelRequires(cjs)).toEqual(['react', './side-effect', './a', './b', './c']);
  });
});
