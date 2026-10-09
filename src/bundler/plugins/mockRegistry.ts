import { existsSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { BUILT_IN_MOCKS, PREFERRED_ALTERNATIVES, type BuiltInMock } from '../../mocks';
import { isRedirected, redirect, resolveRaw } from './redirect';

const MOCK_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

export interface MockUse {
  specifier: string;
  source: 'project' | 'built-in' | 'auto';
  /** Absolute path of the mock module used (empty for auto-mocks). */
  file: string;
  note?: string;
}

export interface MockRegistryOptions {
  projectRoot: string;
  /** Directory holding the built-in mock files. */
  mocksDir: string;
  /** Preview runtime directory (provides the auto-mock implementation). */
  runtimeDir: string;
}

const AUTO_NAMESPACE = 'rnlens-automock';

/** Node built-ins without a `node:` prefix, e.g. `fs`, `path`, `async_hooks`. */
const BARE_BUILTINS = builtinModules.filter((m) => !m.startsWith('_') && !m.startsWith('node:'));

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Lists project mocks in `.rnlens/mocks/`: `<pkg>.tsx`, `@scope/<pkg>.ts`, or `<pkg>/index.ts`,
 * keyed by the package specifier they replace.
 */
export function findProjectMocks(projectRoot: string): Map<string, string> {
  const root = path.join(projectRoot, '.rnlens', 'mocks');
  const mocks = new Map<string, string>();
  const visit = (dir: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        const index = MOCK_EXTENSIONS.map((ext) => path.join(full, `index${ext}`)).find((f) =>
          existsSync(f),
        );
        const specifier = `${prefix}${entry}`;
        if (index && !mocks.has(specifier)) mocks.set(specifier, index);
        visit(full, `${specifier}/`);
        continue;
      }
      const ext = MOCK_EXTENSIONS.find((e) => entry.endsWith(e));
      if (!ext || entry.endsWith(`.d${ext}`)) continue;
      // `<pkg>/index.*` is the mock for `<pkg>` itself (registered above), not for `<pkg>/index`.
      if (prefix && entry === `index${ext}`) continue;
      const specifier = `${prefix}${entry.slice(0, -ext.length)}`;
      if (!mocks.has(specifier)) mocks.set(specifier, full);
    }
  };
  visit(root, '');
  return mocks;
}

function builtInFor(specifier: string): BuiltInMock | undefined {
  return BUILT_IN_MOCKS.find(
    (m) => m.name === specifier || (m.subpaths === true && specifier.startsWith(`${m.name}/`)),
  );
}

/** Source of an auto-mock module: a recursive no-op Proxy plus a one-time runtime warning. */
export function autoMockSource(specifier: string): string {
  const warning =
    `RN Lens: "${specifier}" can't run in the web preview, so it was replaced with a no-op mock. ` +
    `Add .rnlens/mocks/${specifier}.ts to control what it returns.`;
  return [
    `const { createAutoMock } = require('rnlens:runtime/autoMock');`,
    `console.warn(${JSON.stringify(warning)});`,
    `module.exports = createAutoMock(${JSON.stringify(specifier)});`,
  ].join('\n');
}

/**
 * Replaces native-only code with mocks. Resolution order: project mocks in `.rnlens/mocks/`, then
 * built-in mocks, then the real package. React Native internals (`react-native/*`) and Node
 * built-ins without a browser polyfill become auto-mocks. `used()` lists mocks used by the last
 * build.
 */
export function mockRegistryPlugin(options: MockRegistryOptions): {
  plugin: Plugin;
  used(): MockUse[];
} {
  const projectMocks = findProjectMocks(options.projectRoot);
  const names = new Set<string>([...projectMocks.keys(), ...BUILT_IN_MOCKS.map((m) => m.name)]);
  const subpathNames = BUILT_IN_MOCKS.filter((m) => m.subpaths).map((m) => m.name);
  const alternatives = new Map<string, string | undefined>();
  let used = new Map<string, MockUse>();

  const mockFilter = new RegExp(
    `^(?:${[...names].map(escapeRegExp).join('|')}|(?:${subpathNames.map(escapeRegExp).join('|') || '(?!)'})/.+)$`,
  );
  const builtinFilter = new RegExp(`^(?:${BARE_BUILTINS.map(escapeRegExp).join('|')})(?:/.*)?$`);

  const autoMock = (specifier: string, note: string) => {
    used.set(specifier, { specifier, source: 'auto', file: '', note });
    return { path: specifier, namespace: AUTO_NAMESPACE };
  };

  const plugin: Plugin = {
    name: 'rnlens-mock-registry',
    setup(build) {
      build.onStart(() => {
        used = new Map();
      });

      build.onResolve({ filter: mockFilter }, async (args) => {
        if (isRedirected(args)) return undefined;
        const specifier = args.path;

        const projectMock = projectMocks.get(specifier);
        if (projectMock) {
          used.set(specifier, { specifier, source: 'project', file: projectMock });
          return { path: projectMock };
        }

        const builtIn = builtInFor(specifier);
        if (!builtIn) return undefined;

        const alternative = PREFERRED_ALTERNATIVES[builtIn.name];
        if (alternative) {
          const target = specifier.replace(builtIn.name, alternative);
          if (!alternatives.has(target)) {
            const probe = await resolveRaw(build, target, options.projectRoot, args.kind);
            alternatives.set(target, probe.errors.length === 0 ? target : undefined);
          }
          if (alternatives.get(target)) {
            return redirect(build, args, target, options.projectRoot);
          }
        }

        const file = path.join(options.mocksDir, builtIn.file);
        used.set(specifier, { specifier, source: 'built-in', file, note: builtIn.note });
        return { path: file };
      });

      // React Native internals have no web implementation (react-native itself is react-native-web).
      build.onResolve({ filter: /^react-native\/.+/ }, (args) => {
        if (isRedirected(args)) return undefined;
        const projectMock = projectMocks.get(args.path);
        if (projectMock) {
          used.set(args.path, { specifier: args.path, source: 'project', file: projectMock });
          return { path: projectMock };
        }
        return autoMock(args.path, 'React Native internal with no web implementation');
      });

      // Node built-ins don't exist in the browser: `node:*` always, bare names unless a browser
      // polyfill package (e.g. `buffer`, `events`) is installed.
      build.onResolve({ filter: /^node:/ }, (args) => autoMock(args.path, 'Node.js built-in'));
      build.onResolve({ filter: builtinFilter }, async (args) => {
        if (isRedirected(args) || names.has(args.path)) return undefined;
        const polyfill = await resolveRaw(build, args.path, args.resolveDir, args.kind);
        return polyfill.errors.length === 0 ? undefined : autoMock(args.path, 'Node.js built-in');
      });

      build.onLoad({ filter: /.*/, namespace: AUTO_NAMESPACE }, (args) => ({
        contents: autoMockSource(args.path),
        loader: 'js',
        resolveDir: options.runtimeDir,
      }));
    },
  };

  return { plugin, used: () => [...used.values()] };
}
