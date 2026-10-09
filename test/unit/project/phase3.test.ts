import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { detectAppEntry } from '../../../src/project/appEntry';
import { readBabelAliases } from '../../../src/project/babelAliases';
import { loadProjectConfig } from '../../../src/project/config';
import { collectImportUsage, generateMockStub, mockFilePath } from '../../../src/project/mockStub';

const fixtures = path.join(__dirname, '../fixtures');
const aliasProject = path.join(fixtures, 'alias-project');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'rnlens-p3-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmp, 'proj-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

describe('detectAppEntry', () => {
  it('honours rnLens.entry, and explains a missing one', () => {
    const root = project({ 'package.json': '{}', 'src/main.tsx': '' });
    expect(detectAppEntry(root, 'ios', 'src/main')).toMatchObject({
      file: path.join(root, 'src', 'main.tsx'),
      mode: 'module',
    });
    expect(detectAppEntry(root, 'ios', 'nope.tsx')).toMatchObject({
      error: expect.stringContaining('rnLens.entry setting points to "nope.tsx"'),
    });
  });

  it('uses package.json main, local or package', () => {
    const local = project({ 'package.json': JSON.stringify({ main: 'index.ts' }), 'index.ts': '' });
    expect(detectAppEntry(local, 'ios')).toMatchObject({ file: path.join(local, 'index.ts') });
    const missing = project({ 'package.json': JSON.stringify({ main: 'expo/AppEntry' }) });
    expect(detectAppEntry(missing, 'ios')).toMatchObject({
      error: expect.stringContaining('package.json "main" is "expo/AppEntry"'),
    });
  });

  it('detects expo-router, with friendly errors when it is incomplete', () => {
    const noInstall = project({
      'package.json': JSON.stringify({ main: 'expo-router/entry' }),
      'app/index.tsx': '',
    });
    expect(detectAppEntry(noInstall, 'ios')).toMatchObject({
      error: expect.stringContaining("expo-router isn't installed"),
    });
    const router = path.join(fixtures, '..', '..', 'fixtures', 'router-app');
    expect(detectAppEntry(router, 'ios')).toMatchObject({
      mode: 'module',
      routerAppDir: path.join(router, 'app'),
      description: 'expo-router',
    });
  });

  it('falls back to index.<platform>, then index, then App as a root component', () => {
    const platformIndex = project({ 'package.json': '{}', 'index.android.js': '', 'index.js': '' });
    expect(detectAppEntry(platformIndex, 'android')).toMatchObject({
      file: path.join(platformIndex, 'index.android.js'),
    });
    expect(detectAppEntry(platformIndex, 'ios')).toMatchObject({
      file: path.join(platformIndex, 'index.js'),
    });
    const appOnly = project({ 'package.json': '{}', 'App.tsx': '' });
    expect(detectAppEntry(appOnly, 'ios')).toMatchObject({
      file: path.join(appOnly, 'App.tsx'),
      mode: 'component',
    });
    expect(detectAppEntry(project({ 'package.json': '{}' }), 'ios')).toMatchObject({
      error: expect.stringContaining("couldn't find an app entry"),
    });
  });
});

describe('readBabelAliases', () => {
  it('reads module-resolver roots and string aliases statically, skipping regex aliases', () => {
    expect(readBabelAliases(aliasProject)).toEqual({
      aliases: { '@ui': path.join(aliasProject, 'src', 'ui'), lodash: 'lodash-es' },
      roots: [path.join(aliasProject, 'src')],
      source: path.join(aliasProject, 'babel.config.js'),
    });
  });

  it('reads JSON .babelrc files and tolerates configs without the plugin', () => {
    const rc = project({
      '.babelrc': JSON.stringify({
        plugins: [['babel-plugin-module-resolver', { root: './lib', alias: { '#': './lib' } }]],
      }),
    });
    expect(readBabelAliases(rc)).toMatchObject({
      aliases: { '#': path.join(rc, 'lib') },
      roots: [path.join(rc, 'lib')],
    });
    const plain = project({ 'babel.config.js': "module.exports = { presets: ['x'] };" });
    expect(readBabelAliases(plain)).toMatchObject({ aliases: {}, roots: [] });
    expect(readBabelAliases(project({}))).toEqual({ aliases: {}, roots: [], source: undefined });
  });
});

