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

### D-18. Not yet handled (later phases)

`react-native/*` sub-path imports, images/fonts, Flow-typed packages and native modules still fail with esbuild's error in the overlay. These are Phase 2 (assets, flowStrip, mocks) and Phase 3 (autoMock).
