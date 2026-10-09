# Mock native modules

Packages with native code can't run in a webview, so RN Lens replaces them:

- **Built-in mocks** cover common packages (AsyncStorage, safe-area-context, expo-haptics, …).
- **Auto-mocks** replace any other native-only package with a no-op. A warning appears on its import.

To control what a package returns, hover the warning and choose **Create mock for …**. This creates `.rnlens/mocks/<package>.ts`, which is used instead of the package from then on:

```ts
// .rnlens/mocks/react-native-device-info.ts
export const getModel = () => 'iPhone 15';
export default { getModel };
```

See `docs/WRITING_MOCKS.md` for details.
