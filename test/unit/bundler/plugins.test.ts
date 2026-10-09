import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { imageSize } from '../../../src/bundler/imageSize';
import { assetsPlugin, pickDensity, scaleOf } from '../../../src/bundler/plugins/assets';
import {
  createFlowStripMemory,
  flowStripPlugin,
  looksLikeFlow,
} from '../../../src/bundler/plugins/flowStrip';
import { autoMockSource, findProjectMocks } from '../../../src/bundler/plugins/mockRegistry';
import {
  findPlatformSpecificNames,
  findPlatformVariant,
  platformExtensionsPlugin,
} from '../../../src/bundler/plugins/platformExtensions';
import { redirect } from '../../../src/bundler/plugins/redirect';
import { webCapablePlugin } from '../../../src/bundler/plugins/webCapable';
import {
  parseDotenv,
  projectDefines,
  readDotenv,
  readExpoConfig,
} from '../../../src/bundler/projectEnv';

const fixtures = path.join(__dirname, '../fixtures');
const hello = path.join(fixtures, 'hello-project');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'rnlens-plugins-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('imageSize', () => {
  it('reads PNG, GIF, BMP and JPEG headers', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });

    expect(imageSize(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0))).toEqual({
      width: 10,
      height: 20,
    });

    const bmp = new Uint8Array(26);
    bmp.set([0x42, 0x4d]);
    new DataView(bmp.buffer).setInt32(18, 33, true);
    new DataView(bmp.buffer).setInt32(22, -44, true);
    expect(imageSize(bmp)).toEqual({ width: 33, height: 44 });

    // SOI, an APP0 segment, then SOF0 with height 300 and width 200.
    const jpeg = bytes(
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      4,
      0,
      0,
      0xff,
      0xff,
      0xc0,
      0,
      17,
      8,
      1,
      44,
      0,
      200,
      3,
      0,
      0,
      0,
      0,
    );
    expect(imageSize(jpeg)).toEqual({ width: 200, height: 300 });
  });

  it('reads the three WebP variants', () => {
    const webp = (chunk: string, fill: (b: Uint8Array) => void): Uint8Array => {
      const b = new Uint8Array(30);
      b.set(
        [...'RIFF'].map((c) => c.charCodeAt(0)),
        0,
      );
      b.set(
        [...'WEBP'].map((c) => c.charCodeAt(0)),
        8,
      );
      b.set(
        [...chunk].map((c) => c.charCodeAt(0)),
        12,
      );
      fill(b);
      return b;
    };
    const lossy = webp('VP8 ', (b) => {
      new DataView(b.buffer).setUint16(26, 120, true);
      new DataView(b.buffer).setUint16(28, 90, true);
    });
    expect(imageSize(lossy)).toEqual({ width: 120, height: 90 });
    const lossless = webp('VP8L', (b) =>
      new DataView(b.buffer).setUint32(21, (99 & 0x3fff) | ((49 & 0x3fff) << 14), true),
    );
    expect(imageSize(lossless)).toEqual({ width: 100, height: 50 });
    const extended = webp('VP8X', (b) => b.set([255, 1, 0, 127, 0, 0], 24));
    expect(imageSize(extended)).toEqual({ width: 512, height: 128 });
    expect(imageSize(webp('XXXX', () => undefined))).toBeUndefined();
  });

  it('returns undefined for unknown or truncated data', () => {
    expect(imageSize(bytes(1, 2, 3))).toBeUndefined();
    expect(imageSize(bytes(0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0))).toBeUndefined();
  });
});

describe('density selection', () => {
  const existing = new Set(['/a/img.png', '/a/img@2x.png', '/a/only@3x.png', '/a/only.png']);
  const exists = (f: string) => existing.has(f);

  it('prefers the highest available density and keeps explicit or missing paths', () => {
    expect(pickDensity('/a/img.png', exists)).toBe('/a/img@2x.png');
    expect(pickDensity('/a/only.png', exists)).toBe('/a/only@3x.png');
    expect(pickDensity('/a/img@2x.png', exists)).toBe('/a/img@2x.png');
    expect(pickDensity('/a/missing.png', exists)).toBe('/a/missing.png');
  });

  it('parses the scale suffix', () => {
    expect(scaleOf('a@3x.png')).toBe(3);
    expect(scaleOf('a@1.5x.png')).toBe(1.5);
    expect(scaleOf('a.png')).toBe(1);
  });
});

