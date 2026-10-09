# Build Prompt — RN Lens VS Code Extension

> Copy everything below the line into an AI coding agent (e.g. Claude Code) at the root of an empty repository that also contains `PRD.md`, `README.md`, and `CONTRIBUTING.md`. It is written to be executed phase by phase; the agent should stop at the end of each phase, run the checks, and report.

---

## Role

You are a senior TypeScript engineer who has shipped VS Code extensions and deep-knows React Native, react-native-web, and esbuild. You write production-quality, strictly typed, tested code. You make decisions instead of asking about trivia, and you document every non-obvious decision in `docs/DECISIONS.md`.

## Mission

Build **RN Lens**, a VS Code extension that previews React Native components inside a VS Code webview **without any emulator, simulator, or device**, by bundling the user's code with esbuild (running in the extension host) and aliasing `react-native` to `react-native-web`. Read `PRD.md` (source of truth for requirements), `README.md` (user-facing behavior that must be true when you finish), and `CONTRIBUTING.md` (repository layout and standards) before writing code. If this prompt and the PRD conflict, the PRD wins; note the conflict in `docs/DECISIONS.md`.

## Hard constraints

1. **Language/tooling:** TypeScript 5.x, `strict: true`. Extension bundled with esbuild to `dist/extension.js` (CommonJS, `platform: node`, `external: ['vscode', 'esbuild']`). Webview shell bundled separately to `dist/webview.js`.
2. **VS Code engine:** `^1.90.0`. Use only stable APIs.
3. **Dependencies (extension runtime):** `esbuild`, `flow-remove-types` (or `sucrase` — pick one, justify), `source-map-js`, `@babel/parser` (for CodeLens component detection only). Keep the runtime dependency list minimal. Pin versions.
4. **Fallback vendor bundle:** ship pinned `react`, `react-dom`, `react-native-web` in `vendor/` for projects that lack them. At bundle time prefer the project's copies. There must be exactly one `react` instance in any output bundle.
5. **Security:**
   - Webview CSP: `default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' blob:; connect-src <rnLens.networkAllowList joined or 'none'>`.
   - `localResourceRoots` limited to the extension's `dist/`, `vendor/`, the workspace folder, and the cache dir.
   - User code never executes in the extension host. `rnlens.config.js` is loaded only when `vscode.workspace.isTrusted`; declare `capabilities.untrustedWorkspaces: { supported: "limited" }`.
6. **Performance:** lazy-`import('esbuild')` on first preview, not on activation. Use `esbuild.context()` + `rebuild()`. Cancel/coalesce overlapping rebuilds (latest wins). Cache Flow-stripped files in `context.globalStorageUri` keyed by path + mtime + size.
7. **No placeholder code.** No `// TODO: implement`. If something is out of scope for the current phase, don't stub it — leave it out.
8. **Cross-platform paths:** always use `vscode.Uri` / `path` APIs; test on Windows-style paths in unit tests.

## Architecture (implement exactly this shape)

```
Extension host
  ProjectDetector  → finds RN root (nearest package.json with react-native|expo), tsconfig paths, babel module-resolver aliases (parse babel.config.js statically with @babel/parser; don't execute it)
  ConfigService    → merges VS Code settings + rnlens.config.js (trusted only)
  BundlerService   → one esbuild context per (projectRoot, previewTarget, simulatedPlatform); emits {code, css, map, buildMs, warnings} or {errors}
  PreviewPanelManager → owns WebviewPanels, routes messages, persists panel state
  ComponentCodeLensProvider → "▶ Preview" above exported PascalCase components returning JSX
  Diagnostics      → maps runtime stack frames through source maps → file/line/col
Webview
  Shell (toolbar + device frame) → plain TS + small CSS, no React needed for the shell itself (keeps it independent from the user's React version)
  Runtime → receives bundle, injects as <script nonce> via Blob URL, installs console bridge, error handlers, Platform/Appearance patches, then the bundle calls AppRegistry.runApplication
```

### esbuild configuration for the preview bundle
- `bundle: true, format: 'iife', platform: 'browser', target: 'es2020', sourcemap: 'inline', jsx: 'automatic'`
- `loader`: `.js/.jsx` → `jsx`, `.ts/.tsx` default, images → handled by asset plugin, `.ttf/.otf` → asset plugin
- `resolveExtensions`: built dynamically from simulated platform: `['.web.tsx','.web.ts','.web.jsx','.web.js', '.<plat>.tsx', … , '.native.tsx', … , '.tsx','.ts','.jsx','.js','.mjs','.cjs','.json']`
- `mainFields: ['react-native', 'browser', 'module', 'main']` — note: when a package's `react-native` field points to native-only code this can break; implement a per-package override list and default to `['browser','module','main']` for packages in the mock registry's "web-capable" list. Document the decision.
- `conditions: ['react-native', 'browser', 'import', 'default']` with the same caveat.
- `define`: `__DEV__: 'true'`, `process.env.NODE_ENV: '"development"'`, `global: 'globalThis'`, `process.env.EXPO_OS: '"<plat>"'`, plus user defines.
- `nodePaths`: none. Use the project's `node_modules`, then `vendor/node_modules` as fallback via a resolve plugin.

