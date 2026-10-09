# PRD: RN Lens — Instant React Native Preview inside VS Code

| Field | Value |
|---|---|
| Product | RN Lens (VS Code extension) |
| Status | Draft v1.0 |
| Owner | _TBD_ |
| Last updated | 2026-10-06 |

---

## 1. Problem

Previewing React Native UI today requires one of: an iOS Simulator (macOS only, ~10+ GB Xcode), an Android Emulator (heavy, slow on low-RAM machines), or a physical device with Expo Go / a dev build installed. This creates real friction:

- **Slow feedback loop.** Booting an emulator and bundling via Metro takes 30 s–3 min; developers lose flow for small UI tweaks.
- **Hardware barriers.** Many developers (students, freelancers, contributors on Windows/Linux, people on 8 GB laptops) cannot run emulators comfortably, and Windows/Linux users cannot run the iOS Simulator at all.
- **Context switching.** Code lives in VS Code, the UI lives in a separate window or a phone.
- **Component isolation is hard.** Seeing a single component (a Button, a Card) requires wiring it into a screen and navigating to it.

## 2. Solution overview

A VS Code extension that renders React Native components **inside a VS Code webview panel** by compiling the user's code to the web on the fly using **react-native-web** and an in-process **esbuild** bundler. The panel shows the component inside a phone-shaped device frame, updates live on save (or on keystroke), and surfaces errors inline.

This is the same core technique that powers Expo's web target and Snack's web preview: `react-native` imports are aliased to `react-native-web`, which implements `View`, `Text`, `StyleSheet`, `Pressable`, `ScrollView`, `FlatList`, `Image`, `TextInput`, `Animated`, etc. on top of React DOM.

### Feasibility statement

| Works well (≈80–90 % of everyday UI work) | Works with shims/mocks | Not possible in v1 |
|---|---|---|
| Core RN components & StyleSheet, Flexbox layout | Native modules (camera, haptics, secure storage) via mock registry | Running real native code (Swift/Kotlin/C++ TurboModules) |
| Hooks, state, context, most JS libraries | `Platform.OS === 'ios' / 'android'` via simulated Platform | Pixel-perfect native text rendering & shadows |
| React Navigation, Expo libraries with web support | Reanimated / Gesture Handler (web builds exist, partial fidelity) | Native-only UI libraries without web implementation |
| Images, fonts, SVG (react-native-svg has web support) | Flow-typed packages in node_modules (needs strip step) | Performance profiling representative of devices |

**Positioning:** RN Lens is a *fast UI iteration tool*, not a replacement for device testing.

## 3. Goals & non-goals

### Goals
1. Preview a React Native component or screen in VS Code in **< 3 s cold, < 300 ms warm** after save.
2. Zero native toolchain required: no Xcode, Android Studio, emulator, or phone.
3. Works on Windows, macOS, Linux, and in browser-hosted VS Code environments where Node extension hosts are available (Codespaces, remote SSH).
4. Support both **Expo** and **bare React Native CLI** projects.
5. Component-level isolation: preview any exported component with chosen props.
6. Clear, actionable errors when something cannot run on web.

### Non-goals (v1)
- Executing native modules or native UI components.
- Replacing Metro, Expo Go, or real-device QA.
- Visual regression testing / screenshot diffing (candidate for v2).
- Supporting React Native for Windows/macOS targets.

## 4. Target users & personas

| Persona | Need |
|---|---|
| **Riya, solo dev on a Windows laptop (8 GB RAM)** | Wants to build UI without an emulator crushing her machine; cannot run the iOS Simulator at all. |
| **Marco, senior RN engineer** | Wants a component playground next to his code to iterate on design-system pieces quickly. |
| **Students / bootcamp learners** | Want to learn RN without a 2-hour toolchain setup. |
| **Designers / reviewers in Codespaces** | Want to glance at a PR's UI changes without installing anything. |

## 5. User stories

1. As a developer, I can run **"RN Lens: Open Preview"** and see the current file's default-exported component rendered in a phone frame.
2. As a developer, I can click a **"▶ Preview" CodeLens** above any exported component to preview that specific component.
3. As a developer, when I save, the preview updates automatically and keeps the panel's device settings.
4. As a developer, I can switch device frames (iPhone SE, iPhone 15, Pixel 8, iPad, custom W×H) and toggle light/dark color scheme.
5. As a developer, I can toggle simulated platform (iOS / Android) so `Platform.OS` and `Platform.select` branches render accordingly.
6. As a developer, I can provide props for a component via a `*.preview.tsx` file or an exported `previews` object, and switch between named variants.
7. As a developer, when my code throws, I see an error overlay with the stack trace mapped to my source, and clicking a frame opens the file at that line.
8. As a developer, `console.log` output from the preview appears in a VS Code Output channel ("RN Lens").
9. As a developer, when I import a native-only module, I see a clear warning naming the module and a one-click action to generate a mock for it.
10. As a developer, I can preview my whole app entry (`App.tsx` / `expo-router` app) not just isolated components.

