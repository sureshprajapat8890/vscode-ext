import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPanelTarget } from '../../../src/preview/protocol';
import { findVariantFile, isVariantFile, listVariants } from '../../../src/preview/variants';
import { formatArgs, serialize } from '../../../webview/consoleBridge';
import { customDevice, DEVICES, findDevice, orient } from '../../../webview/devices';

const components = path.join(__dirname, '../fixtures/hello-project/components');

describe('variants', () => {
  it('finds the colocated .preview file and lists its named components in order', async () => {
    const file = findVariantFile(path.join(components, 'Button.tsx'));
    expect(file).toBe(path.join(components, 'Button.preview.tsx'));
    expect(await listVariants(file as string)).toEqual(['Primary', 'Disabled']);
  });

  it('has no variants for preview files themselves or components without one', async () => {
    expect(findVariantFile(path.join(components, 'Button.preview.tsx'))).toBeUndefined();
    expect(findVariantFile(path.join(components, 'Hello.tsx'))).toBeUndefined();
    expect(await listVariants(path.join(components, 'missing.preview.tsx'))).toEqual([]);
    expect(isVariantFile('a/Button.preview.jsx')).toBe(true);
    expect(isVariantFile('a/Button.tsx')).toBe(false);
  });
});

describe('isPanelTarget', () => {
  it('validates persisted panel state', () => {
    expect(
      isPanelTarget({ file: '/a.tsx', exportName: 'default', label: 'A', variant: null }),
    ).toBe(true);
    expect(isPanelTarget({ file: '/a.tsx', exportName: 'A', label: 'A', variant: 'Primary' })).toBe(
      true,
    );
    expect(isPanelTarget({ file: '/a.tsx', exportName: 'A', label: 'A' })).toBe(false);
    expect(isPanelTarget({ file: 1, exportName: 'A', label: 'A', variant: null })).toBe(false);
    expect(isPanelTarget(undefined)).toBe(false);
  });
});

describe('console serialization', () => {
  it('formats primitives, nesting, cycles and errors like console.log', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(formatArgs(['text', 1, true, null, undefined, 2n, Symbol('s')])).toBe(
      'text 1 true null undefined 2n Symbol(s)',
    );
    expect(serialize({ a: [1, 'x', { b: new Map([['k', 1]]) }], 'odd-key': new Set([1]) })).toBe(
      '{a: [1, "x", {b: Map(1) {"k" => 1}}], "odd-key": Set(1) {1}}',
    );
    expect(serialize(cyclic)).toBe('{a: 1, self: [Circular]}');
    expect(serialize(function named() {})).toBe('[Function named]');
    expect(serialize(new Error('boom'))).toMatch(/^Error: boom/);
    class Point {
      x = 1;
    }
    expect(serialize(new Point())).toBe('Point {x: 1}');
  });

  it('limits depth, survives throwing getters, and truncates long messages', () => {
    expect(serialize({ a: { b: { c: { d: { e: 1 } } } } })).toBe('{a: {b: {c: {d: [Object]}}}}');
    const tricky = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(serialize(tricky)).toBe('{bad: [Thrown: nope]}');
    const long = formatArgs(['x'.repeat(20_000)]);
    expect(long.length).toBeLessThan(10_300);
    expect(long.endsWith('… (truncated)')).toBe(true);
  });
});

describe('devices', () => {
  it('includes the PRD presets with their logical sizes', () => {
    expect(DEVICES.map((d) => [d.id, d.width, d.height])).toEqual([
      ['iphone-se', 375, 667],
      ['iphone-15', 393, 852],
      ['iphone-15-pro-max', 430, 932],
      ['pixel-8', 412, 915],
      ['galaxy-s24', 360, 780],
      ['ipad-10', 820, 1180],
    ]);
    expect(findDevice('nope')).toBeUndefined();
  });

  it('swaps size and moves insets in landscape', () => {
    const iphone = findDevice('iphone-15');
    expect(iphone && orient(iphone, false)).toEqual({
      width: 393,
      height: 852,
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
      showStatusBar: true,
    });
    expect(iphone && orient(iphone, true)).toEqual({
      width: 852,
      height: 393,
      insets: { top: 0, right: 59, bottom: 21, left: 59 },
      showStatusBar: false,
    });
    const ipad = findDevice('ipad-10');
    expect(ipad && orient(ipad, true).showStatusBar).toBe(true);
  });

  it('builds chrome-less custom devices', () => {
    expect(customDevice(500, 900)).toMatchObject({
      id: 'custom',
      width: 500,
      height: 900,
      isTablet: false,
    });
    expect(customDevice(800, 1000).isTablet).toBe(true);
    expect(orient(customDevice(500, 900), false).showStatusBar).toBe(false);
  });
});
