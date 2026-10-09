import path from 'node:path';
import type { Plugin } from 'esbuild';
import { isRedirected, redirect } from './redirect';

/** Bare `react-native` and `react-native-web` imports (not sub-paths). */
export const RN_SPECIFIER = /^react-native(-web)?$/;

/**
 * `react-native` → RN Lens's wrapper module (react-native-web plus device-aware Platform,
 * SafeAreaView and NativeModules); `react-native-web` → the single react-native-web copy resolved
 * from `rnwResolveDir` (the project or the extension's vendor directory).
 */
export function rnAliasPlugin(rnwResolveDir: string, runtimeDir: string): Plugin {
  const wrapper = path.join(runtimeDir, 'reactNative.ts');
  return {
    name: 'rnlens-rn-alias',
    setup(build) {
      build.onResolve({ filter: RN_SPECIFIER }, (args) => {
        if (isRedirected(args)) return undefined;
        return args.path === 'react-native'
          ? { path: wrapper }
          : redirect(build, args, 'react-native-web', rnwResolveDir);
      });
    },
  };
}
