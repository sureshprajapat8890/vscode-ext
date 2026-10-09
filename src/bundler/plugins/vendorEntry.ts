import type { Plugin } from 'esbuild';
import type { VendorRef } from './externalize';

export const VENDOR_ENTRY = 'rnlens:vendor';
const NAMESPACE = 'rnlens-vendor';
const KEY_PREFIX = 'rnlens-vendor-key:';

/**
 * Source of the vendor bundle's entry: React Refresh's runtime hook first (it must be installed
 * before react-dom loads), then a registry of lazily evaluated modules keyed the way the app
 * bundle requires them.
 */
export function vendorEntrySource(keys: readonly string[]): string {
  return [
    `import 'rnlens:runtime/refreshSetup';`,
    `const modules = Object.create(null);`,
    ...keys.map(
      (key, i) =>
        `modules[${JSON.stringify(key)}] = () => require(${JSON.stringify(`${KEY_PREFIX}${i}`)});`,
    ),
    `globalThis.__RNLENS_REQUIRE__ = (key) => {`,
    `  const load = modules[key];`,
    `  if (!load) throw new Error('RN Lens: the vendor bundle has no module ' + key + '. Run "RN Lens: Reload".');`,
    `  return load();`,
    `};`,
    '',
  ].join('\n');
}

/** Vendor build: serves `rnlens:vendor` and maps each registry entry back to its resolved module. */
export function vendorEntryPlugin(
  getRefs: () => ReadonlyMap<string, VendorRef>,
  projectRoot: string,
): Plugin {
  return {
    name: 'rnlens-vendor-entry',
    setup(build) {
      let refs: VendorRef[] = [];
      build.onResolve({ filter: /^rnlens:vendor$/ }, () => ({
        path: 'vendor',
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => {
        const entries = [...getRefs()];
        refs = entries.map(([, ref]) => ref);
        return {
          contents: vendorEntrySource(entries.map(([key]) => key)),
          loader: 'js',
          resolveDir: projectRoot,
        };
      });
      build.onResolve({ filter: /^rnlens-vendor-key:\d+$/ }, (args) => {
        const ref = refs[Number(args.path.slice(KEY_PREFIX.length))];
        if (!ref) return { errors: [{ text: `RN Lens: unknown vendor module ${args.path}` }] };
        return {
          path: ref.path,
          namespace: ref.namespace,
          suffix: ref.suffix,
          pluginData: ref.pluginData,
        };
      });
    },
  };
}
