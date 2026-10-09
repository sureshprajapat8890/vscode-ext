# RN Lens 🔍📱

**Preview React Native components instantly inside VS Code — no emulator, no simulator, no phone.**

RN Lens compiles your React Native code to the web on the fly (esbuild + [react-native-web](https://necolas.github.io/react-native-web/)) and renders it in a device frame right next to your editor. Save the file, see the change in milliseconds.

> ⚠️ RN Lens is a fast **UI iteration** tool. Rendering happens in a browser engine, so native-only code is mocked and small visual differences from real devices are expected. Always verify on a device before shipping.

---

## Features

- ▶ **One-click preview** — CodeLens above every exported component, or the 👁 button in the editor title bar.
- ⚡ **Fast rebuilds** — incremental esbuild; typically < 300 ms after save.
- 📱 **Device frames** — iPhone SE / 15 / 15 Pro Max, Pixel 8, Galaxy S24, iPad, or custom size; portrait/landscape; zoom.
- 🌗 **Light / dark** mode toggle wired to `useColorScheme()`.
- 🍎🤖 **Simulated platform** — set `rnLens.simulatedPlatform` to `ios` or `android` so `Platform.OS`, `Platform.select`, and your `.ios.tsx` / `.android.tsx` files resolve correctly; the preview rebuilds when you change it. _(A toolbar toggle is coming soon.)_
- 🎛 **Variants** — preview a component with different props via `*.preview.tsx` files.
- 🧩 **Decorators** — wrap all previews in your providers (theme, Redux/Zustand, i18n, NavigationContainer).
- 🧯 **Error overlay** — source-mapped stack traces; click to jump to the line.
- 🪵 **Console forwarding** — `console.log` shows up in the *RN Lens* output channel.
- 🧪 **Native module mocks** — built-in mocks for popular packages, plus your own in `.rnlens/mocks/`.
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

_Coming soon:_ alternatively, export a `previews` object from the component file itself:

```tsx
export const previews = {
  Primary:  { title: 'Continue' },
  Disabled: { title: 'Continue', disabled: true },
};
```

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

If a component imports something that only exists on iOS/Android, RN Lens replaces it and shows a **⚠ N mocked** badge in the panel toolbar (details in the *RN Lens* output). Built-in mocks cover `@react-native-async-storage/async-storage` (backed by localStorage), `react-native-device-info`, `react-native-haptic-feedback`, `expo-haptics`, `react-native-safe-area-context` (insets of the simulated device), `react-native-vector-icons` (uses `@expo/vector-icons` when installed, placeholders otherwise), `expo-constants`, `expo-status-bar`, `expo-splash-screen` and `react-native-config` (values from `.env`). `react-native/Libraries/*` imports, Node built-ins and unknown `NativeModules.*` become no-op mocks with a warning. `react-native-reanimated` and `react-native-gesture-handler` are routed to their web builds.

Add your own by creating `.rnlens/mocks/<package-name>.ts(x)`. Scoped packages use folders:

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

_Coming soon:_ a **"Create mock for …"** quick-fix on the warning to generate a stub.

## Commands

| Command | Description |
|---|---|
| `RN Lens: Open Preview` | Preview the active file's default (or first) exported component |
| `RN Lens: Preview App` | _Coming soon._ Preview the full app entry (`App.tsx` / `index.js` / expo-router `app/`) |
| `RN Lens: Reload` | Force rebuild and reload |
| `RN Lens: Toggle Lock` | _Coming soon._ Keep the current preview while editing other files |
| `RN Lens: Clear Cache` | Clear the build cache |
| `RN Lens: Show Output` | Open the *RN Lens* output channel (also: click the status bar item) |

## Settings

| Setting | Default | Description |
|---|---|---|
| `rnLens.updateMode` | `onSave` | `onSave`. _(`onType` — debounced, using unsaved buffers — is coming soon.)_ |
| `rnLens.defaultDevice` | `iphone-15` | Device preset for new panels |
| `rnLens.simulatedPlatform` | `ios` | `ios`, `android`, or `web` |
| `rnLens.entry` | _auto_ | _Coming soon._ Override app entry file |
| `rnLens.extraAliases` | `{}` | _Coming soon._ Extra module aliases, e.g. `{ "@app": "./src" }` |
| `rnLens.networkAllowList` | `[]` | Origins the preview may `fetch` (e.g. `http://localhost:4000`) |

`EXPO_PUBLIC_*` variables from `.env`, `.env.development`, `.env.local` and `.env.development.local` are available as `process.env.*`; `.env` files and `app.json` are read as plain data, never executed.

_Coming soon:_ advanced, code-based configuration in `rnlens.config.js` at the project root (only loaded in trusted workspaces):

```js
/** @type {import('rn-lens').Config} */
module.exports = {
  decorators: './.rnlens/decorators.tsx',
  define: { 'process.env.API_URL': JSON.stringify('http://localhost:4000') },
  mocks: { 'react-native-maps': './.rnlens/mocks/maps.tsx' },
  esbuildPlugins: [],
};
```

## Known limitations

- Native modules don't run; they're mocked.
- Text metrics, shadows (`elevation`, `shadow*`), and some fonts can differ slightly from devices.
- Libraries without a web implementation need a mock.
- Performance in the preview is not representative of device performance.
- Fast Refresh (state-preserving reloads) is planned; v1 reloads the component tree on change.
- Library code in `node_modules` resolves as it does on web (`.web.*`, then plain files); the simulated platform's `.ios` / `.android` / `.native` files are used for your own code only, since library native files call native modules.
- Path aliases from `tsconfig.json` `paths` work, but `.ios` / `.android` variants are only picked for relative imports for now; `babel-plugin-module-resolver` aliases are coming soon.

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

See [CONTRIBUTING.md](./CONTRIBUTING.md). Product spec: [PRD.md](./PRD.md).

## License

MIT
