import type { Plugin } from 'esbuild';

/**
 * Expo's development-only clients for the Metro dev server (HMR, Fast Refresh, the message
 * socket). RN Lens previews aren't served by Metro, so these would fail or try to connect to a
 * server that isn't there; they load as empty modules instead.
 */
export const METRO_DEV_CLIENT_FILES =
  /[\\/]node_modules[\\/]expo[\\/](?:src|build)[\\/]async-require[\\/](?:setup|setupHMR|setupFastRefresh|messageSocket|hmr)\.(?:[jt]sx?)$/;

export function metroDevClientsPlugin(): Plugin {
  return {
    name: 'rnlens-metro-dev-clients',
    setup(build) {
      build.onLoad({ filter: METRO_DEV_CLIENT_FILES }, () => ({
        contents:
          '// Replaced by RN Lens: Metro dev-server clients are not used in previews.\nexport {};\n',
        loader: 'js',
      }));
    },
  };
}
