import type { Plugin } from 'esbuild';
import type { PreviewTarget } from './types';

export const ENTRY_SPECIFIER = 'rnlens:entry';
const NAMESPACE = 'rnlens-entry';
export const APP_KEY = 'RNLensPreview';

/**
 * Source of the in-memory entry module for a preview target. The webview sets
 * `globalThis.__RNLENS_ROOT__` to a fresh mount element before running the bundle and calls
 * `globalThis.__RNLENS_UNMOUNT__` before running the next one.
 */
export function generateEntry(target: PreviewTarget): string {
  const file = JSON.stringify(target.file);
  const exportName = JSON.stringify(target.exportName);
  return [
    `import { AppRegistry } from 'react-native';`,
    `import * as Target from ${file};`,
    `const exportName = ${exportName};`,
    `const Component = Target[exportName];`,
    `if (Component == null) {`,
    `  throw new Error('RN Lens: ' + ${file} + ' has no export named "' + exportName + '". ' +`,
    `    'Export the component, or preview a different export.');`,
    `}`,
    `AppRegistry.registerComponent(${JSON.stringify(APP_KEY)}, () => Component);`,
    `const root = AppRegistry.runApplication(${JSON.stringify(APP_KEY)}, { rootTag: globalThis.__RNLENS_ROOT__ });`,
    `globalThis.__RNLENS_UNMOUNT__ = () => root.unmount();`,
    '',
  ].join('\n');
}

/** Serves the generated entry for `rnlens:entry`, resolving its imports from the project root. */
export function virtualEntryPlugin(target: PreviewTarget, projectRoot: string): Plugin {
  return {
    name: 'rnlens-virtual-entry',
    setup(build) {
      build.onResolve({ filter: /^rnlens:entry$/ }, () => ({
        path: 'entry',
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: generateEntry(target),
        loader: 'js',
        resolveDir: projectRoot,
      }));
    },
  };
}
