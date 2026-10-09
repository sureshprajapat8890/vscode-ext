import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { missingPackages } from '../../../src/bundler/BundlerService';
import { aliasesPlugin } from '../../../src/bundler/plugins/aliases';
import {
  expoRouterDefines,
  listRouteFiles,
  routerContextSource,
} from '../../../src/bundler/plugins/expoRouter';
import { METRO_DEV_CLIENT_FILES } from '../../../src/bundler/plugins/metroDevClients';
import {
  projectSourceFilter,
  projectSourcePlugin,
} from '../../../src/bundler/plugins/projectSource';
import { loadProjectConfig } from '../../../src/project/config';
import { buildPreview, extensionPaths } from './previewBuild';
import {
  MockDiagnostics,
  findSpecifierRange,
  specifierOf,
} from '../../../src/diagnostics/mockDiagnostics';
import { Diagnostic, Range, Uri, diagnosticsState } from '../vscodeMock';

const fixtures = path.join(__dirname, '../fixtures');
const aliasProject = path.join(fixtures, 'alias-project');
const hello = path.join(fixtures, 'hello-project');
const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'rnlens-p3b-'));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

describe('expo-router context', () => {
  it('lists route files like require.context, excluding API routes, +html and declarations', () => {
    expect(listRouteFiles(path.join(aliasProject, 'app'))).toEqual([
      './(tabs)/home.tsx',
      './+not-found.tsx',
      './_layout.tsx',
      './index.tsx',
    ]);
    expect(listRouteFiles(path.join(aliasProject, 'missing'))).toEqual([]);
  });

  it('generates a ctx(key) module with keys() and resolve()', () => {
    const src = routerContextSource(path.join(aliasProject, 'app'));
    expect(src).toContain(
      `import * as route0 from ${JSON.stringify(path.join(aliasProject, 'app', './(tabs)/home.tsx'))};`,
    );
    expect(src).toContain('ctx.keys = () => Object.keys(routes);');
    expect(src).toContain('"./index.tsx": route3,');
  });

  it('defines the env values expo-router reads', () => {
    expect(expoRouterDefines(aliasProject, path.join(aliasProject, 'app'))).toEqual({
      'process.env.EXPO_ROUTER_APP_ROOT': '"./app"',
      'process.env.EXPO_ROUTER_ABS_APP_ROOT': JSON.stringify(path.join(aliasProject, 'app')),
      'process.env.EXPO_ROUTER_IMPORT_MODE': '"sync"',
    });
  });
});

describe('aliases (real esbuild)', () => {
  it('applies Babel module-resolver aliases and roots, with platform variants for aliased files', async () => {
    const config = await loadProjectConfig(aliasProject, { extraAliases: {}, trusted: false });
    const target = {
      kind: 'component' as const,
      file: path.join(aliasProject, 'src', 'Aliased.tsx'),
      exportName: 'Aliased',
    };
    const paths = extensionPaths(cacheDir);
    const build = async (platform: 'ios' | 'android') =>
      (await buildPreview({ projectRoot: aliasProject, target, platform, paths, config })).appJs;
    const ios = await build('ios');
    expect(ios).toContain('Button = "ios button"');
    expect(ios).toContain('s.toUpperCase()');
    expect(await build('android')).toContain('Button = "plain button"');
  }, 60_000);

  it('redirects package aliases', async () => {
    const result = await esbuild.build({
      stdin: { contents: `export * from 'my-plain';`, resolveDir: hello },
      bundle: true,
      write: false,
      format: 'esm',
      plugins: [aliasesPlugin({ 'my-plain': 'plain-lib' }, hello, 'ios')],
    });
    expect(result.outputFiles[0].text).toContain('plain = "plain"');
  });
});

