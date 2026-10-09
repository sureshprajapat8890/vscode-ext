/**
 * What libraries in node_modules get for `import … from 'react-native'`: the same wrapper as the
 * project's own code, except `Platform` is react-native-web's (`OS === 'web'`). Libraries use
 * `Platform.OS` to choose between native and web implementations, so they must see the platform
 * the preview really runs on; the simulated platform only applies to the project's own code.
 */
export * from './reactNative';
export { Platform } from 'react-native-web';
