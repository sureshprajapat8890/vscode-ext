# Decisions

Non-obvious decisions made while building RN Lens, newest last. Each entry says what was decided and why.

## Phase 0

### D-1. TypeScript 5.9.3, not the latest major

npm's `latest` TypeScript is 7.x. BUILD_PROMPT requires TypeScript 5.x and typescript-eslint 8.x only supports `<6.1`, so we pin 5.9.3.

### D-2. `@types/vscode` 1.90.0; `@types/node` 22.x

`@types/vscode` matches the minimum engine (`^1.90.0`) so we can't accidentally use newer APIs. `@types/node` would ideally be 20.x (the Node version in VS Code 1.90), but vitest 5 requires `@types/node >= 22`. The extension bundle targets `node20` in esbuild, which catches syntax problems; avoid Node 22-only runtime APIs in `src/`.

### D-3. Commands without handlers are contributed but not registered in Phase 0

BUILD_PROMPT forbids placeholder code. Phase 0's acceptance only requires the commands to appear in the Command Palette, so they're declared in `package.json` and their handlers land with the phase that implements them. Running one in Phase 0 shows VS Code's "command not found". `rnLens.previewComponent` is hidden from the palette (`when: false`) because it needs an export name and is invoked from CodeLens.

### D-4. Publisher id `rn-lens` is provisional

The PRD owner is TBD. `publisher` must be changed to the real Marketplace publisher before the first release; the extension id in integration tests (`rn-lens.rn-lens`) follows it.

### D-5. Project detection reads package.json; activation still uses `workspaceContains`

Activation follows BUILD_PROMPT (`workspaceContains:**/node_modules/{react-native,expo}/package.json`). Once active, the `ProjectRegistry` decides whether the workspace is an RN project by reading `package.json` files (excluding `node_modules`) for `react-native`/`expo` in dependencies, devDependencies or peerDependencies, as PRD F-1 specifies. This also covers projects whose `node_modules` aren't installed yet once any command activates the extension. Scans are capped at 200 `package.json` files and debounced 500 ms on changes.

### D-6. A `vscode` test double for unit tests

`test/unit/vscodeMock.ts` is aliased as `vscode` in `vitest.config.ts`, so VS Code-bound services (like `ProjectRegistry`) get fast unit tests and count toward the 80% coverage gates. Integration tests still exercise the real API.

### D-7. Bare RN fixture is hand-written

`npx @react-native-community/cli init` generates full `ios/` and `android/` projects that RN Lens never uses. `test/fixtures/bare-rn-app` contains only what a bare app's JS side has: `index.js` calling `AppRegistry.registerComponent`, `App.tsx`, `app.json`, `babel.config.js`, using the same React Native version as the Expo fixture (0.86.3).

### D-8a. mocha 11.x for integration tests

mocha 12 is ESM-only. VS Code 1.90 runs Node 20, which can't `require()` ES modules, so the test suite failed to load on the minimum engine. mocha 11.8 is CommonJS and works on both 1.90.0 and current stable; CI runs integration tests against both.

### D-8b. The integration runner clears `ELECTRON_RUN_AS_NODE`

When tests are launched from a VS Code terminal this variable is inherited and the downloaded VS Code starts as plain Node (it tries to execute the workspace path as a script). `runTest.ts` deletes it before launching.

### D-8. Walkthrough completion events use context keys set in later phases

The "Add a variant" and "Add a decorator" steps complete on `rnLens.hasVariants` / `rnLens.hasDecorators`, which Phase 2 sets when it discovers those files. Until then the steps can be marked done manually.

## Phase 1

### D-9. React and React DOM are chosen as a pair

React 19's React DOM throws unless `react` has exactly the same version. `resolveRuntimeDeps` uses the project's `react` + `react-dom` only when both are installed with identical versions; otherwise both come from `vendor/` (pinned 19.2.8). It logs why, and warns on a major-version mismatch (PRD B-13). The Expo template has `react` but no `react-dom`, so a fresh Expo app previews with the vendor pair. react-native-web is chosen separately (project copy if installed).

### D-10. Vendor fallback via esbuild `nodePaths`, not a resolve plugin

BUILD_PROMPT says "nodePaths: none … vendor/node_modules as fallback via a resolve plugin". A plugin that retries every failed bare import would run on every import in the bundle. esbuild's `nodePaths` already has exactly the fallback semantics we need: it's searched only after the normal `node_modules` walk. React and react-native-web are still pinned by the `singleReact` / `rnAlias` plugins, so `nodePaths` never decides which React is used.

