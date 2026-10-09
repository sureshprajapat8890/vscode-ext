# Changelog

All notable changes to RN Lens are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
