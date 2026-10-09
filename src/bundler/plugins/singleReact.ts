import type { Plugin } from 'esbuild';
import { isRedirected, redirect } from './redirect';

/** `react`, `react-dom` and any sub-path (`react/jsx-runtime`, `react-dom/client`, …). */
export const REACT_SPECIFIER = /^(react|react-dom)(\/.*)?$/;

/**
 * Forces every import of React and React DOM — from user code, react-native-web and any other
 * dependency — to resolve from one directory, so the bundle contains exactly one React instance.
 */
export function singleReactPlugin(reactResolveDir: string): Plugin {
  return {
    name: 'rnlens-single-react',
    setup(build) {
      build.onResolve({ filter: REACT_SPECIFIER }, (args) =>
        isRedirected(args) ? undefined : redirect(build, args, args.path, reactResolveDir),
      );
    },
  };
}
