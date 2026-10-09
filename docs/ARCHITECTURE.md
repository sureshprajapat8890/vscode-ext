# RN Lens architecture

This document is for contributors. It covers how a component file becomes a rendered preview, how edits reach the preview without losing state, and where each piece lives. Decisions and their reasons are recorded in [DECISIONS.md](./DECISIONS.md) as `D-n`.

## The three processes

```
┌──────────────────────── VS Code extension host (Node) ────────────────────────┐
│ extension.ts ─ commands, CodeLens, diagnostics, test API                      │
│ ProjectRegistry ─ finds RN/Expo projects          PreviewPanelManager         │
│ config.ts ─ aliases, .env, rnlens.config.js           ├─ PreviewPanel (1..n)  │
│ BundlerService ─ esbuild contexts, shared by panels   └─ PreviewPanel         │
└──────────────┬────────────────────────────────────────────────┬───────────────┘
               │ esbuild JS API (lazy-loaded)                    │ postMessage
┌──────────────▼──────────────┐                 ┌────────────────▼──────────────┐
│ esbuild service (Go binary) │                 │ Webview (one per panel)       │
│ app + vendor builds         │                 │ shell: toolbar, device frame, │
└─────────────────────────────┘                 │ overlay, console bridge       │
                                                │ runtime: the user's code      │
                                                └───────────────────────────────┘
```

**User code never executes in the extension host.** The extension host only parses project files: it reads Babel configs, `.env` files, `app.json` and `previews` objects as data. The project's code runs only in the sandboxed webview. The one exception is `rnlens.config.js`, which is code and is loaded only when `vscode.workspace.isTrusted`.

## Source layout

| Path | What it does |
|---|---|
| `src/extension.ts` | Activation, command registration, the test-only API |
| `src/project/` | Project detection (`detectProject`, `ProjectRegistry`), app entry detection, Babel alias parsing, `rnlens.config.js` loading, the mock stub generator |
| `src/codelens/` | Finds exported components with Babel (`componentDetection`) for CodeLens and "Open Preview" |
| `src/preview/` | Panels (`PreviewPanel`, `PreviewPanelManager`), the webview HTML and CSP (`html.ts`), the message protocol, variant discovery, the status bar item |
| `src/bundler/` | `BundlerService`, esbuild options, plugins, the virtual entry, and Fast Refresh (`refresh/`) |
| `src/diagnostics/` | Source maps for runtime errors; "Create mock for …" diagnostics and quick fix |
| `src/mocks/` | Built-in mocks for native-only packages (bundled into previews, not run in the host) |
| `webview/` | The webview shell: toolbar, device frames, error overlay, console bridge |
| `webview/runtime/` | Code bundled *into each preview*: the `react-native` wrapper, Platform, the React DOM root tracker, React Refresh setup, auto-mocks, RN API shims, Storybook story composition |
| `vendor/` | Pinned fallbacks: react, react-dom, react-native-web and react-refresh, for projects that lack them |

## From a file to a preview

1. **Target.** "Open Preview", the CodeLens or following the active editor picks a `PreviewTarget`. This is a component (file, export and optional variant) or the app (an entry file found by `appEntry.ts`). With the project root and the simulated platform it forms a `BundleKey`.
2. **Virtual entry.** `virtualEntry.ts` generates `rnlens:entry`. It imports the runtime first, then the target, picks the variant, wraps it in an error boundary and the project's decorators, and mounts it with `AppRegistry.runApplication` into `#root`. App entries import the project's entry module instead, which registers and mounts itself (D-32).
3. **Build.** `BundlerService` runs two esbuild builds (next section) and returns their code with module records for Fast Refresh.
4. **Deliver.** The `PreviewPanel` plans a hot update or a full reload against what *its* webview is running, then posts a `bundle` message. Vendor code is sent only when the webview lacks that vendor version.
5. **Run.** The webview runs each bundle as a nonce'd `<script>` from a Blob URL, which the CSP allows via `script-src 'nonce-…' blob:`. A full reload unmounts every React root the runtime tracked and replaces `#root`. A hot update re-runs only the planned modules and calls React Refresh.

