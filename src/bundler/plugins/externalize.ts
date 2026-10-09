import path from 'node:path';
import type { OnResolveArgs, Plugin } from 'esbuild';

/** A module resolved during the app build that lives in the vendor bundle. */
export interface VendorRef {
  path: string;
  namespace: string;
  suffix: string;
  pluginData: unknown;
}

const MARKER = '__rnlensExternalizing';
/** Virtual modules that belong with the project's code (rebuilt and re-run with it). */
const APP_NAMESPACES = new Set(['rnlens-entry', 'rnlens-router-ctx']);

/**
 * True for files that are the project's own code, bundled into the app bundle: inside the project,
 * not in node_modules, and not a project mock (mocks stand in for packages, so they're vendor code).
 */
export function isProjectSource(projectRoot: string, file: string): boolean {
  const rel = path.relative(projectRoot, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(/[\\/]/);
  if (parts.includes('node_modules')) return false;
  return !(parts[0] === '.rnlens' && parts[1] === 'mocks');
}

export function vendorKey(ref: Pick<VendorRef, 'namespace' | 'path' | 'suffix'>): string {
  return `${ref.namespace}:${ref.path}${ref.suffix}`;
}

function isNestedResolve(args: OnResolveArgs): boolean {
  const data = args.pluginData as Record<string, unknown> | undefined;
  return !!data && (data[MARKER] === true || data.__rnlensRedirected === true);
}

/**
 * App build: resolves every import with all of RN Lens's rules (mocks, aliases, react-native →
 * wrapper, …), then keeps the project's own modules in the app bundle and turns everything else
 * into an external `require("<namespace>:<path>")` served by the vendor bundle. `keys` collects
 * what the vendor bundle must provide.
 */
export function externalizePlugin(projectRoot: string, keys: Map<string, VendorRef>): Plugin {
  return {
    name: 'rnlens-externalize',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        // Only real imports: other plugins' own `build.resolve` lookups have no importer.
        if (args.kind === 'entry-point' || !args.importer || isNestedResolve(args)) {
          return undefined;
        }
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          pluginData: { [MARKER]: true },
        });
        if (resolved.errors.length > 0)
          return { errors: resolved.errors, warnings: resolved.warnings };
        if (resolved.external) return { path: resolved.path, external: true };
        const inApp =
          APP_NAMESPACES.has(resolved.namespace) ||
          (resolved.namespace === 'file' && isProjectSource(projectRoot, resolved.path));
        if (inApp) {
          return {
            path: resolved.path,
            namespace: resolved.namespace,
            suffix: resolved.suffix,
            pluginData: resolved.pluginData,
            sideEffects: resolved.sideEffects,
            warnings: resolved.warnings,
          };
        }
        const ref: VendorRef = {
          path: resolved.path,
          namespace: resolved.namespace,
          suffix: resolved.suffix,
          pluginData: resolved.pluginData,
        };
        const key = vendorKey(ref);
        if (!keys.has(key)) keys.set(key, ref);
        // A namespace of its own: esbuild only accepts absolute paths in the `file` namespace.
        return {
          path: key,
          namespace: 'rnlens-vendor-ref',
          external: true,
          warnings: resolved.warnings,
        };
      });
    },
  };
}
