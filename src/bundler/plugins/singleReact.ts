import path from 'node:path';
import type { Plugin } from 'esbuild';
import { isRedirected, redirect } from './redirect';

/** `react`, `react-dom` and any sub-path (`react/jsx-runtime`, `react-dom/client`, …). */
export const REACT_SPECIFIER = /^(react|react-dom)(\/.*)?$/;

/**
 * Forces every import of React and React DOM — from user code, react-native-web and any other
 * dependency — to resolve from one directory, so the bundle contains exactly one React instance.
 * `react-dom/client` goes through RN Lens's root-tracking wrapper (except from the wrapper itself).
 */
export function singleReactPlugin(reactResolveDir: string, runtimeDir: string): Plugin {
  const clientWrapper = path.join(runtimeDir, 'reactDomClient.ts');
  return {
    name: 'rnlens-single-react',
    setup(build) {
      build.onResolve({ filter: REACT_SPECIFIER }, (args) => {
        if (isRedirected(args)) return undefined;
        if (args.path === 'react-dom/client' && path.resolve(args.importer) !== clientWrapper) {
          return { path: clientWrapper };
        }
        return redirect(build, args, args.path, reactResolveDir);
      });
    },
  };
}
