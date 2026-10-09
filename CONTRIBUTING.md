# Contributing to RN Lens

## Repository layout

```
rn-lens/
├── package.json                 # extension manifest (contributes, activationEvents)
├── tsconfig.json
├── esbuild.extension.mjs        # builds the extension itself
├── src/
│   ├── extension.ts             # activate/deactivate, command registration
│   ├── project/
│   │   ├── detectProject.ts     # finds RN/Expo root, reads package.json, tsconfig, babel aliases
│   │   └── config.ts            # settings + rnlens.config.js (workspace-trust gated)
│   ├── bundler/
│   │   ├── BundlerService.ts    # esbuild context lifecycle, rebuild queue, caching
│   │   ├── virtualEntry.ts      # generates preview entry module
│   │   └── plugins/
│   │       ├── rnAlias.ts
│   │       ├── platformExtensions.ts
│   │       ├── flowStrip.ts
│   │       ├── assets.ts
│   │       ├── mockRegistry.ts
│   │       └── unsavedBuffers.ts
│   ├── mocks/                   # built-in native module mocks
│   ├── preview/
│   │   ├── PreviewPanelManager.ts
│   │   ├── protocol.ts          # typed message definitions shared with webview
│   │   └── html.ts              # webview HTML + CSP
│   ├── codelens/ComponentCodeLensProvider.ts
│   ├── diagnostics/sourceMaps.ts
│   └── util/
├── webview/                     # webview shell (toolbar, device frame, runtime)
│   ├── main.tsx
│   ├── runtime/
│   │   ├── errorBoundary.tsx
│   │   ├── consoleBridge.ts
│   │   └── platformPatch.ts
│   ├── devices.ts
│   └── styles.css
├── vendor/                      # pinned react, react-dom, react-native-web fallbacks
├── test/
│   ├── unit/                    # vitest
│   ├── integration/             # @vscode/test-electron
│   └── fixtures/
│       ├── expo-app/
│       └── bare-rn-app/
└── docs/
```

## Setup

```bash
git clone <repo> && cd rn-lens
npm install
npm run build        # builds extension + webview
```

Press **F5** in VS Code to launch an Extension Development Host with `test/fixtures/expo-app` open.

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` | Production build of extension and webview |
| `npm run watch` | Rebuild on change |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Unit tests (vitest) |
| `npm run test:integration` | VS Code integration tests |
| `npm run package` | Produce platform-specific `.vsix` files via `vsce package --target <platform>` |

## Adding a built-in mock

1. Create `src/mocks/<package-name>.ts(x)` exporting the same public API shape as the real package (types optional but encouraged).
2. Register it in `src/mocks/index.ts`.
3. Add a fixture usage in `test/fixtures/expo-app/mocks-demo/` and a test asserting it renders.

## Coding standards

- TypeScript `strict: true`. No `any` in public APIs.
- All extension ⇄ webview messages go through `src/preview/protocol.ts`.
- Never run workspace code in the extension host; workspace code runs only in the webview. The only exception is `rnlens.config.js`, loaded only when `vscode.workspace.isTrusted`.
- Every bundler plugin needs unit tests with fixtures.
- Conventional Commits (`feat:`, `fix:`, `perf:` …).

## Release

1. Update `CHANGELOG.md`.
2. `npm version <patch|minor|major>`.
3. CI builds per-platform VSIX (win32-x64, win32-arm64, linux-x64, linux-arm64, darwin-x64, darwin-arm64, alpine-x64, web is not supported) and publishes to Marketplace and Open VSX.