## 6. Functional requirements

### 6.1 Activation & commands
| ID | Requirement | Priority |
|---|---|---|
| F-1 | Activate when workspace `package.json` lists `react-native` or `expo` as a dependency. | P0 |
| F-2 | Command `rnLens.openPreview` — preview active file (default export, else first exported component). | P0 |
| F-3 | Command `rnLens.previewComponent` — invoked by CodeLens with a specific export name. | P0 |
| F-4 | Command `rnLens.previewApp` — preview the app entry (`App.tsx`, `index.js` `AppRegistry.registerComponent`, or `expo-router` `app/` directory). | P1 |
| F-5 | Command `rnLens.reload` and `rnLens.clearCache`. | P0 |
| F-6 | Editor title button (eye icon) on `.js/.jsx/.ts/.tsx` files in RN projects. | P0 |
| F-7 | "Lock preview" toggle: keep previewing a component while editing other files. | P1 |

### 6.2 Bundling
| ID | Requirement | Priority |
|---|---|---|
| B-1 | Use esbuild (JS API, incremental `context()`) running in the extension host. | P0 |
| B-2 | Alias `react-native` → `react-native-web`. Also alias known sub-paths (`react-native/Libraries/...`) to shims where possible. | P0 |
| B-3 | Resolve platform extensions in order: `.web.*`, `.<simulatedPlatform>.*`, `.native.*`, then plain. Extensions: tsx, ts, jsx, js, mjs, cjs, json. | P0 |
| B-4 | Strip Flow types from `node_modules` packages that ship untranspiled Flow (detect `@flow` pragma) using `flow-remove-types` or sucrase. | P0 |
| B-5 | Treat `.js` files as JSX-capable (`loader: { '.js': 'jsx' }`) because RN ecosystem ships JSX in `.js`. | P0 |
| B-6 | Define `__DEV__ = true`, `process.env.NODE_ENV = "development"`, `global = globalThis`, `process.env.EXPO_OS`. | P0 |
| B-7 | Assets: images (`png,jpg,gif,webp`) inlined as data URLs below 100 KB, else served via `webview.asWebviewUri`; support `@2x/@3x` resolution by picking highest density. | P0 |
| B-8 | Fonts (`ttf,otf`) loaded via `@font-face` injection; support `expo-font` `useFonts`. | P1 |
| B-9 | SVG imports via `react-native-svg-transformer` convention → transform to `react-native-svg` components. | P2 |
| B-10 | Respect project `tsconfig.json` `paths` and `babel-plugin-module-resolver` aliases (parse `babel.config.js` best-effort). | P1 |
| B-11 | Emit inline source maps; map runtime errors back to original source. | P0 |
| B-12 | Rebuild on save (default) or debounced on change (setting `rnLens.updateMode: "onSave" | "onType"`); for onType, read unsaved buffer contents via an esbuild plugin that serves open `TextDocument` text. | P0 / P1 |
| B-13 | Dependency resolution: prefer the project's `react`, `react-dom`, `react-native-web`. If `react-native-web`/`react-dom` are missing, use versions bundled inside the extension, and dedupe so exactly one copy of `react` is in the bundle. Warn on React major-version mismatch. | P0 |

### 6.3 Native module handling
| ID | Requirement | Priority |
|---|---|---|
| N-1 | Ship a built-in **mock registry** for common native-only packages (e.g. `react-native-haptic-feedback`, `react-native-device-info`, `@react-native-async-storage/async-storage` → localStorage-backed, `react-native-vector-icons` → web font build, `react-native-safe-area-context` → web impl, `react-native-reanimated` → its web build, `react-native-gesture-handler` → web build). | P0 |
| N-2 | Users can add mocks in `.rnlens/mocks/<package-name>.ts(x)`; these override built-ins. | P0 |
| N-3 | Unknown failing native modules: bundle a Proxy-based auto-mock that returns no-op functions/`null`, and log a warning listing the module. | P1 |
| N-4 | Quick-fix action "Create mock for <pkg>" generates a stub file in `.rnlens/mocks/`. | P1 |
| N-5 | `NativeModules` and `TurboModuleRegistry.get` return auto-mocks instead of throwing. | P1 |