### D-11. External source maps kept in the extension host

BUILD_PROMPT lists `sourcemap: 'inline'`. We emit `sourcemap: 'external'` (`write: false`) instead. The map stays in the extension host, where Phase 2 maps runtime stack frames. Only the code goes to the webview, so a multi-megabyte base64 map isn't re-sent on every rebuild.

### D-12. Component detection pulled forward from Phase 2

"Default export, else the first exported component" needs source order, which module namespaces don't preserve. So the `@babel/parser` detector specified for CodeLens is implemented now and used by Open Preview. Phase 2's CodeLens provider reuses it.

### D-13. One preview panel in Phase 1

Multiple panels are R-11 (P2, Phase 4). Opening a preview for another component retargets the existing panel and releases the previous esbuild context. The panel uses `retainContextWhenHidden` so hiding it doesn't discard the rendered tree.

### D-14. Unmounting uses the root returned by `runApplication`

react-native-web 0.21's `AppRegistry.unmountApplicationComponentAtRootTag(el)` calls `el.unmount()`, which doesn't exist on a DOM element under React 19. The virtual entry keeps the root returned by `runApplication` and exposes `globalThis.__RNLENS_UNMOUNT__`. The webview calls it before running the next bundle, and mounts each bundle into a fresh element.

### D-15. A minimal `process` shim

Many RN packages read `process.env.*` at runtime. `NODE_ENV` and `EXPO_OS` are replaced at build time via `define`; a one-line banner provides `globalThis.process = { env: { NODE_ENV } }` for the rest.

### D-16. esbuild is a runtime dependency

The extension loads esbuild lazily on the first preview, as an external module, because it ships a platform-specific native binary. It moves from devDependencies to dependencies so `vsce` packages it. CI builds one VSIX per platform target with the matching binary.

### D-17. Vendor packages installed by `postinstall`

`vendor/package.json` + `package-lock.json` are committed; `vendor/node_modules` is git-ignored and installed by the root `postinstall` script (`npm ci --prefix vendor --ignore-scripts`). The packaged VSIX includes it.

### D-18. Not yet handled in Phase 1

`react-native/*` sub-path imports, images/fonts, Flow-typed packages and native modules failed with esbuild's error in the overlay in Phase 1. Phase 2 handles them (see D-19 onwards).

## Phase 2

### D-19. Libraries resolve as on web; platform files apply to project code only (deviates from PRD B-3)

PRD B-3 orders `.web.*`, `.<platform>.*`, `.native.*`, then plain, for every file. Applied to `node_modules`, that picks native implementations: for example `expo-modules-core` ships `NativeViewManagerAdapter.native.tsx` (native, imports `react-native/Libraries/*`) next to a plain web version, and the preview broke on it. Expo's own Metro web config resolves libraries as `.web.*`, then plain. So esbuild's global `resolveExtensions` are web-first. A small `platformExtensions` plugin applies the full PRD order to relative imports in the project's own code, which is where `Screen.ios.tsx` / `Screen.android.tsx` live. Aliased imports (tsconfig `paths`) get web-first resolution for now.

### D-20. `react-native` resolves to a wrapper module; Dimensions and Appearance are patched in place

`react-native` maps to `webview/runtime/reactNative.ts`, which re-exports react-native-web but overrides `Platform` (reports the simulated OS), `SafeAreaView` (device insets) and `NativeModules` (auto-mock Proxy). react-native-web's internals keep seeing `web`. `Dimensions` and `Appearance` are patched in place, because react-native-web's own `useWindowDimensions`, `useColorScheme` and `PixelRatio` read them. The webview shell owns device state and exposes it through `globalThis.__RNLENS_HOST__` (`webview/runtime/host.ts`). Its listeners are reset before each bundle runs.

### D-21. Source maps are built on demand, verified by fingerprint (refines D-11)

Generating source maps was a sizeable share of every warm rebuild, but a map is only needed when an error happens. Normal rebuilds skip maps. On the first runtime error, `BundlerService.sourceMapFor` rebuilds the same target in a second, lazily created context with `sourcemap: 'external'`. esbuild is deterministic, so the map is used only if its code fingerprint (ignoring the `sourceMappingURL` comment) matches the bundle running in the preview. Otherwise frames are shown unmapped rather than wrongly mapped.

### D-22. flow-remove-types over sucrase, loaded lazily

