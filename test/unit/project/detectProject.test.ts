import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectProjects,
  findProjectRoot,
  isWithin,
  parseRNPackageJson,
  type PathApi,
  type ReadFile,
} from '../../../src/project/detectProject';

function memoryFs(files: Record<string, string>): { read: ReadFile; reads: string[] } {
  const reads: string[] = [];
  const read: ReadFile = async (p) => {
    reads.push(p);
    return files[p];
  };
  return { read, reads };
}

const expoPkg = JSON.stringify({
  name: 'my-expo',
  dependencies: { expo: '~57.0.0', react: '19.2.3', 'react-native': '0.86.3' },
});
const barePkg = JSON.stringify({
  name: 'my-bare',
  dependencies: { react: '19.2.3', 'react-native': '0.86.3' },
});
const plainPkg = JSON.stringify({ name: 'monorepo', devDependencies: { typescript: '5.9.3' } });

describe('parseRNPackageJson', () => {
  it('detects Expo projects', () => {
    expect(parseRNPackageJson(expoPkg)).toEqual({
      kind: 'expo',
      name: 'my-expo',
      expoVersion: '~57.0.0',
      reactNativeVersion: '0.86.3',
      reactVersion: '19.2.3',
    });
  });

  it('detects bare React Native projects', () => {
    expect(parseRNPackageJson(barePkg)?.kind).toBe('bare');
  });

  it('detects react-native declared only in peer or dev dependencies', () => {
    const peer = JSON.stringify({ peerDependencies: { 'react-native': '*' } });
    expect(parseRNPackageJson(peer)?.reactNativeVersion).toBe('*');
    const dev = JSON.stringify({ devDependencies: { expo: '^57.0.0' } });
    expect(parseRNPackageJson(dev)?.kind).toBe('expo');
  });

  it('reports non-string versions as "*" and a missing name as undefined', () => {
    const pkg = JSON.stringify({ dependencies: { 'react-native': { version: 1 } } });
    expect(parseRNPackageJson(pkg)).toMatchObject({ reactNativeVersion: '*', name: undefined });
  });

  it.each([
    ['non-RN package', plainPkg],
    ['invalid JSON', '{ nope'],
    ['JSON array', '[]'],
    ['JSON null', 'null'],
    ['dependencies not an object', JSON.stringify({ dependencies: 'react-native' })],
  ])('returns undefined for %s', (_label, text) => {
    expect(parseRNPackageJson(text)).toBeUndefined();
  });
});

describe.each<[string, PathApi, string]>([
  ['posix', path.posix, '/work'],
  ['win32', path.win32, 'C:\\work'],
])('findProjectRoot (%s paths)', (_name, p, ws) => {
  const app = p.join(ws, 'apps', 'mobile');
  const files = {
    [p.join(ws, 'package.json')]: plainPkg,
    [p.join(app, 'package.json')]: expoPkg,
    [p.join(app, 'node_modules', 'expo', 'package.json')]: expoPkg,
  };

  it('finds the nearest RN package.json above a file', async () => {
    const { read } = memoryFs(files);
    const result = await findProjectRoot(
      p.join(app, 'src', 'components', 'Button.tsx'),
      ws,
      read,
      p,
    );
    expect(result).toMatchObject({
      root: app,
      packageJsonPath: p.join(app, 'package.json'),
      kind: 'expo',
      name: 'my-expo',
    });
  });

  it('skips package.json files inside node_modules', async () => {
    const { read, reads } = memoryFs(files);
    const result = await findProjectRoot(
      p.join(app, 'node_modules', 'expo', 'build', 'index.js'),
      ws,
      read,
      p,
    );
    expect(result?.root).toBe(app);
    expect(reads).not.toContain(p.join(app, 'node_modules', 'expo', 'package.json'));
  });

  it('stops at the boundary and returns undefined when nothing matches', async () => {
    const { read, reads } = memoryFs({ [p.join(ws, 'package.json')]: plainPkg });
    expect(await findProjectRoot(p.join(ws, 'lib', 'a.ts'), ws, read, p)).toBeUndefined();
    expect(reads).toEqual([p.join(ws, 'lib', 'package.json'), p.join(ws, 'package.json')]);
  });

  it('returns undefined for a start path outside the boundary', async () => {
    const { read, reads } = memoryFs(files);
    const outside = p.join(p.dirname(ws), 'elsewhere', 'a.ts');
    expect(await findProjectRoot(outside, ws, read, p)).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('accepts the boundary itself as the project root', async () => {
    const { read } = memoryFs({ [p.join(ws, 'package.json')]: barePkg });
    expect((await findProjectRoot(p.join(ws, 'App.tsx'), ws, read, p))?.root).toBe(ws);
  });

  it('ignores unreadable or invalid package.json files', async () => {
    const { read } = memoryFs({
      [p.join(app, 'package.json')]: '{ broken',
      [p.join(ws, 'package.json')]: barePkg,
    });
    expect((await findProjectRoot(p.join(app, 'App.tsx'), ws, read, p))?.root).toBe(ws);
  });

  it('detectProjects filters node_modules and sorts by root', async () => {
    const other = p.join(ws, 'apps', 'admin');
    const { read } = memoryFs({ ...files, [p.join(other, 'package.json')]: barePkg });
    const result = await detectProjects(
      [
        p.join(app, 'package.json'),
        p.join(ws, 'package.json'),
        p.join(app, 'node_modules', 'expo', 'package.json'),
        p.join(other, 'package.json'),
        p.join(ws, 'missing', 'package.json'),
      ],
      read,
      p,
    );
    expect(result.map((r) => [r.root, r.kind])).toEqual([
      [other, 'bare'],
      [app, 'expo'],
    ]);
  });
});

describe('isWithin', () => {
  it('handles equal, nested, sibling and parent paths', () => {
    expect(isWithin('/a', '/a', path.posix)).toBe(true);
    expect(isWithin('/a', '/a/b/c', path.posix)).toBe(true);
    expect(isWithin('/a', '/ab', path.posix)).toBe(false);
    expect(isWithin('/a/b', '/a', path.posix)).toBe(false);
  });

  it('treats different Windows drives as outside and ignores drive-letter case', () => {
    expect(isWithin('C:\\work', 'D:\\work\\x', path.win32)).toBe(false);
    expect(isWithin('C:\\work', 'c:\\work\\x', path.win32)).toBe(true);
  });
});