## Two bundles: app and vendor

React Fast Refresh needs a React instance that survives updates, and a module cache in which unchanged modules keep their exports. So each `BundleKey` has two esbuild contexts (`buildOptions.ts`):

| | App bundle | Vendor bundle |
|---|---|---|
| Contains | The project's own files (not `node_modules`, not `.rnlens/mocks`), the virtual entry, the expo-router route context | Everything else: React, react-native-web, the runtime, mocks, libraries |
| Format | CommonJS, with a metafile | IIFE |
| Rebuilt | On every change | Only when the app starts importing a module the vendor bundle doesn't have |
| Typical warm time | Tens of milliseconds | n/a |

The app build resolves every import with the full set of RN Lens rules (`externalizePlugin` calls `build.resolve` with a marker). It then keeps project files and turns everything else into `require("<namespace>:<path>")`. The vendor build's entry (`vendorEntry.ts`) registers a lazy factory for each such key on `globalThis.__RNLENS_REQUIRE__`. The webview runs the app bundle as `(function (require, module, exports) { … })(globalThis.__RNLENS_REQUIRE__, …)`.

### Resolution rules (both builds)

Plugins, in order of precedence:

1. **`rnlens.config.js` plugins** (trusted workspaces only).
2. **Virtual modules:** `rnlens:entry`, `rnlens:runtime/*`, the expo-router route context.
3. **Mocks** (`mockRegistry.ts`), in this order:
   1. `.rnlens/mocks/<pkg>`.
   2. `mocks` in `rnlens.config.js`.
   3. Preferred alternatives (`react-native-vector-icons` → `@expo/vector-icons` when installed).
   4. Built-in mocks.
   5. Auto-mocks for packages that aren't installed, `react-native/*` internals and Node built-ins.
4. **Aliases:** Babel `module-resolver`, `rnLens.extraAliases`, config aliases, then tsconfig `paths`.
5. **Platform:**
   - **Project files** resolve `.ios` / `.android` / `.native` / `.web` for the simulated platform.
   - **Libraries** resolve as on web (D-35).
   - **`react-native`** goes to the RN Lens wrapper around react-native-web, with shims for APIs react-native-web lacks (D-36).
6. **Single React:** one copy of `react` / `react-dom`, the project's if it has one, otherwise `vendor/`.
7. **Flow:** packages that ship Flow types are stripped with `flow-remove-types`, cached on disk (vendor build only).
8. **Assets:** images become RN asset objects. Small ones are inlined as data URIs; large ones are copied to the cache directory and served to the webview.

## Fast Refresh

**Transform.** Each project file is loaded by `projectSource.ts`, which works like Metro's transformer does for React Native:

1. `analyzeForRefresh` (Babel) finds top-level components and computes their hook signatures. A module is a *boundary* if it exports only components.
2. esbuild's `transform` converts the file to CommonJS with an inline source map. Results are cached per file by content hash, so unchanged files aren't transformed again.
3. `wrapForHotReload` adds, on line 1 so source-map lines stay aligned:

   ```js
   var __rnlensHot = globalThis.__RNLENS_HOT__;
   if (__rnlensHot && __rnlensHot.reuse(module, ID)) { require(…imports…); return; }
   ```

   It also adds a trailer that registers the components with React Refresh and stores the module's exports.

   A reused module still requires its imports. Bundled modules only run when an importer requires them, so without this a changed screen imported only by an unchanged navigator would never re-run.

**Plan.** `planDelivery` (in `refresh/hotPlan.ts`) compares a build with the bundle a webview last received:

- **Full reload** when:
  - it's the panel's first bundle;
  - the target or platform changed;
  - the vendor bundle changed;
  - the virtual entry changed (variant, decorators);
  - or a changed non-boundary module is reached on the way up to the entry.
