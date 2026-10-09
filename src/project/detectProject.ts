import nodePath from 'node:path';

/** Minimal path API so detection can be exercised with both POSIX and Windows semantics. */
export type PathApi = Pick<
  typeof nodePath,
  'dirname' | 'join' | 'resolve' | 'relative' | 'isAbsolute' | 'sep'
>;

/** Reads a UTF-8 file, resolving `undefined` when it does not exist or cannot be read. */
export type ReadFile = (filePath: string) => Promise<string | undefined>;

export type ProjectKind = 'expo' | 'bare';

export interface RNProject {
  /** Absolute directory containing the project's package.json. */
  root: string;
  packageJsonPath: string;
  kind: ProjectKind;
  name: string | undefined;
  /** Version ranges as declared in package.json (not the installed versions). */
  reactNativeVersion: string | undefined;
  expoVersion: string | undefined;
  reactVersion: string | undefined;
}

interface PackageJson {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

function declaredVersion(pkg: PackageJson, name: string): string | undefined {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field];
    if (deps && typeof deps === 'object' && name in deps) {
      const version = (deps as Record<string, unknown>)[name];
      return typeof version === 'string' ? version : '*';
    }
  }
  return undefined;
}

/**
 * Parses package.json text and returns RN metadata when it declares `react-native` or `expo`.
 * Returns `undefined` for invalid JSON or non-RN packages.
 */
export function parseRNPackageJson(
  text: string,
): Omit<RNProject, 'root' | 'packageJsonPath'> | undefined {
  let pkg: PackageJson;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    pkg = parsed as PackageJson;
  } catch {
    return undefined;
  }

  const reactNativeVersion = declaredVersion(pkg, 'react-native');
  const expoVersion = declaredVersion(pkg, 'expo');
  if (reactNativeVersion === undefined && expoVersion === undefined) {
    return undefined;
  }
  return {
    kind: expoVersion !== undefined ? 'expo' : 'bare',
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    reactNativeVersion,
    expoVersion,
    reactVersion: declaredVersion(pkg, 'react'),
  };
}

/** True when `child` equals `parent` or lies inside it. */
export function isWithin(parent: string, child: string, pathApi: PathApi): boolean {
  const rel = pathApi.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel));
}

/**
 * Walks up from the directory containing `filePath` to `stopAt` (inclusive) and returns the nearest
 * package.json that declares `react-native` or `expo`. Directories inside `node_modules` are skipped
 * so a file in a dependency never resolves to the dependency's own package.json.
 */
export async function findProjectRoot(
  filePath: string,
  stopAt: string,
  readFile: ReadFile,
  pathApi: PathApi = nodePath,
): Promise<RNProject | undefined> {
  const boundary = pathApi.resolve(stopAt);
  let dir = pathApi.dirname(pathApi.resolve(filePath));
  if (!isWithin(boundary, dir, pathApi)) {
    return undefined;
  }

  for (;;) {
    const segments = pathApi.relative(boundary, dir).split(pathApi.sep);
    if (!segments.includes('node_modules')) {
      const packageJsonPath = pathApi.join(dir, 'package.json');
      const text = await readFile(packageJsonPath);
      const info = text === undefined ? undefined : parseRNPackageJson(text);
      if (info) {
        return { root: dir, packageJsonPath, ...info };
      }
    }
    if (dir === boundary) {
      return undefined;
    }
    const parent = pathApi.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Turns a list of candidate package.json paths (e.g. from a workspace file search) into RN projects,
 * ignoring anything inside `node_modules`. Results are sorted by root path for stable output.
 */
export async function detectProjects(
  packageJsonPaths: readonly string[],
  readFile: ReadFile,
  pathApi: PathApi = nodePath,
): Promise<RNProject[]> {
  const candidates = packageJsonPaths.filter(
    (p) => !pathApi.resolve(p).split(pathApi.sep).includes('node_modules'),
  );
  const results = await Promise.all(
    candidates.map(async (candidate): Promise<RNProject | undefined> => {
      const packageJsonPath = pathApi.resolve(candidate);
      const text = await readFile(packageJsonPath);
      const info = text === undefined ? undefined : parseRNPackageJson(text);
      return info
        ? { root: pathApi.dirname(packageJsonPath), packageJsonPath, ...info }
        : undefined;
    }),
  );
  return results
    .filter((p): p is RNProject => p !== undefined)
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}