### 6.4 Preview runtime (webview)
| ID | Requirement | Priority |
|---|---|---|
| R-1 | Render inside a device frame with correct logical size (dp ≈ CSS px), status bar mock, rounded corners, notch/home-indicator overlays. | P0 |
| R-2 | Device presets + custom size; zoom (fit / 50–200 %); rotate landscape. | P0 |
| R-3 | Color scheme toggle wired to `Appearance` / `useColorScheme`. | P0 |
| R-4 | Simulated platform toggle: patch `Platform.OS`, `Platform.select`, and rebuild resolving `.ios.*` / `.android.*` files. | P1 |
| R-5 | Safe-area insets per device fed to `react-native-safe-area-context`. | P1 |
| R-6 | Error overlay (syntax errors from build + runtime errors from React error boundary) with source-mapped stack; clicking a frame → `vscode.window.showTextDocument` at line/col. | P0 |
| R-7 | Forward `console.*` to an Output channel; show count badge in the panel toolbar. | P0 |
| R-8 | Preserve device/zoom/variant settings across reloads (webview `getState/setState`). | P0 |
| R-9 | React Fast Refresh to preserve component state across edits. | P2 |
| R-10 | Strict CSP with nonce; scripts loaded only via `asWebviewUri`; no remote network by default except an allow-list setting for `fetch` to dev APIs. | P0 |
| R-11 | Multiple preview panels side by side (e.g., iPhone + Pixel). | P2 |

### 6.5 Component previews & props
| ID | Requirement | Priority |
|---|---|---|
| P-1 | CodeLens "▶ Preview" above exported function/arrow components (detected via TypeScript compiler API or a lightweight Babel parse: exported, PascalCase, returns JSX). | P0 |
| P-2 | Convention A — colocated file `Button.preview.tsx` exporting named variants: `export const Primary = () => <Button title="Go" />`. | P0 |
| P-3 | Convention B — in-file export `export const previews = { Primary: { title: "Go" }, Disabled: { disabled: true } }` for the component. | P1 |
| P-4 | Variant picker dropdown in panel toolbar. | P0 |
| P-5 | Global decorators file `.rnlens/decorators.tsx` to wrap previews in providers (theme, store, i18n, navigation container). | P0 |
| P-6 | Read existing Storybook `*.stories.tsx` (CSF3) as a preview source. | P2 |

### 6.6 Configuration (settings + `rnlens.config.js`)
- `rnLens.updateMode`: `onSave` | `onType` (default `onSave`)
- `rnLens.defaultDevice`: preset id (default `iphone-15`)
- `rnLens.simulatedPlatform`: `ios` | `android` | `web` (default `ios`)
- `rnLens.entry`: override app entry path
- `rnLens.extraAliases`: `{ [from]: to }`
- `rnLens.networkAllowList`: string[]
- Project file `rnlens.config.js` for anything code-based (custom esbuild plugins, mocks map, decorators path, define values).

## 7. Non-functional requirements

| Area | Target |
|---|---|
| Performance | Cold build < 3 s for a typical Expo app (~300 modules); warm rebuild < 300 ms (p90). Extension activation < 200 ms (lazy-load esbuild). |
| Memory | Extension host overhead < 250 MB during preview. |
| Platforms | Windows, macOS, Linux (x64 + arm64); Remote-SSH, WSL, Dev Containers, Codespaces. esbuild platform binaries packaged per-target VSIX. |
| Security | No telemetry by default (opt-in only); CSP-locked webview; user code runs only inside the sandboxed webview; never executes `rnlens.config.js` without workspace trust (`vscode.workspace.isTrusted`). |
| Accessibility | Toolbar fully keyboard-navigable; respects VS Code theme colors and high-contrast themes. |
| Reliability | A build failure never crashes the panel; last successful render stays visible beneath the error overlay. |

## 8. UX

```
┌─────────────────────────────── RN Lens: LoginScreen ────────────────────────────┐
│ [iPhone 15 ▾] [iOS ▾] [☀/🌙] [Variant: Default ▾] [⟳] [🔒] [Zoom: Fit ▾] [⚠ 2]   │
├──────────────────────────────────────────────────────────────────────────────────┤
│                         ╭───────────────────────╮                                │
│                         │ 9:41          ▂▄▆ 🔋  │                                │
│                         │                       │                                │
│                         │   [ rendered RN UI ]  │                                │
│                         │                       │                                │
│                         │        ───────        │                                │
│                         ╰───────────────────────╯                                │
│  web-rendered preview · native fidelity may differ                               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Panel opens beside the editor (`ViewColumn.Beside`), preserves focus on the editor.
- Status bar item: `RN Lens: ✓ 142 ms` / `RN Lens: ✗ build error`.
- First-run walkthrough (VS Code Walkthroughs API): open preview → add a variant → add a decorator.

## 9. Architecture

```
┌──────────────────── VS Code Extension Host (Node) ────────────────────┐
│  ProjectDetector ─► ConfigLoader ─► BundlerService (esbuild context)  │
│        │                               │  plugins:                    │
│        │                               │   • rnAliasPlugin            │
│        │                               │   • platformExtPlugin        │
│        │                               │   • flowStripPlugin          │
│        │                               │   • assetPlugin              │
│        │                               │   • mockRegistryPlugin       │
│        │                               │   • virtualEntryPlugin       │
│        │                               │   • unsavedBufferPlugin      │
│  CodeLensProvider   FileWatcher ──────►│                              │
│  PreviewPanelManager ◄── bundle JS + sourcemap + diagnostics          │
│        │ postMessage                                                   │
└────────┼───────────────────────────────────────────────────────────────┘
         ▼
