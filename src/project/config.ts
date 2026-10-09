import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';
import { readBabelAliases } from './babelAliases';

export const CONFIG_FILE_NAMES = ['rnlens.config.js', 'rnlens.config.cjs', 'rnlens.config.mjs'];

/** The shape users write in `rnlens.config.js`. */
export interface RNLensUserConfig {
  /** Decorators module, relative to the project root (default `.rnlens/decorators.*`). */
  decorators?: string;
  /** Extra esbuild `define`s: identifier → JS expression source. */
  define?: Record<string, string>;
  /** Package → mock module (relative to the project root); checked after `.rnlens/mocks/`. */
  mocks?: Record<string, string>;
  /** Extra module aliases: prefix → path (relative to the project root) or package. */
  aliases?: Record<string, string>;
  /** esbuild plugins, run before RN Lens's own. */
  esbuildPlugins?: Plugin[];
}

/** Everything project-specific the bundler needs, from settings, Babel config and rnlens.config.js. */
export interface ProjectConfig {
  decorators: string | undefined;
  define: Record<string, string>;
  mocks: Record<string, string>;
  /** Alias prefix → absolute path or package specifier. */
  aliases: Record<string, string>;
  /** Extra directories bare imports resolve from (babel module-resolver `root`). */
  aliasRoots: string[];
  plugins: Plugin[];
  /** Human-readable notes for the output channel (sources used, things ignored). */
  notes: string[];
}

export const EMPTY_PROJECT_CONFIG: ProjectConfig = {
  decorators: undefined,
  define: {},
  mocks: {},
  aliases: {},
  aliasRoots: [],
  plugins: [],
  notes: [],
};

export interface ConfigSources {
  /** `rnLens.extraAliases`. */
  extraAliases: Record<string, unknown>;
  /** `vscode.workspace.isTrusted`: rnlens.config.js is only executed in trusted workspaces. */
  trusted: boolean;
  /** Loads a config module; injectable for tests. Defaults to a cache-busted dynamic import. */
  importModule?: (file: string) => Promise<unknown>;
}

// A real dynamic import for ESM configs (the extension bundle is CommonJS, where `import()` would be
// compiled to `require`); the query string makes a changed config load fresh.
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

/**
 * Loads a config module: CommonJS through `require` (with its cache cleared, so edits are picked
 * up), ESM (`.mjs`, or `.js` in a `"type": "module"` project) through a native dynamic import.
 */
export const defaultImportModule = async (file: string): Promise<unknown> => {
  const esmUrl = `${pathToFileURL(file).href}?t=${statSync(file).mtimeMs}`;
  if (file.endsWith('.mjs')) return nativeImport(esmUrl);
  const req = createRequire(file);
  try {
    // Drop the cached module so an edited config is re-read.
    Reflect.deleteProperty(req.cache, req.resolve(file));
    return req(file) as unknown;
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUIRE_ESM') return nativeImport(esmUrl);
    throw err;
  }
};

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

const resolveAlias = (projectRoot: string, target: string): string =>
  target.startsWith('.') || path.isAbsolute(target) ? path.resolve(projectRoot, target) : target;

/**
 * Merges project configuration. Precedence for aliases: rnlens.config.js > rnLens.extraAliases >
 * Babel module-resolver. rnlens.config.js is skipped (with a note) in untrusted workspaces.
 */
export async function loadProjectConfig(
  projectRoot: string,
  sources: ConfigSources,
): Promise<ProjectConfig> {
  const notes: string[] = [];
  const babel = readBabelAliases(projectRoot);
  const aliases: Record<string, string> = { ...babel.aliases };
  if (babel.source && (Object.keys(babel.aliases).length > 0 || babel.roots.length > 0)) {
    notes.push(
      `Using module-resolver aliases from ${path.basename(babel.source)}: ${Object.keys(babel.aliases).join(', ') || '(roots only)'}`,
    );
  }
  for (const [key, value] of Object.entries(sources.extraAliases)) {
    if (typeof value === 'string') aliases[key] = resolveAlias(projectRoot, value);
    else notes.push(`Ignored rnLens.extraAliases["${key}"]: the value must be a string path.`);
  }

  const config: ProjectConfig = {
    ...EMPTY_PROJECT_CONFIG,
    aliases,
    aliasRoots: babel.roots,
    notes,
  };

  const file = CONFIG_FILE_NAMES.map((n) => path.join(projectRoot, n)).find((f) => existsSync(f));
  if (!file) return config;
  if (!sources.trusted) {
    notes.push(
      `${path.basename(file)} was not loaded because this workspace isn't trusted (it would run code). ` +
        'Trust the workspace to use it; built-in mocks and settings still apply.',
    );
    return config;
  }

  let loaded: unknown;
  try {
    const mod = (await (sources.importModule ?? defaultImportModule)(file)) as {
      default?: unknown;
    };
    loaded = mod.default ?? mod;
  } catch (err) {
    throw new Error(
      `${path.basename(file)} failed to load: ${err instanceof Error ? err.message : String(err)}. Fix the error, then run "RN Lens: Reload".`,
      { cause: err },
    );
  }
  if (!loaded || typeof loaded !== 'object') {
    throw new Error(`${path.basename(file)} must export an object (module.exports = { … }).`);
  }
  const user = loaded as Record<string, unknown>;
  const known = new Set(['decorators', 'define', 'mocks', 'aliases', 'esbuildPlugins']);
  const unknown = Object.keys(user).filter((k) => !known.has(k));
  if (unknown.length > 0)
    notes.push(`${path.basename(file)}: ignored unknown option(s) ${unknown.join(', ')}.`);

  if (typeof user.decorators === 'string')
    config.decorators = path.resolve(projectRoot, user.decorators);
  if (isStringRecord(user.define)) config.define = { ...user.define };
  if (isStringRecord(user.mocks)) {
    config.mocks = Object.fromEntries(
      Object.entries(user.mocks).map(([k, v]) => [k, path.resolve(projectRoot, v)]),
    );
  }
  if (isStringRecord(user.aliases)) {
    for (const [k, v] of Object.entries(user.aliases))
      config.aliases[k] = resolveAlias(projectRoot, v);
  }
  if (Array.isArray(user.esbuildPlugins)) {
    config.plugins = user.esbuildPlugins.filter(
      (p): p is Plugin => !!p && typeof p === 'object' && typeof (p as Plugin).setup === 'function',
    );
  }
  notes.push(`Loaded ${path.basename(file)}.`);
  return config;
}
