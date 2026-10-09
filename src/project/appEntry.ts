import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface AppEntry {
  /** Absolute path of the module to load. */
  file: string;
  /**
   * `module`: an entry module that registers the app itself (`AppRegistry.registerComponent`,
   * `registerRootComponent`, expo-router's entry). `component`: a file whose default export is the
   * root component (used when a project has `App.tsx` but no entry module).
   */
  mode: 'module' | 'component';
  /** For expo-router projects, the routes directory (`app/` or `src/app/`). */
  routerAppDir?: string;
  /** How the entry was found, for the output channel. */
  description: string;
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `base` itself, or `base` plus a source extension, or `base/index.*`. */
function resolveFile(base: string): string | undefined {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  for (const ext of EXTENSIONS)
    if (isFile(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
  return undefined;
}

function readPackageJson(projectRoot: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function dependsOn(pkg: Record<string, unknown>, name: string): boolean {
  return ['dependencies', 'devDependencies'].some((field) => {
    const deps = pkg[field];
    return !!deps && typeof deps === 'object' && name in deps;
  });
}

function routerAppDir(projectRoot: string): string | undefined {
  return [path.join(projectRoot, 'app'), path.join(projectRoot, 'src', 'app')].find((d) =>
    existsSync(d),
  );
}

function resolvePackageFile(specifier: string, projectRoot: string): string | undefined {
  try {
    return createRequire(path.join(projectRoot, 'noop.js')).resolve(specifier);
  } catch {
    return undefined;
  }
}

/**
 * Finds what "RN Lens: Preview App" should run, in order: the `rnLens.entry` setting, expo-router
 * (`main: "expo-router/entry"`, or an expo-router dependency with an `app/` directory), the
 * package.json `main` field, `index.*` (preferring `.web`, then the simulated platform, then
 * `.native`), and finally `App.*` as a root component.
 */
export function detectAppEntry(
  projectRoot: string,
  platform: 'ios' | 'android' | 'web',
  override?: string,
): AppEntry | { error: string } {
  if (override) {
    const file = resolveFile(path.resolve(projectRoot, override));
    return file
      ? { file, mode: 'module', description: `rnLens.entry (${override})` }
      : {
          error:
            `The rnLens.entry setting points to "${override}", which doesn't exist in ${projectRoot}. ` +
            'Fix the path (relative to the project root) or clear the setting to auto-detect the entry.',
        };
  }

  const pkg = readPackageJson(projectRoot);
  const main = typeof pkg.main === 'string' ? pkg.main : undefined;
  const appDir = routerAppDir(projectRoot);

  if (main === 'expo-router/entry' || (!main && dependsOn(pkg, 'expo-router') && appDir)) {
    const entry = resolvePackageFile('expo-router/entry', projectRoot);
    if (!entry || !appDir) {
      return {
        error: !entry
          ? "This project uses expo-router, but expo-router isn't installed, so RN Lens can't load its entry. Run your package manager's install, then try again."
          : "This project uses expo-router, but there's no app/ or src/app/ routes directory. Create app/_layout.tsx or app/index.tsx, then try again.",
      };
    }
    return { file: entry, mode: 'module', routerAppDir: appDir, description: 'expo-router' };
  }

  if (main) {
    const local = resolveFile(path.resolve(projectRoot, main));
    const file = local ?? resolvePackageFile(main, projectRoot);
    if (file) return { file, mode: 'module', description: `package.json "main" (${main})` };
    return {
      error:
        `package.json "main" is "${main}", which RN Lens couldn't find. ` +
        'Install dependencies, fix "main", or set rnLens.entry to your app entry file.',
    };
  }

  const suffixes = platform === 'web' ? ['.web', ''] : ['.web', `.${platform}`, '.native', ''];
  for (const suffix of suffixes) {
    const index = resolveFile(path.join(projectRoot, `index${suffix}`));
    if (index && path.basename(index).startsWith(`index${suffix}.`)) {
      return { file: index, mode: 'module', description: path.basename(index) };
    }
  }
  const app = resolveFile(path.join(projectRoot, 'App'));
  if (app)
    return { file: app, mode: 'component', description: `${path.basename(app)} (root component)` };

  return {
    error:
      `RN Lens couldn't find an app entry in ${projectRoot}: no package.json "main", index.js/ts or App.tsx. ` +
      'Set rnLens.entry to the file that registers your app.',
  };
}