flow-remove-types tracks the official Flow parser, so it keeps up with new Flow syntax used in React Native's own sources. Sucrase's Flow support lags behind. Its parser is large, so `flow-remove-types` is external to the extension bundle and `import()`ed the first time a Flow file is seen. Detection checks every leading comment block for `@flow` (React Native puts it several lines into the header), or `import type` / `export type`. Results are memoised per session and cached on disk by path, mtime and size.

### D-23. Mocks and preview runtime ship as TypeScript sources

Built-in mocks (`src/mocks/*`) and the preview runtime (`webview/runtime/*`) are bundled into each preview by the user's esbuild context, against the user's React. So the build copies them as source into `dist/mocks` and `dist/runtime` instead of compiling them. `src/mocks/index.ts` is the extension-side registry and isn't copied. They're type-checked by `tsconfig.preview.json`, which maps `react-native` to the wrapper and `rnlens:runtime/*` to the runtime. Mocks import runtime helpers through the virtual `rnlens:runtime/<module>` specifier, so they work from both the source tree and `dist`.

### D-24. Auto-mocks for React Native internals and Node built-ins pulled forward

PRD B-2 (P0) requires `react-native/Libraries/*` sub-paths to be shimmed or mocked, so they become auto-mocks now instead of in Phase 3. `node:*` imports always become auto-mocks; bare built-in names (`fs`, `events`, …) only when the project has no browser polyfill package of that name. Expo's `expo-font` imports `node:async_hooks` on a server-rendering path. Each auto-mock logs a one-time warning naming the module and how to replace it.

### D-25. Packages nested in `expo/node_modules` are resolvable

npm sometimes nests Expo's own dependencies (in the fixture, `expo-asset`) under `node_modules/expo/node_modules`. Expo's resolver makes them importable from the app, but plain Node resolution doesn't. That directory is added to esbuild's `nodePaths` fallback, ahead of the vendor directory.

### D-26. safe-area-context is a full mock, not its web build

The library's web build measures CSS `env(safe-area-inset-*)`, which is always 0 in an editor panel. The mock implements its public API (`SafeAreaProvider`, `SafeAreaView` with `edges` / `mode`, hooks, contexts, `initialWindowMetrics`, `withSafeAreaInsets`) on top of the simulated device's insets, which follow rotation.

### D-27. Asset modules are CommonJS; fonts are URL strings

Images export `module.exports = { uri, width, height, scale }`, so both `require('./a.png')` (React Native style) and `import a from './a.png'` give the object react-native-web's `Image` expects. Fonts export a URL string, which is what expo-font / expo-asset accept on web. Without that, `@expo/vector-icons` fails to load its glyph fonts.

### D-28. Console bridge lives in the shell

CONTRIBUTING lists `webview/runtime/consoleBridge.ts`. The bridge wraps `console` in the webview shell before any bundle runs (the bundle shares the window), so it's `webview/consoleBridge.ts`. `webview/runtime/` is reserved for code bundled into previews.

### D-29. Test-only webview messages

Integration tests drive the webview through `__test_snapshot` (rendered text, overlay state, device), `__test_click_frame` and `__test_set_env`. The extension only exposes these through `api.testing` when `context.extensionMode === Test`.

### D-30. Measured performance and test budgets

Each esbuild `onResolve` / `onLoad` callback that matches is a round trip between esbuild's Go process and JavaScript, so plugin filters are kept narrow. The platform-extensions filter is built from the names of the project's actual platform-specific files (found by a one-time scan, ignoring node_modules), instead of matching every relative import. That cut the warm-build p90 from about 290 ms to about 200 ms. Saving any `*.ios|android|native.*` file recreates the context so new names are picked up.

On the development machine (Windows, with other load), the integration suite measures:

| Metric | Latest stable VS Code | VS Code 1.90.0 |
|---|---|---|
| Cold preview, including webview creation | about 1.8 s | about 1.6 s |
| Warm build p90 over 20 edits | about 190 ms | about 220 ms |
| Save → rendered p90 | about 330 ms | about 380 ms |

The tests enforce the PRD targets (3 s cold, 300 ms warm p90); `RNLENS_COLD_BUDGET_MS` / `RNLENS_WARM_BUDGET_MS` can loosen them on slow CI machines. Most of the remaining end-to-end time is re-evaluating React and react-native-web on every change. Fast Refresh (Phase 4), or splitting them into a separate vendor bundle, is the way to reduce it.

### D-31. `vscode.executeCodeLensProvider` needs the document open

Calling it for a file that isn't open fails with "Illegal argument" in current VS Code, so the CodeLens test opens the document first.