describe('assetsPlugin', () => {
  it('exports fonts as URLs and leaves unresolvable images to esbuild', async () => {
    const dir = path.join(tmp, 'fonts');
    rmSync(dir, { recursive: true, force: true });
    const fontDir = mkdtempSync(path.join(tmp, 'font-src-'));
    writeFileSync(path.join(fontDir, 'Small.ttf'), Buffer.alloc(10));
    writeFileSync(path.join(fontDir, 'Big.otf'), Buffer.alloc(200 * 1024));
    writeFileSync(path.join(fontDir, 'weird.png'), 'not really a png');
    const result = await esbuild.build({
      stdin: {
        contents: `export { default as small } from './Small.ttf'; export { default as big } from './Big.otf'; export { default as weird } from './weird.png';`,
        resolveDir: fontDir,
      },
      bundle: true,
      write: false,
      format: 'esm',
      plugins: [assetsPlugin({ cacheDir: dir })],
    });
    const js = result.outputFiles[0].text;
    expect(js).toContain('data:font/ttf;base64,');
    expect(js).toMatch(/__RNLENS_ASSET_BASE__ \+ "\/[0-9a-f]{40}\.otf"/);
    expect(js).toMatch(/width: (?:void 0|undefined)/);
    expect(readdirSync(dir)).toHaveLength(1);

    await expect(
      esbuild.build({
        stdin: { contents: `import './nope.png';`, resolveDir: fontDir },
        bundle: true,
        write: false,
        logLevel: 'silent',
        plugins: [assetsPlugin({ cacheDir: dir })],
      }),
    ).rejects.toThrow(/Could not resolve/);
  });
});

describe('flowStrip', () => {
  it('detects Flow by pragma anywhere in the header or by type-only imports', () => {
    expect(looksLikeFlow('/**\n * Copyright\n *\n * @flow strict\n */\nexport const a = 1;')).toBe(
      true,
    );
    expect(looksLikeFlow('// @flow\nconst a = 1;')).toBe(true);
    expect(looksLikeFlow("import type { A } from './a';")).toBe(true);
    expect(looksLikeFlow('export type Props = {| a: string |};')).toBe(true);
    expect(looksLikeFlow('const a = 1;\n// mentions @flow later')).toBe(false);
    expect(looksLikeFlow('export const type = 1;')).toBe(false);
  });

  it('reuses the disk cache in a new session and falls back when stripping fails', async () => {
    const cacheDir = mkdtempSync(path.join(tmp, 'flow-'));
    const build = (stripper: (s: string) => string) =>
      esbuild.build({
        stdin: { contents: `export { flowLabel } from 'flow-lib';`, resolveDir: hello },
        bundle: true,
        write: false,
        format: 'esm',
        logLevel: 'silent',
        plugins: [
          flowStripPlugin({
            cacheDir,
            memory: createFlowStripMemory(),
            loadStripper: async () => stripper,
          }),
        ],
      });
    const strip = vi.fn((s: string) =>
      s.replace(/:\s*\w+|\{\||\|\}|import type.*\n|export type.*\n/g, ''),
    );
    await build(strip);
    expect(strip).toHaveBeenCalledTimes(1);
    const second = vi.fn((source: string) => source);
    await build(second);
    expect(second).not.toHaveBeenCalled();

    rmSync(cacheDir, { recursive: true, force: true });
    await expect(
      build(() => {
        throw new Error('parse error');
      }),
    ).rejects.toThrow();
  });
});

describe('findProjectMocks', () => {
  it('finds file mocks, scoped mocks and index mocks, skipping declaration files', () => {
    const mocks = findProjectMocks(hello);
    expect([...mocks.keys()].sort()).toEqual(['@acme/native', 'dir-mock', 'react-native-maps']);
    expect(mocks.get('dir-mock')).toBe(
      path.join(hello, '.rnlens', 'mocks', 'dir-mock', 'index.ts'),
    );
  });

  it('returns nothing when the project has no mocks directory', () => {
    expect(findProjectMocks(path.join(fixtures, 'bare-project')).size).toBe(0);
  });

  it('generates auto-mock modules that warn and export a Proxy', () => {
    const src = autoMockSource('react-native-maps');
    expect(src).toContain(`require('rnlens:runtime/autoMock')`);
    expect(src).toContain('Add .rnlens/mocks/react-native-maps.ts');
    expect(src).toContain('module.exports = createAutoMock("react-native-maps")');
  });
});

