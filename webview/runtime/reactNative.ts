/**
 * What previewed code gets for `import … from 'react-native'`: react-native-web, with the APIs that
 * must reflect the simulated device overridden. Explicit exports take precedence over `export *`.
 */
import './platformPatch';

export * from 'react-native-web';
export { Platform } from './platform';
export { SafeAreaView } from './safeAreaView';
export { NativeModules } from './nativeModules';
export { requireNativeComponent, TurboModuleRegistry } from './nativeComponents';
export * from './rnCompat';
