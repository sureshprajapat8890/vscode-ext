import { describe, expect, it } from 'vitest';
import { planDelivery, planUpdate, type ModuleRecord } from '../../../src/bundler/refresh/hotPlan';

const rec = (hash: string, isBoundary: boolean): ModuleRecord => ({ hash, isBoundary });
const ENTRY = 'rnlens-entry:entry';

// entry → Screen (boundary) → Button (boundary), Screen → theme (not a boundary), Button → theme
const importers = new Map<string, string[]>([
  ['Screen', [ENTRY]],
  ['Button', ['Screen']],
  ['theme', ['Screen', 'Button']],
  ['index', [ENTRY]],
]);

function modules(overrides: Record<string, ModuleRecord> = {}): Map<string, ModuleRecord> {
  return new Map(
    Object.entries({
      Screen: rec('s1', true),
      Button: rec('b1', true),
      theme: rec('t1', false),
      ...overrides,
    }),
  );
}

describe('planUpdate', () => {
  it('fully reloads on the first build', () => {
    expect(planUpdate(undefined, modules(), importers)).toEqual({
      kind: 'full',
      reason: 'first build',
    });
  });

  it('re-runs only a changed component-only module', () => {
    expect(planUpdate(modules(), modules({ Button: rec('b2', true) }), importers)).toEqual({
      kind: 'hot',
      reexecute: ['Button'],
    });
  });

  it('re-runs importers of a changed non-component module, stopping at boundaries', () => {
    expect(planUpdate(modules(), modules({ theme: rec('t2', false) }), importers)).toEqual({
      kind: 'hot',
      reexecute: ['Button', 'Screen', 'theme'],
    });
  });

  it('fully reloads when a non-boundary change reaches the entry', () => {
    const plan = planUpdate(modules(), modules({ Screen: rec('s2', false) }), importers);
    expect(plan).toMatchObject({
      kind: 'full',
      reason: expect.stringContaining('Screen exports more than components'),
    });
    const index = new Map([['index', rec('i1', false)]]);
    expect(planUpdate(index, new Map([['index', rec('i2', false)]]), importers).kind).toBe('full');
  });

  it('treats new modules as changed and reports nothing to do when nothing changed', () => {
    const next = modules({ Badge: rec('x', true) });
    expect(planUpdate(modules(), next, importers)).toEqual({ kind: 'hot', reexecute: ['Badge'] });
    expect(planUpdate(modules(), modules(), importers)).toEqual({ kind: 'hot', reexecute: [] });
  });
});

describe('planDelivery', () => {
  const delivered = (vendorVersion = 'v1', entryHash = 'e1', overrides = {}, contextId = 'c') => ({
    contextId,
    vendorVersion,
    entryHash,
    modules: modules(overrides),
  });

  it('plans against what the webview runs: first, new vendor, new entry, else module changes', () => {
    expect(planDelivery(undefined, delivered(), importers)).toEqual({
      kind: 'full',
      reason: 'first build',
    });
    expect(
      planDelivery(delivered(), delivered('v1', 'e1', {}, 'android'), importers),
    ).toMatchObject({
      reason: 'the preview target or platform changed',
    });
    expect(planDelivery(delivered(), delivered('v2'), importers)).toMatchObject({
      reason: 'the app uses new modules',
    });
    expect(planDelivery(delivered(), delivered('v1', 'e2'), importers)).toMatchObject({
      reason: 'the preview target changed',
    });
    expect(
      planDelivery(delivered(), delivered('v1', 'e1', { Button: rec('b2', true) }), importers),
    ).toEqual({ kind: 'hot', reexecute: ['Button'] });
  });
});
