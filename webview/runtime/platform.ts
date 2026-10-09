import { getHost, type PreviewPlatform } from './host';

type PlatformSpec<T> = { [K in PreviewPlatform | 'native' | 'default']?: T };

/** Read on every access: the vendor bundle outlives platform switches. */
const os = (): PreviewPlatform => getHost().env.platform;

/**
 * `Platform` as seen by the project's own code: it reports the simulated OS (react-native-web's
 * internals, and libraries, keep seeing `web`). `select` follows React Native's precedence: OS,
 * then `native` (except on web), then `default`.
 */
export const Platform = {
  get OS(): PreviewPlatform {
    return os();
  },
  get Version(): string | number {
    const current = os();
    return current === 'ios' ? '17.0' : current === 'android' ? 34 : '0.0.0';
  },
  isPad: false,
  isTV: false,
  isVision: false,
  isTesting: false,
  constants: {
    reactNativeVersion: { major: 0, minor: 0, patch: 0 },
    isTesting: false,
  },
  select<T>(spec: PlatformSpec<T>): T | undefined {
    const current = os();
    if (current in spec) return spec[current];
    if (current !== 'web' && 'native' in spec) return spec.native;
    return spec.default;
  },
};