describe('findPlatformVariant', () => {
  const files = new Set(['/p/Comp.ios.tsx', '/p/Comp.tsx', '/p/Thing.native.js', '/p/Exact.ts']);
  const exists = (f: string) => files.has(f);

  it('picks the most specific platform file', () => {
    expect(findPlatformVariant('/p/Comp', 'ios', exists)).toBe('/p/Comp.ios.tsx');
    expect(findPlatformVariant('/p/Comp', 'android', exists)).toBeUndefined();
    expect(findPlatformVariant('/p/Thing', 'android', exists)).toBe('/p/Thing.native.js');
    expect(findPlatformVariant('/p/Exact.ts', 'ios', exists)).toBeUndefined();
  });

  it('resolves platform index files inside directories', () => {
    const dir = path.join(hello, 'components', 'Screen');
    expect(findPlatformVariant(dir, 'ios')).toBe(path.join(dir, 'index.ios.tsx'));
    expect(findPlatformVariant(dir, 'android')).toBeUndefined();
  });
});

describe('findPlatformSpecificNames', () => {
  it('collects names with .ios/.android/.native variants, skipping node_modules', () => {
    expect([...findPlatformSpecificNames(hello)].sort()).toEqual(['Screen', 'label']);
    expect(findPlatformSpecificNames(path.join(fixtures, 'bare-project')).size).toBe(0);
  });

  it('registers no resolver at all when there is nothing platform-specific', async () => {
    const onResolve = vi.fn();
    const plugin = platformExtensionsPlugin('ios', new Set());
    await plugin.setup({ onResolve } as never);
    await platformExtensionsPlugin('web', new Set(['label'])).setup({ onResolve } as never);
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe('webCapablePlugin', () => {
  it('resolves listed packages via browser/module/main instead of react-native', async () => {
    const build = (pkgs: string[]) =>
      esbuild.build({
        stdin: { contents: `export { where } from 'webby';`, resolveDir: hello },
        bundle: true,
        write: false,
        format: 'esm',
        mainFields: ['react-native', 'module', 'main'],
        plugins: [webCapablePlugin(pkgs)],
      });
    expect((await build(['webby'])).outputFiles[0].text).toContain('web-build');
    expect((await build([])).outputFiles[0].text).toContain('native-source');
    expect((await build(['not-installed', 'webby'])).outputFiles[0].text).toContain('web-build');
  });
});

describe('redirect', () => {
  it('returns resolver errors for unresolvable targets', async () => {
    await expect(
      esbuild.build({
        stdin: { contents: `import 'anything';`, resolveDir: hello },
        bundle: true,
        write: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'test',
            setup(b) {
              b.onResolve({ filter: /^anything$/ }, (args) =>
                redirect(b, args, 'does-not-exist', hello),
              );
            },
          },
        ],
      }),
    ).rejects.toThrow(/does-not-exist/);
  });
});

describe('projectEnv', () => {
  it('parses dotenv syntax without evaluating anything', () => {
    expect(
      parseDotenv(
        [
          '# comment',
          'export A=1',
          'B = two words # trailing comment',
          `C="line\\nbreak \\"quoted\\""`,
          "D='single # not a comment'",
          'not a pair',
          'E=$(rm -rf /)',
          '',
        ].join('\r\n'),
      ),
    ).toEqual({
      A: '1',
      B: 'two words',
      C: 'line\nbreak "quoted"',
      D: 'single # not a comment',
      E: '$(rm -rf /)',
    });
  });

  it('layers .env files and reads the expo section of app.json', () => {
    expect(readDotenv(hello)).toEqual({
      EXPO_PUBLIC_API_URL: 'http://local.override',
      SECRET: 'shh',
    });
    expect(readExpoConfig(hello)).toEqual({ name: 'hello', slug: 'hello' });
    expect(readExpoConfig(path.join(fixtures, 'bare-project'))).toBeNull();
  });

  it('only exposes EXPO_PUBLIC_* variables as process.env defines', () => {
    const defines = projectDefines(hello);
    expect(defines['process.env.EXPO_PUBLIC_API_URL']).toBe('"http://local.override"');
    expect(defines['process.env.SECRET']).toBeUndefined();
    expect(JSON.parse(defines.__RNLENS_EXPO_CONFIG__)).toEqual({ name: 'hello', slug: 'hello' });
  });

  it('treats bad app.json as no config', () => {
    const dir = mkdtempSync(path.join(tmp, 'appjson-'));
    writeFileSync(path.join(dir, 'app.json'), '{ broken');
    expect(readExpoConfig(dir)).toBeNull();
    writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ expo: [1] }));
    expect(readExpoConfig(dir)).toBeNull();
  });
});
