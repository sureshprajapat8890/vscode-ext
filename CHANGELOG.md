# Changelog

All notable changes to RN Lens are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Phase 4 — 1.0

- **React Fast Refresh.** Saving a component updates the preview in place and keeps its state: a counter's `useState`, the current screen of an app.
  - Each preview is now two bundles. The **app bundle** holds your own code and is rebuilt on every change. The **vendor bundle** holds React, react-native-web, mocks and libraries, and is rebuilt only when your code starts importing something new.
  - Hook changes remount the component.
  - Edits to modules that export more than components re-run their importers.
  - Changes that reach the app's entry file reload the preview.
  - The toolbar shows ⚡ for a hot update and ✓ for a full reload.
- **Multiple panels.** **RN Lens: Open Preview in New Panel** (also in a preview's title bar) opens another preview beside the first, e.g. iPhone and Pixel side by side.
  - Each panel has its own device, platform, variant and lock.
  - Panels showing the same component share one build, which is disposed when the last of them closes.
- **Storybook CSF3.** A colocated `<Name>.stories.tsx` contributes its stories as variants. Meta and story `args`, `render`, decorators, CSF2 story functions and `includeStories` / `excludeStories` are supported.
- **Walkthrough.** *Get started with RN Lens* now covers Fast Refresh, variants (including stories), decorators, side-by-side devices, the app preview and mocks.
- **Docs.** `docs/ARCHITECTURE.md`, `docs/KNOWN_DIFFERENCES.md` and `docs/WRITING_MOCKS.md`.
- **`npm run bench`.** Measures the PRD performance targets in VS Code and prints a table. CI runs it on Linux and adds the table to the job summary.
- Faster warm rebuilds: unchanged project files aren't re-transformed.
- The output channel logs how many modules each build bundled, and whether it was applied as a hot update or a full reload.
- Re-opening a preview, **Reload** and **Clear Cache** always start the preview fresh.
- Fixed: `onType` mode didn't use unsaved contents of files at the project root (e.g. `App.tsx`).

### Phase 3 — Beta

- **RN Lens: Preview App**: runs the whole app. The entry comes from `rnLens.entry`, expo-router, package.json `main`, `index.*` (platform-specific first) or `App.*`. It works with `AppRegistry`, Expo's `registerRootComponent` and **expo-router**; for expo-router, RN Lens generates the route context Metro would build with `require.context`. React Navigation apps are navigable in the preview.
- **Simulated platform toggle** in the toolbar (iOS / Android / Web), per preview; it rebuilds so your own `.ios` / `.android` files resolve. Libraries see the real `web` platform (React Navigation follows the simulated one).
- **Follow the active editor**: component previews retarget to the component file you switch to, and **Toggle Lock** (🔒 in the toolbar and title bar) pins the current one.
- **`rnLens.updateMode: "onType"`** rebuilds from unsaved editor contents 300 ms after you stop typing.
- **Aliases**:
  - `babel-plugin-module-resolver` aliases and roots, parsed statically and never executed.
  - `rnLens.extraAliases`.
  - `aliases` in `rnlens.config.js`.

  Aliased imports into your own code get platform-specific files.
- **`rnlens.config.js`** (`.cjs` / `.mjs`), loaded only in trusted workspaces: `decorators`, `define`, `mocks`, `aliases`, `esbuildPlugins`.
- **Auto-mocks**:
  - Packages that aren't installed become no-op mocks instead of failing the build.
  - `TurboModuleRegistry` and `requireNativeComponent` are mocked.
  - The 26 React Native APIs react-native-web lacks (`PlatformColor`, `PermissionsAndroid`, `ToastAndroid`, `useAnimatedValue`, …) are shimmed.
- **Create mock for …** quick fix on the warning RN Lens puts on imports of auto-mocked packages. It writes a typed stub for the names you import.
- **Inline variants** from `export const previews = { … }` in the component file (flat, or keyed by export name).
- **Fonts**: `expo-font`'s `useFonts` / `loadAsync` with `require('./x.ttf')`.
- Changing `rnLens.networkAllowList` updates the preview's Content Security Policy straight away.
- Expo's Metro dev-server clients and LogBox are disabled in previews.

### Phase 2 — MVP

- **▶ Preview CodeLens** above every exported component.
- **Device presets**: iPhone SE, 15, 15 Pro Max, Pixel 8, Galaxy S24 and iPad (10th gen), plus custom sizes. Portrait/landscape rotation and zoom (fit, or 50–200%).
- **Light/dark toggle** wired to `useColorScheme()` / `Appearance`. `Dimensions` / `useWindowDimensions()` report the simulated device, and `SafeAreaView` uses its insets.
- **Simulated platform**: `Platform.OS` / `Platform.select` follow `rnLens.simulatedPlatform`. Your own `.ios` / `.android` / `.native` files resolve for it, and the preview rebuilds when the setting changes.
- **Variants** from colocated `<Name>.preview.tsx` files, chosen from a toolbar dropdown without starting a new build context.
- **Decorators** from `.rnlens/decorators.tsx`.
- **Error overlay**: build errors and runtime errors, mapped through source maps, with frames that open the editor at the right line. A top-level error boundary is included, and the last good render stays visible underneath.
- **Console forwarding** to the *RN Lens* output channel, with a message count in the toolbar.
- **Native module mocks**:
  - Project mocks in `.rnlens/mocks/` take priority, followed by the built-in mocks.
  - Built-in mocks: AsyncStorage, device-info, haptic-feedback, expo-haptics, safe-area-context, vector-icons, expo-constants, expo-status-bar, expo-splash-screen and react-native-config.
  - `NativeModules.*`, `react-native/*` internals and Node built-ins become auto-mocks.
  - A toolbar badge lists the mocked packages.
- **Assets**: images become `{ uri, width, height }`, picking the highest `@Nx` density and using logical sizes. Files of 100 KB or less are inlined; larger ones are served from the cache. Fonts become URLs, which makes `@expo/vector-icons` work.
- **Flow** type stripping for packages in `node_modules`, cached on disk.
- `app.json` `expo` config feeds `expo-constants`; `.env` files feed `EXPO_PUBLIC_*` and `react-native-config`.
- **Status bar item**, **Clear Cache** and **Show Output** commands. Preview panels are restored after a VS Code restart, with their toolbar state (not yet covered by an automated test).

### Phase 1 — Hello preview

- **RN Lens: Open Preview** renders the active file's default export (or first exported component) in an iPhone 15 frame beside the editor. Also available from the editor title bar's eye icon.
- **RN Lens: Preview Component** (used by CodeLens in Phase 2) and **RN Lens: Reload**.
- In-process esbuild bundler (`src/bundler/`): lazy-loaded, one incremental context per preview, overlapping rebuilds coalesced so the newest edit wins.
- `react-native` is aliased to react-native-web; every `react` / `react-dom` import resolves to a single copy.
- Fallback `react`, `react-dom` and `react-native-web` shipped in `vendor/`, used when the project doesn't have a matching pair.
- Platform-specific files resolve in the order `.web.*`, `.<platform>.*`, `.native.*`, plain.
- Exported-component detection with `@babel/parser` (`src/codelens/componentDetection.ts`).
- Preview webview with a strict Content Security Policy, bundle injection via Blob URL, rebuild on save, and plain build/runtime error overlays that keep the last successful render visible.
- `rnLens.networkAllowList` origins are validated and added to the CSP's `connect-src`.
- Commands report failures through `safeCommand`: user-facing explanations as warnings, unexpected errors logged with stack traces.

### Phase 0 — Scaffold

- Extension manifest: commands, Command Palette and editor-title menus, all `rnLens.*` settings from PRD §6.6, Getting Started walkthrough, Workspace Trust declaration (`limited`).
- React Native / Expo project detection (`src/project/detectProject.ts`) with a workspace registry that keeps the `rnLens.isRNProject` context key in sync as `package.json` files change.
- "RN Lens" log output channel.
- Build (esbuild), lint (ESLint + Prettier), unit tests (vitest + coverage thresholds), integration tests (`@vscode/test-electron` + mocha).
- GitHub Actions CI on Ubuntu, Windows and macOS, plus per-platform VSIX packaging.
- Test fixtures: `test/fixtures/expo-app` (create-expo-app `blank-typescript`) and `test/fixtures/bare-rn-app`.