- **Otherwise a hot update.** Changed modules re-run, and so do the importers of every changed non-boundary module, transitively until a boundary.
- **Explicit actions always remount:** re-opening a preview, Reload, Clear Cache.

Plans are per panel, not per build. A build superseded before delivery, or delivered to a different panel, must not hide changes from a webview.

**Webview.** `runBundle` (in `webview/main.ts`) sets `hot.updating` and `hot.reexecute`, then runs the app bundle. The entry sees `__RNLENS_HOT__.updating` and calls `__RNLENS_REFRESH__.perform()` instead of mounting. React Refresh re-renders the updated component families and keeps their state; hook signature changes remount. The vendor bundle installs React Refresh's DevTools hook first, before react-dom loads (`runtime/refreshSetup.ts`).

## Panels and shared contexts

`PreviewPanelManager` owns every `PreviewPanel` and tracks the active one, the panel focused most recently.

- **Commands** (Reload, Toggle Lock, platform) act on the active panel.
- **Workspace events** (saves, typing, editor switches, settings) reach every panel.
- **Status bar** shows the active panel's state.

`BundlerService` keys its contexts by `bundleKeyId`: project, platform and target, without the variant.

- **Sharing.** Panels showing the same target share the contexts. Each panel is an *owner*; `release(key, owner)` disposes the contexts when the last owner leaves.
- **Reload.** `reset(key)` restarts the contexts and keeps the owners.
- **Coalescing.** Builds of one key run one at a time. Requests that arrive while one is running are merged per target. Two panels showing different variants of a component therefore share contexts but never receive each other's builds.

## Webview and protocol

The webview HTML (`html.ts`) uses a strict CSP:

```
default-src 'none'; img-src ${cspSource} data: blob:; font-src ${cspSource} data:;
style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' blob:;
connect-src <rnLens.networkAllowList or 'none'>
```

The messages, all typed in `src/preview/protocol.ts` and validated on receipt:

| Direction | Messages |
|---|---|
| Host → webview | `init`, `variants`, `building`, `bundle`, `buildError`, `runtimeErrorResolved`, test hooks (`__test_*`) |
| Webview → host | `ready`, `rendered`, `requestFullBundle`, `runtimeError`, `console`, `openSource`, `selectVariant`, `setPlatform`, `toggleLock`, `reload`, `showOutput` |

**Runtime errors.**

1. The webview reports the stack together with the Blob URLs of the app and vendor scripts.
2. The panel builds source maps on demand, in separate map-emitting contexts, so normal rebuilds skip map generation.
3. It trusts a map only if the code it was built with has the same fingerprint as the code that ran.
4. Mapped frames come back as `runtimeErrorResolved`; clicking one opens the file at the line.

## Configuration and trust

Configuration comes from these sources (`src/project/config.ts`, `src/bundler/projectEnv.ts`):

- **tsconfig `paths`.**
- **Babel `module-resolver`:** parsed statically from `babel.config.js` / `.babelrc`, never executed.
- **`.env*` files** (`EXPO_PUBLIC_*`) and **`app.json`**.
- **`rnLens.*` settings.**
- **`rnlens.config.js`:** trusted workspaces only.

Saving any of these, or a new platform-specific file, restarts the contexts (`needsReload`).

## Testing

| Layer | Where | What |
|---|---|---|
| Unit | `test/unit/` (vitest) | Pure logic, plus real esbuild builds of fixtures through `test/unit/bundler/previewBuild.ts`, the same plugins the extension uses |
| Integration | `test/integration/` (mocha in VS Code via `@vscode/test-electron`) | The packaged extension against `test/fixtures/expo-app`, on stable VS Code and on 1.90.0: rendering, hot updates, panels, variants, stories, app navigation, mocks |
| Benchmark | `test/bench/` (`npm run bench`) | PRD §7 targets: activation, cold build, warm rebuild p90, extension-host memory; prints a table and fails if a target is missed |

The integration tests drive the webview through a test-only API (`RNLensApi.testing`), which exists only when VS Code runs the extension in test mode. The API can take snapshots of the rendered text, press elements and switch devices.
