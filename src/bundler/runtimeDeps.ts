import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Returns the absolute path of `<name>/package.json` as Node would resolve it from `fromDir`. */
export type LocatePackage = (name: string, fromDir: string) => string | undefined;
export type ReadText = (filePath: string) => Promise<string | undefined>;

export type DepSource = 'project' | 'vendor';

export interface RuntimeDeps {
  /** Directory that `react`, `react-dom` and their sub-paths are resolved from. */
  reactResolveDir: string;
  reactSource: DepSource;
  reactVersion: string;
  /** Directory that `react-native-web` is resolved from. */
  rnwResolveDir: string;
  rnwSource: DepSource;
  rnwVersion: string;
  /** User-facing notes about fallbacks and mismatches (what happened, why, what to do). */
  warnings: string[];
}

export const defaultLocate: LocatePackage = (name, fromDir) => {
  try {
    return createRequire(path.join(fromDir, 'noop.js')).resolve(`${name}/package.json`);
  } catch {
    return undefined;
  }
};

export const defaultReadText: ReadText = async (filePath) => {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
};

async function versionAt(packageJsonPath: string | undefined, read: ReadText) {
  if (!packageJsonPath) return undefined;
  const text = await read(packageJsonPath);
  if (text === undefined) return undefined;
  try {
    const version: unknown = (JSON.parse(text) as { version?: unknown }).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

const major = (version: string): string => version.split('.')[0];

/**
 * Chooses where the preview bundle gets React, React DOM and react-native-web from.
 *
 * The project's `react` + `react-dom` are used only as a pair with identical versions, because
 * React DOM refuses to run against a different React version. Otherwise both come from the
 * extension's vendor directory, so the bundle always contains exactly one consistent React.
 * react-native-web is taken from the project when installed, else from the vendor directory.
 */
export async function resolveRuntimeDeps(
  projectRoot: string,
  vendorDir: string,
  locate: LocatePackage = defaultLocate,
  read: ReadText = defaultReadText,
): Promise<RuntimeDeps> {
  const [projReact, projReactDom, projRnw, vendReact, vendRnw] = await Promise.all([
    versionAt(locate('react', projectRoot), read),
    versionAt(locate('react-dom', projectRoot), read),
    versionAt(locate('react-native-web', projectRoot), read),
    versionAt(locate('react', vendorDir), read),
    versionAt(locate('react-native-web', vendorDir), read),
  ]);
  if (!vendReact || !vendRnw) {
    throw new Error(
      `RN Lens's bundled React packages are missing from ${vendorDir}. ` +
        'The extension installation is incomplete; reinstall RN Lens (or run "npm install" when developing it).',
    );
  }

  const warnings: string[] = [];
  let reactSource: DepSource = 'vendor';
  if (projReact && projReactDom && projReact === projReactDom) {
    reactSource = 'project';
  } else if (projReact && projReactDom) {
    warnings.push(
      `react@${projReact} and react-dom@${projReactDom} have different versions, which React does not support, ` +
        `so the preview uses RN Lens's bundled react@${vendReact}. Install matching versions to preview with your own.`,
    );
  } else if (projReact) {
    warnings.push(
      `This project has no react-dom, so the preview uses RN Lens's bundled react@${vendReact} and react-dom@${vendReact}. ` +
        `For best fidelity install react-dom@${projReact} (e.g. "npx expo install react-dom react-native-web").`,
    );
  }
  const reactVersion = reactSource === 'project' ? (projReact as string) : vendReact;
  if (reactSource === 'vendor' && projReact && major(projReact) !== major(vendReact)) {
    warnings.push(
      `Your project uses React ${major(projReact)} but the preview renders with React ${major(vendReact)}. ` +
        'Behaviour may differ; install react-dom matching your React version to preview with your own React.',
    );
  }

  return {
    reactResolveDir: reactSource === 'project' ? projectRoot : vendorDir,
    reactSource,
    reactVersion,
    rnwResolveDir: projRnw ? projectRoot : vendorDir,
    rnwSource: projRnw ? 'project' : 'vendor',
    rnwVersion: projRnw ?? vendRnw,
    warnings,
  };
}