### Plugins (each in its own file with unit tests)
1. **virtualEntry** — namespace `rnlens-entry`. Generates the entry described in PRD §9 for targets: `{kind:'component', file, exportName, variant?}` or `{kind:'app', entryFile}`. For `app`, detect `AppRegistry.registerComponent` calls or expo-router; for expo-router use `expo-router/entry` if present, else show a friendly error.
2. **rnAlias** — `react-native` and `react-native/*` → react-native-web (sub-paths to shims in `src/mocks/rn-internals/` or auto-mock). Apply `rnLens.extraAliases`, tsconfig `paths`, babel module-resolver aliases.
3. **singleReact** — force `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client` to one resolved location.
4. **mockRegistry** — resolution order: `.rnlens/mocks/<pkg>` → `rnlens.config.js mocks` → built-in `src/mocks/<pkg>` → real package. Emits a warning listing every mocked package.
5. **flowStrip** — on `onLoad` for `node_modules/**/*.js`, if file contains `@flow` or `import type`/`export type` syntax esbuild rejects, strip types (cached) and return with `loader: 'jsx'`.
6. **assets** — images ≤ 100 KB → data URL; larger → copy to cache dir and return a `asWebviewUri` string at runtime via an `__RNLENS_ASSET_BASE__` global. Returned module must match RN asset shape that react-native-web's `Image` accepts (`{ uri, width, height }` — read dimensions from PNG/JPEG headers, no native deps). Pick highest `@Nx` variant available.
7. **unsavedBuffers** — `onLoad` for any workspace file that is open & dirty in VS Code returns `document.getText()` (only in `onType` mode).
8. **autoMock** — when esbuild fails to resolve a bare import, or a package matches known native-only signatures (requires `NativeModules`/`TurboModuleRegistry`/`requireNativeComponent` at top level with no web entry), substitute a module exporting a recursive Proxy no-op. Add a warning diagnostic.

