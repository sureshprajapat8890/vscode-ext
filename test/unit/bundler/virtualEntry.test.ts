import { describe, expect, it } from 'vitest';
import { resolveExtensionsFor } from '../../../src/bundler/plugins/platformExtensions';
import { bundleKeyId } from '../../../src/bundler/types';
import { APP_KEY, generateEntry } from '../../../src/bundler/virtualEntry';

describe('generateEntry', () => {
  it('imports the runtime first, then the target by absolute path (escaping backslashes)', () => {
    const src = generateEntry({
      kind: 'component',
      file: 'C:\\app\\Button.tsx',
      exportName: 'Primary',
    });
    const lines = src.split('\n');
    expect(lines[0]).toBe(`import { ErrorBoundary } from 'rnlens:runtime';`);
    expect(src).toContain(`import * as Target from "C:\\\\app\\\\Button.tsx";`);
    expect(src).toContain(`const Component = Target["Primary"];`);
    expect(src).toContain(`const Shown = Component;`);
    expect(src).toContain(`const Decorate = ({ children }) => children;`);
    expect(src).toContain(
      'createElement(ErrorBoundary, null, createElement(Decorate, null, createElement(Shown)))',
    );
    expect(src).toContain(`AppRegistry.registerComponent("${APP_KEY}"`);
    expect(src).toContain('globalThis.__RNLENS_ROOT__');
    expect(src).toContain(
      `AppRegistry.runApplication("${APP_KEY}", { rootTag: globalThis.__RNLENS_ROOT__ });`,
    );
    // Unmounting is the runtime's job (it tracks every React root the bundle creates).
    expect(src).not.toContain('__RNLENS_UNMOUNT__');
    expect(src).not.toContain('Variants');
  });

  it('renders a variant and wraps in decorators when given', () => {
    const src = generateEntry(
      {
        kind: 'component',
        file: '/p/Button.tsx',
        exportName: 'Button',
        variant: { file: '/p/Button.preview.tsx', name: 'Disabled' },
      },
      '/p/.rnlens/decorators.tsx',
    );
    expect(src).toContain(`import * as Variants from "/p/Button.preview.tsx";`);
    expect(src).toContain(`const Shown = Variants["Disabled"];`);
    expect(src).toContain(`import Decorators from "/p/.rnlens/decorators.tsx";`);
    expect(src).toContain(`const Decorate = Decorators;`);
    expect(src).toContain('must default-export a component');
  });

  it('renders props variants from the component file previews object', () => {
    const src = generateEntry({
      kind: 'component',
      file: '/p/Card.tsx',
      exportName: 'Card',
      variant: { kind: 'props', file: '/p/Card.tsx', name: 'Primary' },
    });
    expect(src).not.toContain('import * as Variants');
    expect(src).toContain('const previews = Target.previews || {};');
    expect(src).toContain('const forExport = previews["Card"];');
    expect(src).toContain('const Shown = () => createElement(Component, variantProps);');
    expect(() => new Function(src.replace(/^import .*$/gm, ''))).not.toThrow();
  });

  it('runs app entries, falling back to the last registered app when nothing rendered', () => {
    const src = generateEntry({ kind: 'app', file: '/p/index.ts', mode: 'module' });
    expect(src).toContain(`import { ErrorBoundary, mountedRootCount } from 'rnlens:runtime';`);
    expect(src).toContain(`import "/p/index.ts";`);
    expect(src).toContain('AppRegistry.setWrapperComponentProvider(() => ErrorBoundary);');
    expect(src).toContain('if (mountedRootCount() === 0) {');
    expect(src).toContain('AppRegistry.runApplication(keys[keys.length - 1]');
    expect(src).not.toContain('Decorators');
    expect(() => new Function(src.replace(/^import .*$/gm, ''))).not.toThrow();
  });

  it('registers a root component for component-mode apps', () => {
    const src = generateEntry({ kind: 'app', file: '/p/App.tsx', mode: 'component' });
    expect(src).toContain(`import * as Root from "/p/App.tsx";`);
    expect(src).toContain(`AppRegistry.registerComponent('main', () => Root.default);`);
    expect(() => new Function(src.replace(/^import .*$/gm, ''))).not.toThrow();
  });

  it('cannot be broken out of by quotes in names', () => {
    const src = generateEntry({ kind: 'component', file: '/a/"x".tsx', exportName: 'a"b' });
    expect(src).toContain(`from "/a/\\"x\\".tsx"`);
    expect(src).toContain(`const Component = Target["a\\"b"];`);
    expect(() => new Function(src.replace(/^import .*$/gm, ''))).not.toThrow();
  });
});

describe('resolveExtensionsFor', () => {
  it('orders web, platform, native, then plain for ios/android', () => {
    const exts = resolveExtensionsFor('android');
    expect(exts.slice(0, 4)).toEqual(['.web.tsx', '.web.ts', '.web.jsx', '.web.js']);
    expect(exts.indexOf('.android.tsx')).toBeLessThan(exts.indexOf('.native.tsx'));
    expect(exts.indexOf('.native.js')).toBeLessThan(exts.indexOf('.tsx'));
    expect(exts.slice(-7)).toEqual(['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json']);
    expect(exts).not.toContain('.ios.tsx');
  });

  it('never prefers native files when simulating web', () => {
    const exts = resolveExtensionsFor('web');
    expect(exts.some((e) => e.includes('native') || e.includes('ios'))).toBe(false);
    expect(exts[0]).toBe('.web.tsx');
  });
});

describe('bundleKeyId', () => {
  it('distinguishes platforms, files and exports', () => {
    const base = {
      projectRoot: '/p',
      platform: 'ios' as const,
      target: { kind: 'component' as const, file: '/p/A.tsx', exportName: 'default' },
    };
    const ids = new Set([
      bundleKeyId(base),
      bundleKeyId({ ...base, platform: 'android' }),
      bundleKeyId({ ...base, target: { ...base.target, file: '/p/B.tsx' } }),
      bundleKeyId({ ...base, target: { ...base.target, exportName: 'A' } }),
    ]);
    expect(ids.size).toBe(4);
    expect(bundleKeyId(base)).toBe(bundleKeyId({ ...base, target: { ...base.target } }));
  });
});
