# Known differences from a device

RN Lens renders React Native code with [react-native-web](https://necolas.github.io/react-native-web/) inside a VS Code webview (Chromium). That makes previews instant, but it isn't iOS or Android. This page lists what differs, so you know what to check on a device before shipping.

## Rendering and layout

- **Text.** Fonts are rasterised by Chromium. Line height, letter spacing, wrapping and truncation (`numberOfLines`) can differ by a few pixels from iOS and Android. System fonts are the desktop's, not San Francisco or Roboto, unless you load the font yourself.
- **Shadows.** iOS `shadow*` props become CSS `box-shadow`. Android `elevation` is approximated. Neither matches the native renderer exactly.
- **Images.**
  - **Supported:** static `require('./img.png')` / `import`. The highest-density variant (`@3x`, then `@2x`, …) is always used, whatever the simulated device.
  - **Not supported:** dynamic `require` with a variable.
  - **Remote URLs:** they need `rnLens.networkAllowList`, because the webview's Content Security Policy blocks other origins.
- **Platform components.** `ActivityIndicator`, `Switch`, `Modal` and `RefreshControl` use react-native-web's web versions, so they don't look like UIKit or Material controls.
- **Device frame.**
  - Dimensions, safe-area insets and the status bar come from the simulated device.
  - Notches and the home indicator are drawn by the frame, not reported by an OS.
  - `useWindowDimensions()` follows the frame size and orientation (zoom only scales the frame).

## Platform behaviour

- **`Platform.OS` is simulated only for your own code.**
  - **Your project files** see the platform chosen in the toolbar: `Platform.OS`, `Platform.select` and `.ios` / `.android` / `.native` files.
  - **Libraries in `node_modules`** see `web`. They pick their web implementation, because their native code can't run.
  - **React Navigation** is the exception: it follows the simulated platform, so headers and tabs take the iOS or Android look.
  - **tsconfig `paths` aliases** resolve to the right file, but don't pick `.ios` / `.android` variants.
- **APIs react-native-web lacks are shimmed.** `PlatformColor`, `DynamicColorIOS`, `PermissionsAndroid`, `ToastAndroid`, `ActionSheetIOS`, `useAnimatedValue` and others return sensible web values or do nothing. They never throw.
- **Input.**
  - You use a mouse and the desktop keyboard. There's no on-screen keyboard, so `KeyboardAvoidingView` and `Keyboard` events don't behave as on a phone.
  - Multi-touch gestures can't be performed.
  - `react-native-gesture-handler` and `react-native-reanimated` run their web builds.
- **Animations.** `useNativeDriver: true` falls back to JavaScript-driven animation, with a console warning. Timing is representative; performance isn't.

## JavaScript engine

Previews run on Chromium's V8, not Hermes or JavaScriptCore:

- `Intl`, `Date` parsing and `toLocaleString` follow Chromium's implementation.
- Newer JavaScript syntax that Hermes doesn't support works in the preview but can fail on a device. The opposite case is rare.
- Performance, memory and frame rates aren't representative of a phone.

## Native code

- **Native modules don't run.** Anything that needs Objective-C, Swift, Java or Kotlin is replaced:
  1. **Your mocks** in `.rnlens/mocks/`.
  2. **Mocks from `rnlens.config.js`.**
  3. **Built-in mocks** for popular packages (AsyncStorage backed by `localStorage`, safe-area-context, device-info, haptics, vector icons, Expo constants / status bar / splash screen, react-native-config).
  4. **Auto-mocks:** recursive no-ops that return `undefined` and render nothing.

  See [WRITING_MOCKS.md](./WRITING_MOCKS.md).
- **Not installed means auto-mocked.** A package that isn't installed is auto-mocked rather than failing the build. The import gets a warning with a **Create mock for …** quick fix.
- **Storage persists.** `AsyncStorage` and `localStorage` data persists in the webview between previews; it isn't the device's storage.
- **Expo dev tools are disabled.** Metro dev-server clients (HMR, LogBox, the dev menu) are turned off. Errors appear in RN Lens's overlay and *RN Lens* output channel instead.

## Fast Refresh

RN Lens follows React Native's Fast Refresh rules, with these differences:

- **What keeps state.**
  - Editing a module that exports only components keeps the state of those components.
  - Editing any other module (constants, hooks, context) re-runs it and every module that imports it, up to the nearest component-only modules. Components they render keep their state.
  - If such a change reaches the app's entry file, or the preview's variant or decorators change, the preview reloads fully.
- **Hook signatures.**
  - A component's state resets when its own hook calls change. Changing the initial argument of `useState`, `useReducer` or `useRef` counts.
  - Editing the inside of a *custom* hook defined in another file keeps the state of components using it. React Native's Babel plugin would reset them in some cases.
- **Class components** always remount on edit, as in React Native.
- **Explicit actions start fresh.** Re-opening a preview, **Reload** and **Clear Cache** always remount.

## Storybook stories

`<Name>.stories.tsx` files are read as variants (CSF3 story objects and CSF2 story functions):

- **Composition.** Meta and story `args` are merged; `render` and story / meta `decorators` apply.
- **Not supported:**
  - `loaders`, `play` functions, `globals` and argTypes-driven controls.
  - Decorators from Storybook's `preview.tsx`. Use `.rnlens/decorators.tsx` instead.
- **`includeStories` / `excludeStories`** are honoured when they're string lists. Regular expressions aren't evaluated.

## Networking and environment

- **Origins.** `fetch` and WebSockets reach only the origins in `rnLens.networkAllowList`. Everything else is blocked by the webview's Content Security Policy.
- **Environment variables.** Only `EXPO_PUBLIC_*` variables from `.env` files are defined. Secrets that live only in native config (Info.plist, gradle) aren't available.
