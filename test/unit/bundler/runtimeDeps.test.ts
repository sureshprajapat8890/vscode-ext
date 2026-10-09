import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultLocate,
  defaultReadText,
  resolveRuntimeDeps,
  type LocatePackage,
  type ReadText,
} from '../../../src/bundler/runtimeDeps';

const PROJECT = '/proj';
const VENDOR = '/ext/vendor';

/** Fake package layout: `{ '/proj': { react: '19.2.3' } }` → /proj/node_modules/react/package.json. */
function layout(dirs: Record<string, Record<string, string>>): {
  locate: LocatePackage;
  read: ReadText;
} {
  const files = new Map<string, string>();
  for (const [dir, pkgs] of Object.entries(dirs)) {
    for (const [name, version] of Object.entries(pkgs)) {
      files.set(`${dir}/node_modules/${name}/package.json`, JSON.stringify({ name, version }));
    }
  }
  return {
    locate: (name, from) => {
      const p = `${from}/node_modules/${name}/package.json`;
      return files.has(p) ? p : undefined;
    },
    read: async (p) => files.get(p),
  };
}

const vendor = { react: '19.2.8', 'react-dom': '19.2.8', 'react-native-web': '0.21.4' };

describe('resolveRuntimeDeps', () => {
  it('uses the project pair when react and react-dom match', async () => {
    const { locate, read } = layout({
      [PROJECT]: { react: '19.1.0', 'react-dom': '19.1.0', 'react-native-web': '0.20.0' },
      [VENDOR]: vendor,
    });
    expect(await resolveRuntimeDeps(PROJECT, VENDOR, locate, read)).toEqual({
      reactResolveDir: PROJECT,
      reactSource: 'project',
      reactVersion: '19.1.0',
      rnwResolveDir: PROJECT,
      rnwSource: 'project',
      rnwVersion: '0.20.0',
      warnings: [],
    });
  });

  it('falls back to the vendor pair when react-dom is missing, with guidance', async () => {
    const { locate, read } = layout({ [PROJECT]: { react: '19.2.3' }, [VENDOR]: vendor });
    const deps = await resolveRuntimeDeps(PROJECT, VENDOR, locate, read);
    expect(deps).toMatchObject({
      reactResolveDir: VENDOR,
      reactSource: 'vendor',
      reactVersion: '19.2.8',
      rnwResolveDir: VENDOR,
      rnwSource: 'vendor',
    });
    expect(deps.warnings).toHaveLength(1);
    expect(deps.warnings[0]).toMatch(/no react-dom.*install react-dom@19\.2\.3/);
  });

  it('falls back to vendor when project react and react-dom versions differ', async () => {
    const { locate, read } = layout({
      [PROJECT]: { react: '19.1.0', 'react-dom': '19.0.0' },
      [VENDOR]: vendor,
    });
    const deps = await resolveRuntimeDeps(PROJECT, VENDOR, locate, read);
    expect(deps.reactSource).toBe('vendor');
    expect(deps.warnings[0]).toMatch(/different versions/);
  });

  it('warns on a React major mismatch with the vendor copy', async () => {
    const { locate, read } = layout({ [PROJECT]: { react: '18.3.1' }, [VENDOR]: vendor });
    const deps = await resolveRuntimeDeps(PROJECT, VENDOR, locate, read);
    expect(deps.warnings).toHaveLength(2);
    expect(deps.warnings[1]).toMatch(/React 18 but the preview renders with React 19/);
  });

  it('uses vendor silently when the project has no react at all', async () => {
    const { locate, read } = layout({ [VENDOR]: vendor });
    const deps = await resolveRuntimeDeps(PROJECT, VENDOR, locate, read);
    expect(deps.reactSource).toBe('vendor');
    expect(deps.warnings).toEqual([]);
  });

  it('throws a clear error when vendor packages are missing', async () => {
    const { locate, read } = layout({ [VENDOR]: { react: '19.2.8' } });
    await expect(resolveRuntimeDeps(PROJECT, VENDOR, locate, read)).rejects.toThrow(
      /bundled React packages are missing/,
    );
  });

  it('treats unreadable or invalid package.json as missing', async () => {
    const { locate } = layout({ [PROJECT]: { react: 'x', 'react-dom': 'x' }, [VENDOR]: vendor });
    const read: ReadText = async (p) =>
      p.startsWith(PROJECT)
        ? p.includes('react-dom')
          ? '{ nope'
          : JSON.stringify({ version: 1 })
        : JSON.stringify({ version: p.includes('react-native-web') ? '0.21.4' : '19.2.8' });
    const deps = await resolveRuntimeDeps(PROJECT, VENDOR, locate, read);
    expect(deps.reactSource).toBe('vendor');
    expect(deps.warnings).toEqual([]);
  });
});

describe('default locate/read', () => {
  const vendorDir = path.resolve(__dirname, '../../../vendor');

  it('locates real packages and reads their versions', async () => {
    const pkg = defaultLocate('react', vendorDir);
    expect(pkg).toBeDefined();
    expect(await defaultReadText(pkg as string)).toContain('"name": "react"');
  });

  it('returns undefined for missing packages and files', async () => {
    expect(defaultLocate('definitely-not-installed-xyz', vendorDir)).toBeUndefined();
    expect(await defaultReadText(path.join(vendorDir, 'nope.json'))).toBeUndefined();
  });
});