┌──────────────────── Webview (sandboxed browser) ──────────────────────┐
│  Shell UI (toolbar, device frame)  ─  Preview root (iframe-less div)  │
│  runtime: error boundary, console bridge, Platform/Appearance patch   │
│  loads bundle via blob URL / asWebviewUri, AppRegistry.runApplication │
└───────────────────────────────────────────────────────────────────────┘
```

**Virtual entry.** For each preview target the bundler generates an in-memory entry:

```tsx
import { AppRegistry } from 'react-native';
import * as Target from '<abs path to file>';
import Decorators from '<decorators path or identity>';
import { __rnlensRuntime } from 'rnlens:runtime';
const Component = __rnlensRuntime.pick(Target, '<exportName>', '<variant>');
AppRegistry.registerComponent('Preview', () => () => <Decorators><Component/></Decorators>);
AppRegistry.runApplication('Preview', { rootTag: document.getElementById('rn-root') });
```

**Message protocol (extension ⇄ webview)** — all messages are typed:
- → `bundle { code, css, assetsBase, buildMs }`
- → `buildError { errors: Diagnostic[] }`
- → `setDevice { preset, scheme, platform, zoom }`
- ← `ready`, `runtimeError { message, stack }`, `console { level, args }`, `openSource { file, line, column }`, `selectVariant { name }`

## 10. Success metrics

| Metric | Target (6 months post-launch) |
|---|---|
| Time-to-first-preview after install | median < 60 s |
| Warm rebuild latency | p90 < 300 ms |
| % previews rendering without unhandled error | > 85 % |
| Weekly active users / installs | > 30 % |
| Marketplace rating | ≥ 4.3 |

## 11. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Spike (1 wk)** | esbuild + RNW render of a hello-world `View/Text` in a webview. | Renders in < 3 s on Win/macOS/Linux. |
| **M1 — MVP (4 wks)** | F-1–3, F-5–6, B-1–7, B-11–13, N-1–2, R-1–3, R-6–8, R-10, P-1–2, P-4–5. | Previews 10 reference components from a fresh `create-expo-app` and a bare RN CLI template. |
| **M2 — Beta (4 wks)** | App-level preview, simulated platform, safe area, fonts, aliases, auto-mocks, onType mode, quick-fix mocks. | Previews a React Navigation app with 5 screens; Marketplace pre-release. |
| **M3 — 1.0 (3 wks)** | Fast Refresh, multi-panel, Storybook CSF read, walkthrough, docs, perf hardening. | Meets all NFR targets; public release. |

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Libraries without web support crash the bundle | High | Mock registry, auto-mock Proxy, clear warnings, community mock pack. |
| Fidelity gaps (text metrics, shadows, `elevation`) mislead users | Medium | Persistent "web-rendered" disclaimer; docs listing known differences; RNW shadow polyfills. |
| React / RNW version mismatch between project and extension | High | Prefer project deps; single-React dedupe; compatibility table; explicit warning. |
| Flow syntax in node_modules breaks esbuild | High | Flow-strip plugin with cache keyed by file mtime. |
| New Architecture-only packages (Fabric components) | Medium | Auto-mock + document limitation. |
| Executing workspace config is a security risk | Medium | Respect Workspace Trust; restricted mode = no config execution, built-in mocks only. |
| Large monorepos slow cold builds | Medium | Incremental context, persistent cache dir in `globalStorageUri`, `external` for unused heavy deps. |

## 13. Open questions

1. Should we offer an optional "open on device" bridge (QR code to Expo Go) as a fallback for native-only screens?
2. Should Fast Refresh (R-9) move into MVP given how much users value preserved state?
3. Do we support Expo Router file-based routing in M2 or M3?
4. Monetization: fully free/OSS vs. pro tier (visual snapshots, team mock packs)?

## 14. Appendix — Prior art to study
- **react-native-web** (Nicolas Gallagher / Expo) — the rendering foundation.
- **Expo web target & Snack** — proof that RN-to-web preview is practical at scale.
- **Storybook for React Native (web mode)** — component variant conventions.
- **VS Code Live Preview / Markdown Preview** — webview panel UX patterns.
