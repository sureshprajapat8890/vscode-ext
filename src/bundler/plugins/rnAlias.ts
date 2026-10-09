import type { Plugin } from 'esbuild';
import { isRedirected, redirect } from './redirect';

/** `react-native` and `react-native-web` (bare package imports, not sub-paths). */
export const RN_SPECIFIER = /^react-native(-web)?$/;

/**
 * Aliases `react-native` to react-native-web, resolved from `rnwResolveDir` (the project or the
 * extension's vendor directory). Direct `react-native-web` imports go to the same copy so there is
 * only ever one StyleSheet registry in the bundle.
 */
export function rnAliasPlugin(rnwResolveDir: string): Plugin {
  return {
    name: 'rnlens-rn-alias',
    setup(build) {
      build.onResolve({ filter: RN_SPECIFIER }, (args) =>
        isRedirected(args) ? undefined : redirect(build, args, 'react-native-web', rnwResolveDir),
      );
    },
  };
}