describe('loadProjectConfig', () => {
  const configFile = `module.exports = {
    decorators: './.rnlens/wrap.tsx',
    define: { 'process.env.API': '"http://x"' },
    mocks: { 'react-native-maps': './mocks/maps.tsx' },
    aliases: { '@app': './src' },
    esbuildPlugins: [{ name: 'user', setup() {} }, 'not a plugin'],
    surprise: true,
  };`;

  it('merges babel aliases, extraAliases and rnlens.config.js in a trusted workspace', async () => {
    const root = project({ 'rnlens.config.js': configFile });
    const importModule = vi.fn(async () => ({
      default: {
        decorators: './.rnlens/wrap.tsx',
        define: { 'process.env.API': '"http://x"' },
        mocks: { 'react-native-maps': './mocks/maps.tsx' },
        aliases: { '@app': './src' },
        esbuildPlugins: [{ name: 'user', setup() {} }, 'not a plugin'],
        surprise: true,
      },
    }));
    const config = await loadProjectConfig(root, {
      extraAliases: { '@lib': './lib', bad: 42 },
      trusted: true,
      importModule,
    });
    expect(importModule).toHaveBeenCalledWith(path.join(root, 'rnlens.config.js'));
    expect(config).toMatchObject({
      decorators: path.join(root, '.rnlens', 'wrap.tsx'),
      define: { 'process.env.API': '"http://x"' },
      mocks: { 'react-native-maps': path.join(root, 'mocks', 'maps.tsx') },
      aliases: { '@lib': path.join(root, 'lib'), '@app': path.join(root, 'src') },
    });
    expect(config.plugins.map((p) => p.name)).toEqual(['user']);
    expect(config.notes.join('\n')).toMatch(/Ignored rnLens\.extraAliases\["bad"\]/);
    expect(config.notes.join('\n')).toMatch(/ignored unknown option\(s\) surprise/);
  });

  it('never runs rnlens.config.js in an untrusted workspace', async () => {
    const root = project({ 'rnlens.config.js': configFile });
    const importModule = vi.fn();
    const config = await loadProjectConfig(root, {
      extraAliases: {},
      trusted: false,
      importModule,
    });
    expect(importModule).not.toHaveBeenCalled();
    expect(config.plugins).toEqual([]);
    expect(config.notes.join('\n')).toMatch(
      /wasn't loaded|was not loaded because this workspace isn't trusted/,
    );
  });

  it('reports configs that fail to load or export the wrong thing', async () => {
    const root = project({ 'rnlens.config.js': '' });
    await expect(
      loadProjectConfig(root, {
        extraAliases: {},
        trusted: true,
        importModule: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    ).rejects.toThrow(/rnlens\.config\.js failed to load: Unexpected token/);
    await expect(
      loadProjectConfig(root, {
        extraAliases: {},
        trusted: true,
        importModule: async () => ({ default: 42 }),
      }),
    ).rejects.toThrow(/must export an object/);
  });

  it('really imports a CommonJS config with the default loader', async () => {
    const root = project({ 'rnlens.config.js': "module.exports = { define: { A: '1' } };" });
    const config = await loadProjectConfig(root, { extraAliases: {}, trusted: true });
    expect(config.define).toEqual({ A: '1' });
  });
});

describe('mock stubs', () => {
  it('collects default and named value imports across files', () => {
    const usage = collectImportUsage(
      [
        `import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';`,
        `import { animateTo, Marker as M2 } from 'react-native-maps'; import x from 'other';`,
        `import type { Camera } from 'react-native-maps';`,
        'this is not { valid',
      ],
      'react-native-maps',
    );
    expect(usage).toEqual({
      defaultName: 'MapView',
      named: ['Marker', 'PROVIDER_GOOGLE', 'animateTo'],
    });
  });

  it('generates components, functions and constants for what is used', () => {
    const { source, tsx } = generateMockStub('react-native-maps', {
      defaultName: 'MapView',
      named: ['Marker', 'PROVIDER_GOOGLE', 'animateTo'],
    });
    expect(tsx).toBe(true);
    expect(source).toContain(`import { View } from 'react-native';`);
    expect(source).toContain('export function Marker({ children, style }: MockProps) {');
    expect(source).toContain('export function animateTo(..._args: unknown[]): undefined {');
    expect(source).toContain('export const PROVIDER_GOOGLE: unknown = "provider_google";');
    expect(source).toContain('export default function MapView({ children, style }: MockProps) {');
  });

  it('generates plain .ts modules when nothing is a component', () => {
    expect(generateMockStub('x', { defaultName: 'storage', named: [] })).toMatchObject({
      tsx: false,
      source: expect.stringContaining('export default storage;'),
    });
    expect(generateMockStub('x', { defaultName: undefined, named: [] }).source).toContain(
      'export default {};',
    );
    expect(mockFilePath('/p', '@scope/pkg', true)).toBe(
      path.join('/p', '.rnlens', 'mocks', '@scope', 'pkg.tsx'),
    );
  });
});