## Phase 3

### D-32. App preview mounts however the app mounts itself

Apps start in different ways:

- **Expo's web `registerRootComponent`** uses its own `AppRegistry`, and renders into `document.getElementById('root')` as soon as the module loads.
- **Bare apps** only call `AppRegistry.registerComponent`.
- **`index.web.js` entries** may call `runApplication` themselves.

Rather than intercepting each of these, every `react-dom/client` import in a preview resolves to `webview/runtime/reactDomClient.ts`, which tracks the roots it creates (the wrapper's own import of `react-dom/client` goes to the real module). The shell's mount element has `id="root"`. The app entry imports the user's entry module; if no root was created, it runs the last app registered with react-native-web's `AppRegistry`, wrapped in RN Lens's error boundary. Unmounting before the next bundle is `unmountAll()` over the tracked roots, which replaces the per-entry unmount hook from D-14.

### D-33. expo-router: generated route context, and a "/" initial URL

expo-router reads its routes through `expo-router/_ctx`, a Metro-only `require.context(appRoot, …)`. RN Lens resolves `expo-router/_ctx` to a generated module that imports every route file under `app/` (or `src/app/`). It uses the same exclusions as expo-router's own `_ctx` (API routes, `+middleware`, `+html`, `+native-intent`, `.d.ts`) and exposes `ctx(key)`, `ctx.keys()` and `ctx.resolve()`. It's regenerated on every build, so new routes appear. `EXPO_ROUTER_APP_ROOT`, `EXPO_ROUTER_ABS_APP_ROOT` and `EXPO_ROUTER_IMPORT_MODE` are defined as Metro would.

On web, expo-router takes its initial route from `window.location`, and the webview's path is `/index.html`, which showed the not-found screen. The shell sets the path to `/` with `history.replaceState`. It must keep the query string: VS Code 1.90's webview service worker identifies the webview from `?id=…` when serving resources, and dropping it broke images and fonts served from the asset cache.

### D-34. Metro-only development code is disabled

These Expo development features assume a Metro dev server:

- `expo/src/async-require/{setup,setupHMR,setupFastRefresh,messageSocket,hmr}`, which start HMR, Fast Refresh and the message socket. They load as empty modules.
- `@expo/metro-runtime`, which is mocked.
- `@expo/log-box/lib`, Expo's LogBox, which would draw a second error UI in a shadow root. It's mocked.

RN Lens's overlay and output channel already cover errors and warnings.

### D-35. The simulated platform applies to project code; libraries see `web` (refines BUILD_PROMPT's `EXPO_OS` define)

Libraries branch on `Platform.OS` and `process.env.EXPO_OS` to choose native or web code. Reporting `ios` made Reanimated call `runOnUISync` ("not supported on web") and would push Expo modules onto native paths. So:

- **`react-native` imports from `node_modules`** resolve to `reactNativeLibrary.ts`, whose `Platform` is react-native-web's (`OS: 'web'`).
- **The project's own code** gets the simulated `Platform`.
- **`@react-navigation/*`** is allow-listed to see the simulated platform, because it uses `Platform` only for look and feel and works with `ios` / `android` on web.
- **`process.env.EXPO_OS`** is defined as `"web"` everywhere. BUILD_PROMPT said `"<plat>"`, but project code that needs the simulated platform should read `Platform.OS`.

### D-36. React Native APIs missing from react-native-web are shimmed

React Native 0.86 exports 26 public names that react-native-web 0.21 doesn't. An import of any of them, even deep in a library (for example `PlatformColor` in `expo-symbols`), failed the whole build with "No matching export". `webview/runtime/rnCompat.tsx` supplies all of them:

- **Behavioural stand-ins** where web has a sensible equivalent: `PlatformColor` maps iOS semantic colours, `DynamicColorIOS` follows the scheme, `PermissionsAndroid` grants everything, `ToastAndroid` logs to the console, the `useAnimated*` hooks work, and `EventEmitter` is implemented.
- **`View`-based components** for native-only views.
- **No-op auto-mocks** for the rest.

`TurboModuleRegistry` (PRD N-5) and `requireNativeComponent` are also provided. The list came from diffing `react-native/index.js` against react-native-web's exports, and should be re-checked when React Native adds public APIs.

### D-37. Missing packages are auto-mocked by retrying the build (PRD N-3)

esbuild has no hook for "this import failed to resolve", and catching every bare import in JavaScript would slow every build (see D-30). Instead, when a build fails and *every* error is `Could not resolve "<bare package>"`, those packages are added to that context's auto-mock set and the build is retried with a fresh context (at most 3 times). Successful builds pay nothing. Mixed failures, such as a syntax error alongside a missing package, are reported as they are.

### D-38. Auto-mocks look like plain function components

- **Named imports:** esbuild's CommonJS interop copies only a module's *own* properties into the import namespace, but inherits from its prototype. The auto-mock Proxy's `getPrototypeOf` therefore returns a Proxy that resolves any name, so `import { Marker } from 'mocked'` works.
- **React introspection:** React probes `$$typeof`, `prototype.isReactComponent`, `defaultProps`, `contextType` and similar keys. Those read as absent, and `prototype` / `length` are the function's real ones; otherwise React treats the mock as a class or memo and fails.
- **Subclasses:** `class X extends Mock {}` builds real `X` instances.

### D-39. "Create mock for …" quick fix

`MockDiagnostics` puts a warning on the quoted specifier in each project file that imports an auto-mocked package. Node built-ins (`node:*`) are excluded; mocks written for those would never be used in a browser. The quick fix:

1. Reads how that file imports the package (default, named, namespace; type-only imports ignored).
2. Writes a typed stub to `.rnlens/mocks/<package>.ts(x)`:
   - PascalCase names become components that render a `View` with their children.
   - UPPER_CASE names become constants.
   - Everything else becomes a no-op function.
3. Opens the stub and reloads the preview. It never overwrites an existing mock; it opens it instead.

### D-40. Follow the active editor, and Toggle Lock (PRD F-7)

F-7's "keep previewing a component while editing other files" implies an unlocked preview follows the active editor. While unlocked, switching to another JS/TS file in the project that exports a component retargets the preview, debounced by 250 ms. It doesn't follow into `node_modules`, `.rnlens/` (mocks and decorators), or files opened by clicking an error-overlay frame. App previews never follow. The lock is per panel, shown in the toolbar (🔒/🔓), in the title bar, and in the `rnLens.previewLocked` context key.

### D-41. `onType` mode

Edits debounced by 300 ms trigger a rebuild. The unsaved-buffers plugin serves `document.getText()` for open, dirty project files. Its esbuild filter lists the project's top-level entries (minus `node_modules`) because Go's regex engine has no lookaheads, and it matches Windows drive letters in either case, so `node_modules` files never reach JavaScript. Changing `rnLens.updateMode` reloads the preview.

### D-42. Project configuration

- **Sources, in increasing precedence:** Babel `module-resolver` aliases and `root`s (parsed with `@babel/parser`; only string literals, `^regex` aliases skipped, never executed), then `rnLens.extraAliases`, then `rnlens.config.js` `aliases`.
- **Roots** become esbuild `nodePaths`.
- **Aliases into project code** get platform variants (D-19). `tsconfig.json` `paths` are resolved natively by esbuild and don't.
- **`rnlens.config.js` / `.cjs`** is loaded with `require`, with the require cache cleared so edits are re-read.
- **ESM configs** (`.mjs`, or `require` failing with `ERR_REQUIRE_ESM`) are loaded with a native dynamic `import()`. It's wrapped in `new Function` because the CommonJS extension bundle would otherwise compile `import()` into `require`.
- **Trust:** the config is only executed when `vscode.workspace.isTrusted`. Granting trust reloads the preview.
- **Unknown options** are reported in the output channel.

### D-43. Toolbar platform is per preview

The toolbar's iOS / Android / Web selector changes the open preview only. It's persisted with the panel, so it survives a restart. Changing `rnLens.simulatedPlatform` applies the new value to the open preview, and new panels start from the setting.

### D-44. Inline `previews` objects (PRD P-3)

`export const previews = { Name: props }` applies to the file's default export, or, if there's none, its first exported component. If every key names an exported component and every value is an object, the object is keyed by export: `{ Button: { Primary: props } }`. These "props" variants are listed after the `.preview` file's variants; on a name clash, the `.preview` file wins. Saving the component file refreshes the list.

### D-45. Integration-test notes

- **The navigation test** presses on-screen elements through a `__test_press` webview hook: it clicks the innermost element whose text matches, and react-native-web's `Pressable` handles `click`.
- **The follow test** opens the component in an editor before previewing, as in real use. With no editor open, the preview lands in the first group, and VS Code replaces it when a file opens in that group (documented in the README).
- **Debug output:** `api.testing.recentLog()` exposes the last 300 output-channel lines, and failure messages include them.