describe('unsaved buffers', () => {
  it('builds a project-only filter that never matches node_modules', () => {
    const filter = projectSourceFilter(hello) as RegExp;
    expect(filter.test(path.join(hello, 'components', 'Hello.tsx'))).toBe(true);
    expect(filter.test(path.join(hello, 'node_modules', 'flow-lib', 'index.js'))).toBe(false);
    expect(filter.test(path.join(hello, 'components', 'img', 'dot.png'))).toBe(false);
    // Source files directly in the project root, but not other root files.
    const expo = path.join(fixtures, '../../fixtures/expo-app');
    const rootFiles = projectSourceFilter(expo) as RegExp;
    expect(rootFiles.test(path.join(expo, 'App.tsx'))).toBe(true);
    expect(rootFiles.test(path.join(expo, 'index.ts'))).toBe(true);
    expect(rootFiles.test(path.join(expo, 'app.json'))).toBe(false);
    expect(rootFiles.test(path.join(expo, 'App.tsx.bak'))).toBe(false);
    expect(projectSourceFilter(path.join(hello, 'missing'))).toBeUndefined();
  });

  it('serves unsaved contents, transforms once per content, records modules, reports errors', async () => {
    const file = path.join(hello, 'components', 'label.ts');
    const readUnsaved = vi.fn((f: string) =>
      path.normalize(f) === path.normalize(file) ? `export const label = 'unsaved';` : undefined,
    );
    const transform = vi.fn((source: string, options: esbuild.TransformOptions) =>
      esbuild.transform(source, options),
    );
    const cache = new Map();
    const modules = new Map<string, unknown>();
    const build = () =>
      esbuild.build({
        entryPoints: [file, path.join(hello, 'components', 'label.ios.ts')],
        bundle: true,
        write: false,
        outdir: path.join(cacheDir, 'out'),
        plugins: [
          projectSourcePlugin({
            projectRoot: hello,
            transform,
            readUnsaved,
            cache,
            onModule: (f, record) => modules.set(f, record),
          }),
        ],
      });
    const texts = (await build()).outputFiles.map((f) => f.text).join('\n');
    expect(texts).toContain('"unsaved"');
    expect(texts).toContain('"ios"');
    expect(readUnsaved).toHaveBeenCalledTimes(2);
    expect(modules.get(file)).toMatchObject({ isBoundary: false });
    await build();
    expect(transform).toHaveBeenCalledTimes(2); // unchanged files aren't transformed again

    await expect(
      esbuild.build({
        entryPoints: [path.join(hello, 'components', 'Broken.tsx')],
        bundle: true,
        write: false,
        logLevel: 'silent',
        plugins: [
          projectSourcePlugin({
            projectRoot: hello,
            transform,
            cache: new Map(),
            onModule: () => undefined,
          }),
        ],
      }),
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ location: expect.objectContaining({ line: 3 }) })],
    });
  });
});

describe('missingPackages', () => {
  const err = (text: string) => ({ text }) as esbuild.Message;
  it('returns bare packages only when every error is an unresolved package', () => {
    expect(
      missingPackages([
        err('Could not resolve "react-native-maps"'),
        err('Could not resolve "react-native-maps"'),
      ]),
    ).toEqual(['react-native-maps']);
    expect(missingPackages([err('Could not resolve "./Missing"')])).toBeUndefined();
    expect(
      missingPackages([err('Could not resolve "a"'), err('Expected ";" but found ":"')]),
    ).toBeUndefined();
    expect(missingPackages([])).toBeUndefined();
  });
});

describe('Metro dev clients', () => {
  it("matches only Expo's async-require dev clients", () => {
    expect(METRO_DEV_CLIENT_FILES.test('/p/node_modules/expo/src/async-require/setupHMR.ts')).toBe(
      true,
    );
    expect(
      METRO_DEV_CLIENT_FILES.test('C:\\p\\node_modules\\expo\\src\\async-require\\setup.ts'),
    ).toBe(true);
    expect(METRO_DEV_CLIENT_FILES.test('/p/node_modules/expo/src/async-require/index.ts')).toBe(
      false,
    );
    expect(METRO_DEV_CLIENT_FILES.test('/p/src/async-require/setup.ts')).toBe(false);
  });
});

describe('MockDiagnostics', () => {
  beforeEach(() => diagnosticsState.clear());

  it('finds the quoted specifier', () => {
    const range = findSpecifierRange(
      `import a from 'b';\nimport Map from "react-native-maps";`,
      'react-native-maps',
    );
    expect(range).toMatchObject({
      start: { line: 1, character: 16 },
      end: { line: 1, character: 35 },
    });
    expect(findSpecifierRange('nothing here', 'x')).toBeUndefined();
  });

  it('warns on user imports of auto-mocked packages and offers a quick fix', async () => {
    const file = path.join(hello, 'components', 'Mocked.tsx');
    const diagnostics = new MockDiagnostics();
    await diagnostics.update(hello, [
      {
        specifier: 'react-native-maps',
        source: 'auto',
        note: 'not installed',
        importers: [file, path.join(hello, 'node_modules', 'x.js')],
      },
      { specifier: 'node:fs', source: 'auto', importers: [file] },
      { specifier: 'expo-haptics', source: 'built-in', importers: [file] },
    ]);
    const [diagnostic] = diagnosticsState.get(file) ?? [];
    expect(diagnosticsState.size).toBe(1);
    expect(diagnostic.message).toMatch(
      /^"react-native-maps" can't run in the RN Lens preview \(not installed\)/,
    );
    expect(specifierOf(diagnostic as never)).toBe('react-native-maps');

    const actions = diagnostics.provideCodeActions(
      { uri: Uri.file(file) } as never,
      new Range(0, 0, 0, 0) as never,
      {
        diagnostics: [diagnostic, new Diagnostic(new Range(0, 0, 0, 1), 'other')],
      } as never,
    );
    expect(actions.map((a) => [a.title, a.command?.command, a.command?.arguments?.[1]])).toEqual([
      ['Create mock for react-native-maps', 'rnLens.createMock', 'react-native-maps'],
    ]);

    await diagnostics.update(hello, []);
    expect(diagnosticsState.size).toBe(0);
    diagnostics.dispose();
  });
});
