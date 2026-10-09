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
