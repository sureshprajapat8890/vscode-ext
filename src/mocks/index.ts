/**
 * Registry of built-in mocks (extension-host side). Each entry maps a package to a file in this
 * directory; the files themselves are bundled into previews, never run in the extension host.
 */
export interface BuiltInMock {
  /** Package name. */
  name: string;
  /** Path of the mock module relative to the mocks directory. */
  file: string;
  /** Also mock sub-path imports (`<name>/<anything>`). */
  subpaths?: boolean;
  /** Shown in the output channel when the mock is used. */
  note: string;
}

export const BUILT_IN_MOCKS: readonly BuiltInMock[] = [
  {
    name: '@react-native-async-storage/async-storage',
    file: '@react-native-async-storage/async-storage.ts',
    note: 'backed by localStorage',
  },
  {
    name: 'react-native-device-info',
    file: 'react-native-device-info.ts',
    note: 'reports the simulated device',
  },
  { name: 'react-native-haptic-feedback', file: 'react-native-haptic-feedback.ts', note: 'no-op' },
  { name: 'expo-haptics', file: 'expo-haptics.ts', note: 'no-op' },
  {
    name: 'react-native-safe-area-context',
    file: 'react-native-safe-area-context.tsx',
    note: 'insets of the simulated device',
  },
  {
    name: 'react-native-vector-icons',
    file: 'react-native-vector-icons.tsx',
    subpaths: true,
    note: 'placeholder squares (install @expo/vector-icons for real glyphs)',
  },
  { name: 'expo-constants', file: 'expo-constants.ts', note: 'expoConfig from app.json' },
  {
    name: 'expo-status-bar',
    file: 'expo-status-bar.tsx',
    note: 'the preview frame draws the status bar',
  },
  { name: 'expo-splash-screen', file: 'expo-splash-screen.ts', note: 'no-op' },
  { name: 'react-native-config', file: 'react-native-config.ts', note: 'values from .env' },
  {
    name: '@expo/log-box/lib',
    file: '@expo/log-box-lib.ts',
    note: "RN Lens's overlay shows errors instead of Expo's LogBox",
  },
  {
    name: '@expo/metro-runtime',
    file: '@expo/metro-runtime.ts',
    subpaths: true,
    note: "Metro's HMR client isn't used by RN Lens",
  },
];

/**
 * Packages whose `react-native` entry point is native-only but that ship a working web build.
 * Their bare imports resolve through `browser` → `module` → `main` instead.
 */
export const WEB_CAPABLE_PACKAGES: readonly string[] = [
  '@expo/vector-icons',
  'react-native-reanimated',
  'react-native-gesture-handler',
];

/**
 * When a package is importable from the project, imports of the first package are redirected to it
 * instead of using the built-in mock (e.g. react-native-vector-icons → @expo/vector-icons).
 */
export const PREFERRED_ALTERNATIVES: Readonly<Record<string, string>> = {
  'react-native-vector-icons': '@expo/vector-icons',
};
