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
- 🍎🤖 **Simulated platform** — switch between iOS and Android so `Platform.OS`, `Platform.select`, and `.ios.tsx` / `.android.tsx` files resolve correctly.
- 🎛 **Variants** — preview a component with different props via `*.preview.tsx` files.
- 🧩 **Decorators** — wrap all previews in your providers (theme, Redux/Zustand, i18n, NavigationContainer).
- 🧯 **Error overlay** — source-mapped stack traces; click to jump to the line.
- 🪵 **Console forwarding** — `console.log` shows up in the *RN Lens* output channel.
- 🧪 **Native module mocks** — built-in mocks for popular packages, plus your own in `.rnlens/mocks/`.
- ✅ Works with **Expo** and **bare React Native CLI** projects, on Windows, macOS, Linux, WSL, Remote-SSH and Codespaces.

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

Alternatively, export a `previews` object from the component file itself:

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

If a component imports something that only exists on iOS/Android, RN Lens will warn you in the panel. Built-in mocks cover common packages (AsyncStorage, device-info, haptics, safe-area-context, vector-icons, reanimated, gesture-handler, and more).

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

Tip: use the **"Create mock for …"** quick-fix on the warning to generate a stub.

## Commands

| Command | Description |
|---|---|
| `RN Lens: Open Preview` | Preview the active file's default (or first) exported component |
| `RN Lens: Preview App` | Preview the full app entry (`App.tsx` / `index.js` / expo-router `app/`) |
| `RN Lens: Reload` | Force rebuild and reload |
| `RN Lens: Toggle Lock` | Keep the current preview while editing other files |
| `RN Lens: Clear Cache` | Clear the build cache |

## Settings

| Setting | Default | Description |
|---|---|---|
| `rnLens.updateMode` | `onSave` | `onSave` or `onType` (debounced, uses unsaved buffers) |
| `rnLens.defaultDevice` | `iphone-15` | Device preset for new panels |
| `rnLens.simulatedPlatform` | `ios` | `ios`, `android`, or `web` |
| `rnLens.entry` | _auto_ | Override app entry file |
| `rnLens.extraAliases` | `{}` | Extra module aliases, e.g. `{ "@app": "./src" }` |
| `rnLens.networkAllowList` | `[]` | Origins the preview may `fetch` (e.g. `http://localhost:4000`) |

Advanced, code-based configuration lives in `rnlens.config.js` at the project root (only loaded in trusted workspaces):

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

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unexpected token` inside `node_modules/...` | That package ships Flow or untranspiled JSX. Run **RN Lens: Clear Cache**; if it persists, report the package name. |
| "Invalid hook call" | Two copies of React were bundled. Make sure `react` and `react-dom` versions match in your `package.json`. |
| Blank screen, no error | Check the *RN Lens* output channel; the component might render `null` or need a decorator (e.g. a provider). |
| Images missing | Ensure the path is a static `require('./img.png')` / `import`; dynamic `require` with variables isn't supported. |

## Privacy

RN Lens runs entirely on your machine. No code leaves your computer. Telemetry is off unless you opt in via VS Code's telemetry setting **and** `rnLens.telemetry`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Product spec: [PRD.md](./PRD.md).

## License

MIT
