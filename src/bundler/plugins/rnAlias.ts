import path from 'node:path';
import type { Plugin } from 'esbuild';
import { isRedirected, redirect } from './redirect';

/** `react-native`, `react-native-web` and `react-native-web/<sub-path>`. */
export const RN_SPECIFIER = /^react-native(?:-web(?:\/.+)?)?$/;

/**
 * Libraries that only use `Platform` for look and feel (iOS vs Android styling), so they follow
 * the simulated platform like project code does.
 */
export const SIMULATED_PLATFORM_LIBRARIES = [/[\\/]node_modules[\\/]@react-navigation[\\/]/];

const isLibrary = (importer: string): boolean =>
  importer.split(/[\\/]/).includes('node_modules') &&
  !SIMULATED_PLATFORM_LIBRARIES.some((re) => re.test(importer));

/**
 * `react-native` → RN Lens's wrapper module (react-native-web plus device-aware Platform,
 * SafeAreaView, NativeModules and shims for APIs react-native-web lacks). Project code gets the
 * simulated `Platform`; libraries get react-native-web's (`web`), since they use it to pick native
 * or web code paths. `react-native-web` (and deep imports into it, as Expo does) → the single
 * react-native-web copy resolved from `rnwResolveDir`.
 */
export function rnAliasPlugin(rnwResolveDir: string, runtimeDir: string): Plugin {
  const projectWrapper = path.join(runtimeDir, 'reactNative.ts');
  const libraryWrapper = path.join(runtimeDir, 'reactNativeLibrary.ts');
  return {
    name: 'rnlens-rn-alias',
    setup(build) {
      build.onResolve({ filter: RN_SPECIFIER }, (args) => {
        if (isRedirected(args)) return undefined;
        if (args.path === 'react-native') {
          return { path: isLibrary(args.importer) ? libraryWrapper : projectWrapper };
        }
        return redirect(build, args, args.path, rnwResolveDir);
      });
    },
  };
}
