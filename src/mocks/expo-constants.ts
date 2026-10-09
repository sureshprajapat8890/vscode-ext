/**
 * RN Lens mock: expo-constants. `expoConfig` is the `expo` section of the project's app.json
 * (read as data, never executed — app.config.js is not evaluated). Device fields follow the
 * simulated device.
 */
import { getHost } from 'rnlens:runtime/host';

declare const __RNLENS_EXPO_CONFIG__: Record<string, unknown> | null;

export enum ExecutionEnvironment {
  Bare = 'bare',
  Standalone = 'standalone',
  StoreClient = 'storeClient',
}

export enum AppOwnership {
  Expo = 'expo',
}

export enum UserInterfaceIdiom {
  Handset = 'handset',
  Tablet = 'tablet',
  Desktop = 'desktop',
  TV = 'tv',
  Unsupported = 'unsupported',
}

const env = () => getHost().env;
const expoConfig = __RNLENS_EXPO_CONFIG__;

const Constants = {
  expoConfig,
  manifest: null,
  manifest2: null,
  easConfig: null,
  expoGoConfig: null,
  appOwnership: null,
  executionEnvironment: ExecutionEnvironment.Bare,
  isDevice: false,
  debugMode: true,
  sessionId: 'rnlens-preview',
  systemFonts: [] as string[],
  get deviceName(): string {
    return env().device.name;
  },
  get statusBarHeight(): number {
    return env().window.insets.top;
  },
  get platform() {
    const { platform, device } = env();
    const idiom = device.isTablet ? UserInterfaceIdiom.Tablet : UserInterfaceIdiom.Handset;
    return platform === 'ios'
      ? {
          ios: {
            model: device.name,
            userInterfaceIdiom: idiom,
            systemVersion: '17.0',
            buildNumber: '1',
          },
        }
      : platform === 'android'
        ? { android: { versionCode: 1 } }
        : { web: { ua: navigator.userAgent } };
  },
  getWebViewUserAgentAsync: (): Promise<string> => Promise.resolve(navigator.userAgent),
};

export default Constants;
