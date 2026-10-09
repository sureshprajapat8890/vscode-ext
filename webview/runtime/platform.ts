import { getHost, type PreviewPlatform } from './host';

type PlatformSpec<T> = { [K in PreviewPlatform | 'native' | 'default']?: T };

const os: PreviewPlatform = getHost().env.platform;

/**
 * `Platform` as seen by the previewed code: it reports the simulated OS (react-native-web's own
 * internals keep seeing `web`). `select` follows React Native's precedence: OS, then `native`
 * (except on web), then `default`.
 */
export const Platform = {
  OS: os,
  Version: os === 'ios' ? '17.0' : os === 'android' ? 34 : '0.0.0',
  isPad: false,
  isTV: false,
  isVision: false,
  isTesting: false,
  constants: {
    reactNativeVersion: { major: 0, minor: 0, patch: 0 },
    isTesting: false,
  },
  select<T>(spec: PlatformSpec<T>): T | undefined {
    if (os in spec) return spec[os];
    if (os !== 'web' && 'native' in spec) return spec.native;
    return spec.default;
  },
};
