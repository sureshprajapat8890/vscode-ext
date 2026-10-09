/**
 * Contract between the webview shell (which owns device/theme state) and the runtime code that is
 * bundled into every preview. The shell installs `globalThis.__RNLENS_HOST__` before running a
 * bundle; the runtime reads the current environment and subscribes to changes.
 */

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WindowEnv {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
  insets: EdgeInsets;
}

export type ColorScheme = 'light' | 'dark';
export type PreviewPlatform = 'ios' | 'android' | 'web';

export interface DeviceInfo {
  id: string;
  name: string;
  isTablet: boolean;
  hasNotch: boolean;
  hasDynamicIsland: boolean;
}

export interface PreviewEnv {
  device: DeviceInfo;
  window: WindowEnv;
  colorScheme: ColorScheme;
  platform: PreviewPlatform;
}

export interface RNLensHost {
  readonly env: PreviewEnv;
  subscribe(listener: (env: PreviewEnv) => void): () => void;
  /** Reports an error caught by the preview's error boundary. */
  reportError(error: unknown, componentStack?: string | null): void;
}

const FALLBACK_ENV: PreviewEnv = {
  device: {
    id: 'iphone-15',
    name: 'iPhone 15',
    isTablet: false,
    hasNotch: true,
    hasDynamicIsland: true,
  },
  window: {
    width: 393,
    height: 852,
    scale: 3,
    fontScale: 1,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  colorScheme: 'light',
  platform: 'ios',
};

/** The shell's host, or a static stand-in when the runtime is loaded outside the preview shell. */
export function getHost(): RNLensHost {
  const host = (globalThis as { __RNLENS_HOST__?: RNLensHost }).__RNLENS_HOST__;
  if (host) return host;
  return {
    env: FALLBACK_ENV,
    subscribe: () => () => undefined,
    reportError: (error) => console.error(error),
  };
}