### Built-in mocks (Phase 2)
`@react-native-async-storage/async-storage` (localStorage-backed, full API), `react-native-device-info` (common getters), `react-native-haptic-feedback`, `expo-haptics`, `react-native-safe-area-context` (use its web build; provide insets from device preset via a context the runtime sets), `react-native-vector-icons/*` (prefer `@expo/vector-icons` web build when present; else render a placeholder square with the glyph name as `accessibilityLabel`), `react-native-reanimated` (route to its web build; ensure `global._WORKLET`/plugin requirements don't crash), `react-native-gesture-handler` (web build), `expo-constants`, `expo-status-bar`, `expo-splash-screen`, `react-native-config`, `NativeModules` (Proxy).

### Webview runtime details
- Device presets in `webview/devices.ts`: id, name, width, height, safe-area insets, corner radius, platform, status bar height, hasNotch/dynamicIsland, homeIndicator. Include at least: iPhone SE (375×667), iPhone 15 (393×852), iPhone 15 Pro Max (430×932), Pixel 8 (412×915), Galaxy S24 (360×780), iPad 10th gen (820×1180).
- Render root `<div id="rn-root">` sized exactly to the device logical size, CSS-scaled for zoom. Use `transform: scale()` on the frame, never on the root's layout size, so `Dimensions.get('window')` reports device size — patch `Dimensions` / `useWindowDimensions` to return device size and emit change on device switch/rotate.
- Patch `Platform.OS` and `Platform.select` to the simulated platform **before** the user bundle runs (inject via the virtual entry's first import `rnlens:runtime`).
- `Appearance.getColorScheme()` / `useColorScheme()` follow the toolbar toggle; set `color-scheme` on the root.
- Error handling: top-level ErrorBoundary inside the virtual entry + `window.onerror` + `unhandledrejection`. Post `runtimeError` with raw stack; extension maps via source maps and replies with resolved frames for the overlay.
- Console bridge: wrap `console.log/info/warn/error/debug`, serialize args safely (cycles, functions, Errors, max depth 4, max 10 KB per message), forward; still call originals.
- Keep last successful render visible under the error overlay (do not unmount on build error).
- Persist toolbar state via `vscode.setState`; restore on reload. Implement `WebviewPanelSerializer` so panels survive VS Code restart.

### CodeLens component detection
Parse with `@babel/parser` (plugins: `jsx`, `typescript`). A component is: exported (named or default), PascalCase identifier (or default export of function/arrow), function body returns JSX somewhere or is a `memo`/`forwardRef` wrapping such a function. Debounce parsing 300 ms; cache by document version. Show at most one lens per export.

### Variants
- `<Name>.preview.(tsx|jsx|ts|js)` next to the component: each named export is a variant (a zero-arg component).
- In-file `export const previews = { VariantName: props }` applies to the default export or, if `previews` is an object keyed by export name containing variant maps, to that export (`{ Button: { Primary: {...} } }`).
- Toolbar dropdown lists variants; selection triggers a rebuild of the virtual entry only (cheap).

## Phases & acceptance criteria

Work through the phases in order. At the end of each phase: run `npm run lint`, `npm test`, `npm run test:integration`, fix failures, update `CHANGELOG.md`, and summarize what changed, what's next, and any deviations from the PRD.

### Phase 0 — Scaffold
- `package.json` manifest: name `rn-lens`, displayName `RN Lens`, activationEvents `workspaceContains:**/node_modules/react-native/package.json` and `workspaceContains:**/node_modules/expo/package.json` plus the commands; contributes commands, menus (`editor/title` with `when: resourceLangId =~ /(javascript|typescript)react?/ && rnLens.isRNProject`), configuration (all settings in PRD §6.6 with descriptions), walkthrough stub with real steps.
- Build scripts, ESLint + Prettier, vitest, `@vscode/test-electron`, GitHub Actions CI matrix (ubuntu, windows, macos).
- Fixtures: `test/fixtures/expo-app` (generated from the current `create-expo-app` blank-typescript template, `node_modules` installed in CI) and `test/fixtures/bare-rn-app`.
- ✅ F5 launches; the command palette shows all commands.

### Phase 1 — Hello preview (PRD M0)
- BundlerService + virtualEntry + rnAlias + singleReact + vendor fallback.
- PreviewPanelManager with CSP-locked webview, device frame (iPhone 15 only), bundle injection.
- ✅ `RN Lens: Open Preview` on a file exporting `() => <View><Text>Hello</Text></View>` renders in < 3 s cold on all CI OSes (integration test asserts DOM text via a test-only message `__test_snapshot` returning `document.getElementById('rn-root').innerText`).

### Phase 2 — MVP (PRD M1)
- All P0 requirements of PRD: platform extensions, flowStrip, assets, mockRegistry + built-in mocks, error overlay with source maps & click-to-open, console bridge, device presets/zoom/rotate, color scheme, CodeLens, `.preview.tsx` variants, decorators, status bar item, panel serializer, reload/clear-cache.
- ✅ Integration tests: (a) previews 10 reference components in `test/fixtures/expo-app/components/` including FlatList, TextInput, Image (local png), Pressable, ScrollView, Animated, SafeAreaView, a vector icon, a component using AsyncStorage, and one using `Platform.select`; (b) warm rebuild < 300 ms p90 over 20 edits; (c) a thrown error shows the overlay with the correct file:line; (d) clicking a frame opens the editor at that line.

### Phase 3 — Beta (PRD M2)
- App-level preview (AppRegistry + expo-router), simulated platform toggle with rebuild, safe-area insets, fonts (`expo-font` `useFonts` + `require('./x.ttf')`), tsconfig/babel aliases, autoMock + quick-fix "Create mock for <pkg>" (CodeAction on the warning diagnostic writing a typed stub to `.rnlens/mocks/`), `onType` mode with unsavedBuffers, lock preview, `rnlens.config.js` loading (trusted only), network allow-list in CSP.
- ✅ A fixture React Navigation app (native-stack + bottom-tabs, 5 screens) is navigable in the preview; toggling Android renders `.android.tsx` variants.

### Phase 4 — 1.0 (PRD M3)
- React Fast Refresh: inject `react-refresh/runtime` in the webview, wrap modules with registration via an esbuild `onLoad` transform for workspace files only (not node_modules); fall back to full reload when a module exports non-components. Multi-panel support. Read Storybook CSF3 `*.stories.tsx` as variants. Walkthrough content complete. Docs in `docs/`: architecture, known differences vs native, writing mocks.
- ✅ Editing a component's text preserves a counter's `useState` value; all NFR targets in PRD §7 verified by a `npm run bench` script that prints a table.

## Quality bar

- Unit-test coverage ≥ 80 % for `src/bundler/**` and `src/project/**`.
- Every user-visible error message says **what happened, why, and what to do** (e.g. "`react-native-maps` has no web implementation, so RN Lens replaced it with a mock. Create a custom mock: [Create mock]").
- No unhandled promise rejections in the extension host; wrap command handlers with a single `safeCommand()` helper that logs to the *RN Lens* output channel and shows a concise notification.
- Dispose everything (contexts, watchers, panels) — verify with an integration test that opening/closing 20 panels doesn't grow esbuild contexts.
- Respect VS Code theme: toolbar uses `--vscode-*` CSS variables; high-contrast works.

## Deliverables

1. Working extension source per `CONTRIBUTING.md` layout.
2. `README.md` updated so every documented feature is true (remove/mark anything not implemented).
3. `CHANGELOG.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/KNOWN_DIFFERENCES.md`, `docs/WRITING_MOCKS.md`.
4. CI producing platform-specific VSIX artifacts.
5. A final report: what was built, test/bench results, known gaps vs PRD, suggested next steps.

Begin with Phase 0. Before writing code, output a short plan (≤ 20 lines) listing files you will create in this phase.
