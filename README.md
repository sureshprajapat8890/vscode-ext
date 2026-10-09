# RN Lens 🔍📱

**Preview React Native components instantly inside VS Code — no emulator, no simulator, no phone.**

RN Lens compiles your React Native code to the web on the fly (esbuild + [react-native-web](https://necolas.github.io/react-native-web/)) and renders it in a device frame right next to your editor. Save the file, see the change in milliseconds.

> ⚠️ RN Lens is a fast **UI iteration** tool. Rendering happens in a browser engine, so native-only code is mocked and small visual differences from real devices are expected. Always verify on a device before shipping.

---

## Features

- ▶ **One-click preview** — CodeLens above every exported component, or the 👁 button in the editor title bar. The preview follows the file you're editing; 🔒 lock it to keep one component in view.
- 📲 **Whole-app preview** — **RN Lens: Preview App** runs your app entry: `AppRegistry.registerComponent`, Expo's `registerRootComponent`, or **expo-router** (file-based routes). React Navigation works, including navigating between screens.
- ⚡ **Fast Refresh** — saving a component updates the preview in place and keeps its state (a counter's `useState`, the current screen). Only your own code is rebuilt; typically < 300 ms from save to screen.
- 🪟 **Side-by-side panels** — **RN Lens: Open Preview in New Panel** opens more previews, e.g. iPhone and Pixel next to each other. Panels showing the same component share one build.
- 📱 **Device frames** — iPhone SE / 15 / 15 Pro Max, Pixel 8, Galaxy S24, iPad, or custom size; portrait/landscape; zoom.
- 🌗 **Light / dark** mode toggle wired to `useColorScheme()`.
- 🍎🤖 **Simulated platform** — switch iOS / Android / Web in the toolbar (default: `rnLens.simulatedPlatform`) so `Platform.OS`, `Platform.select`, and your `.ios.tsx` / `.android.tsx` files resolve correctly.
- ⌨️ **Update while typing** — set `rnLens.updateMode` to `onType` to rebuild from unsaved editor contents.
- 🎛 **Variants** — preview a component with different props via `*.preview.tsx` files, a `previews` object, or your existing Storybook `*.stories.tsx` (CSF3).
- 🧩 **Decorators** — wrap all previews in your providers (theme, Redux/Zustand, i18n, NavigationContainer).
- 🧯 **Error overlay** — source-mapped stack traces; click to jump to the line.
- 🪵 **Console forwarding** — `console.log` shows up in the *RN Lens* output channel.
- 🧪 **Native module mocks** — built-in mocks for popular packages, your own in `.rnlens/mocks/`, no-op mocks for anything else native, and a **Create mock for …** quick fix.
- 🔗 **Aliases** — `tsconfig.json` `paths`, `babel-plugin-module-resolver` (read statically, never executed), `rnLens.extraAliases` and `rnlens.config.js`.
- ✅ Works with **Expo** and **bare React Native CLI** projects. Tested on Windows; CI covers macOS and Linux. Remote environments (WSL, Remote-SSH, Codespaces) are not yet verified.

## Requirements

- VS Code **1.90+**
- A workspace whose `package.json` depends on `react-native` or `expo`
- `node_modules` installed (`npm install` / `yarn` / `pnpm install`)

You do **not** need Xcode, Android Studio, or any emulator.
If your project lacks `react-native-web` / `react-dom`, RN Lens uses its own bundled copies. For best fidelity, install them:

```bash
npx expo install react-native-web react-dom   # Expo
npm i react-native-web react-dom              # bare RN (match your React version)
```

## Quick start

1. Install **RN Lens** from the Marketplace.
2. Open a React Native project.
3. Open any component file, e.g. `components/Button.tsx`.
4. Click **▶ Preview** above the component (or run **RN Lens: Open Preview** from the Command Palette).

## Variants (props for previews)

Create a file next to your component named `<Name>.preview.tsx`. Every named export becomes a variant in the toolbar dropdown:

```tsx
// components/Button.preview.tsx
import { Button } from './Button';

export const Primary  = () => <Button title="Continue" />;
export const Disabled = () => <Button title="Continue" disabled />;
export const Loading  = () => <Button title="Saving…" loading />;
```

Alternatively, export a `previews` object from the component file itself. Each key is a variant; its value is the props to render the component with:

```tsx
export const previews = {
  Primary:  { title: 'Continue' },
  Disabled: { title: 'Continue', disabled: true },
};
```

A flat `previews` object applies to the file's default export (or, without one, its first exported component). For files with several components, key it by export name: `{ Button: { Primary: { … } }, Card: { … } }`.

Already have Storybook stories? A `Button.stories.tsx` next to `Button.tsx` is read too: every story is a variant, with its `args` (merged over the meta's), `render` and `decorators` applied. CSF2 story functions work as well. `loaders` and `play` functions don't run.

```tsx
// components/Button.stories.tsx
export default { component: Button, args: { title: 'Continue' } };
export const Disabled = { args: { disabled: true } };
export const Wide = { render: (args) => <View style={{ width: 320 }}><Button {...args} /></View> };
```

When sources share a variant name, the `.preview` file wins, then `previews`, then the stories.

## Decorators (global providers)

```tsx
// .rnlens/decorators.tsx
import { ThemeProvider } from '../src/theme';
import { NavigationContainer } from '@react-navigation/native';

export default function Decorators({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <NavigationContainer>{children}</NavigationContainer>
    </ThemeProvider>
  );
}
```

## Mocking native modules

If a component imports something that only exists on iOS/Android, RN Lens replaces it and shows a **⚠ N mocked** badge in the panel toolbar (details in the *RN Lens* output). Built-in mocks cover `@react-native-async-storage/async-storage` (backed by localStorage), `react-native-device-info`, `react-native-haptic-feedback`, `expo-haptics`, `react-native-safe-area-context` (insets of the simulated device), `react-native-vector-icons` (uses `@expo/vector-icons` when installed, placeholders otherwise), `expo-constants`, `expo-status-bar`, `expo-splash-screen` and `react-native-config` (values from `.env`). Packages that aren't installed, `react-native/Libraries/*` imports, Node built-ins, `TurboModuleRegistry` modules, `requireNativeComponent` views and unknown `NativeModules.*` become no-op mocks with a warning. React Native APIs that react-native-web lacks (`PlatformColor`, `PermissionsAndroid`, `ToastAndroid`, `useAnimatedValue`, …) are shimmed. `react-native-reanimated` and `react-native-gesture-handler` use their web builds.

Add your own by creating `.rnlens/mocks/<package-name>.ts(x)` (full guide: [docs/WRITING_MOCKS.md](./docs/WRITING_MOCKS.md)). Scoped packages use folders:

```ts
// .rnlens/mocks/react-native-biometrics.ts
export default class ReactNativeBiometrics {
  async isSensorAvailable() { return { available: true, biometryType: 'FaceID' }; }
  async simplePrompt() { return { success: true }; }
}
```

```
.rnlens/mocks/@my-scope/native-camera.tsx
```

When a package you import is replaced with a no-op mock, its import line gets a warning with a **Create mock for …** quick fix. The fix writes a typed stub to `.rnlens/mocks/` covering the names you import, then reloads the preview. In the stub, components render a `View` with their children and functions return `undefined`.

## Commands

| Command | Description |
|---|---|
| `RN Lens: Open Preview` | Preview the active file's default (or first) exported component |
| `RN Lens: Open Preview in New Panel` | Preview in an additional panel, e.g. iPhone and Pixel side by side (from a preview's title bar: the same component again) |
| `RN Lens: Preview App` | Preview the whole app: `rnLens.entry`, expo-router, package.json `main`, `index.*`, or `App.*` |
| `RN Lens: Reload` | Restart the build and remount the preview (state is reset) |
| `RN Lens: Toggle Lock` | Keep the current preview while editing other files (also 🔒 in the preview toolbar and title bar) |
| `RN Lens: Clear Cache` | Clear the build cache |
| `RN Lens: Show Output` | Open the *RN Lens* output channel (also: click the status bar item) |

## Settings

| Setting | Default | Description |
|---|---|---|
| `rnLens.updateMode` | `onSave` | `onSave`, or `onType` (rebuilds 300 ms after you stop typing, using unsaved buffers) |
| `rnLens.defaultDevice` | `iphone-15` | Device preset for new panels |
| `rnLens.simulatedPlatform` | `ios` | `ios`, `android`, or `web` (the toolbar can switch it per preview) |
| `rnLens.entry` | _auto_ | Override the app entry file (relative to the project root) |
| `rnLens.extraAliases` | `{}` | Extra module aliases, e.g. `{ "@app": "./src" }` (relative to the project root) |
| `rnLens.networkAllowList` | `[]` | Origins the preview may `fetch` (e.g. `http://localhost:4000`) |

`EXPO_PUBLIC_*` variables from `.env`, `.env.development`, `.env.local` and `.env.development.local` are available as `process.env.*`; `.env` files and `app.json` are read as plain data, never executed.

Advanced, code-based configuration lives in `rnlens.config.js` (or `.cjs` / `.mjs`) at the project root. It runs code, so RN Lens loads it only in **trusted** workspaces; in Restricted Mode it notes in the output that the file was skipped.

```js
module.exports = {
  decorators: './.rnlens/decorators.tsx',          // instead of .rnlens/decorators.*
  define: { 'process.env.API_URL': JSON.stringify('http://localhost:4000') },
  mocks: { 'react-native-maps': './.rnlens/mocks/maps.tsx' },  // after .rnlens/mocks/, before built-ins
  aliases: { '@app': './src' },
  esbuildPlugins: [],                              // run before RN Lens's own plugins
};
```

Saving any of these rebuilds the preview from scratch: `package.json`, `app.json`, `tsconfig.json`, a Babel config, `rnlens.config.js`, a `.env` file, or anything in `.rnlens/mocks/`.

## Known limitations

The full list, with what to check on a device, is in [docs/KNOWN_DIFFERENCES.md](./docs/KNOWN_DIFFERENCES.md).

- Native modules don't run; they're mocked.
- Text metrics, shadows (`elevation`, `shadow*`), and some fonts can differ slightly from devices.
- Libraries without a web implementation need a mock.
- Performance in the preview is not representative of device performance.
- Fast Refresh keeps state when you edit modules that export only components. Edits to other modules (constants, hooks, context) re-run their importers, and a change that reaches the app's entry file reloads the preview.
- Storybook support covers stories and their args, `render` and decorators. `loaders`, `play` functions, globals and Storybook's `preview.tsx` aren't used; put shared providers in `.rnlens/decorators.tsx`.
- The simulated platform applies to **your own code**: `Platform.OS`, `Platform.select`, and `.ios` / `.android` / `.native` files.
  - Libraries in `node_modules` see the platform the preview really runs on, `web`. They use `Platform.OS` and `process.env.EXPO_OS` to choose between native and web implementations, and their `.native` / `.ios` files call native modules.
  - React Navigation is the exception: it follows the simulated platform, so headers and tabs take the iOS or Android look.
- Imports through `tsconfig.json` `paths` aliases resolve, but don't get `.ios` / `.android` variants. Relative imports, and Babel / `rnLens.extraAliases` / `rnlens.config.js` aliases, do.
- Expo's Metro dev-server clients (HMR, Fast Refresh) and Expo's LogBox are disabled in previews. RN Lens's overlay and output channel show errors instead.
- If no editor is open when a preview starts, it opens in the first editor group, and VS Code may replace it when you open a file in that group. Open a file first, or move the preview to its own group.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unexpected token` inside `node_modules/...` | That package ships Flow or untranspiled JSX. Run **RN Lens: Clear Cache**; if it persists, report the package name. |
| "Invalid hook call" | Two copies of React were bundled. Make sure `react` and `react-dom` versions match in your `package.json`. |
| Blank screen, no error | Check the *RN Lens* output channel; the component might render `null` or need a decorator (e.g. a provider). |
| Images missing | Ensure the path is a static `require('./img.png')` / `import`; dynamic `require` with variables isn't supported. |

## Privacy

RN Lens runs entirely on your machine. No code leaves your computer, and RN Lens currently sends no telemetry. If telemetry is added, it will only be sent when you opt in via VS Code's telemetry setting **and** `rnLens.telemetry`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Product spec: [PRD.md](./PRD.md). Design decisions: [docs/DECISIONS.md](./docs/DECISIONS.md).

## License

MIT
