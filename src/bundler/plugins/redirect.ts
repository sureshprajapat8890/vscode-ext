import type { OnResolveArgs, OnResolveResult, PluginBuild } from 'esbuild';

const SKIP = '__rnlensRedirected';

/**
 * Resolves `specifier` as if it were imported from `resolveDir`, returning an esbuild resolve result.
 * Nested resolutions carry a marker so redirect plugins don't intercept their own lookups.
 */
export async function redirect(
  build: PluginBuild,
  args: OnResolveArgs,
  specifier: string,
  resolveDir: string,
): Promise<OnResolveResult> {
  const result = await build.resolve(specifier, {
    kind: args.kind,
    resolveDir,
    importer: args.importer,
    pluginData: { [SKIP]: true },
  });
  if (result.errors.length > 0) {
    return { errors: result.errors, warnings: result.warnings };
  }
  return {
    path: result.path,
    namespace: result.namespace,
    external: result.external,
    sideEffects: result.sideEffects,
    suffix: result.suffix,
    warnings: result.warnings,
  };
}

/** True when this resolve call was issued by `redirect` itself. */
export function isRedirected(args: OnResolveArgs): boolean {
  return (args.pluginData as Record<string, unknown> | undefined)?.[SKIP] === true;
}
