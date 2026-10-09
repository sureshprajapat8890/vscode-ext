# Changelog

All notable changes to RN Lens are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Phase 0 — Scaffold

- Extension manifest: commands, Command Palette and editor-title menus, all `rnLens.*` settings from PRD §6.6, Getting Started walkthrough, Workspace Trust declaration (`limited`).
- React Native / Expo project detection (`src/project/detectProject.ts`) with a workspace registry that keeps the `rnLens.isRNProject` context key in sync as `package.json` files change.
- "RN Lens" log output channel.
- Build (esbuild), lint (ESLint + Prettier), unit tests (vitest + coverage thresholds), integration tests (`@vscode/test-electron` + mocha).
- GitHub Actions CI on Ubuntu, Windows and macOS, plus per-platform VSIX packaging.
- Test fixtures: `test/fixtures/expo-app` (create-expo-app `blank-typescript`) and `test/fixtures/bare-rn-app`.
