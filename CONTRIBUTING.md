# Contributing to RN Lens

## Repository layout

How the pieces fit together is described in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

```
rn-lens/
├── package.json                 # extension manifest (contributes, activationEvents, walkthrough)
├── esbuild.extension.mjs        # builds the extension, the webview, and the test/bench bundles
├── src/
│   ├── extension.ts             # activate/deactivate, command registration, test API
│   ├── project/                 # project + app entry detection, Babel aliases, rnlens.config.js
│   ├── bundler/
│   │   ├── BundlerService.ts    # app + vendor esbuild contexts, shared by panels, build queue
│   │   ├── buildOptions.ts      # the two builds' options and plugin order
│   │   ├── virtualEntry.ts      # generates the preview entry module
│   │   ├── refresh/             # Fast Refresh transform and hot-update planning
│   │   └── plugins/             # externalize, vendorEntry, projectSource, mockRegistry, aliases,
│   │                            # platformExtensions, rnAlias, flowStrip, assets, expoRouter, …
│   ├── mocks/                   # built-in native module mocks
│   ├── preview/
│   │   ├── PreviewPanelManager.ts  # all panels; routes commands and workspace events
│   │   ├── PreviewPanel.ts      # one panel: builds, delivers, maps errors, follows the editor
│   │   ├── protocol.ts          # typed message definitions shared with the webview
│   │   ├── variants.ts          # .preview files, previews objects, Storybook stories
│   │   └── html.ts              # webview HTML + CSP
│   ├── codelens/                # component detection and the ▶ Preview CodeLens
│   ├── diagnostics/             # source maps, mock diagnostics + "Create mock for …"
│   └── util/
├── webview/                     # webview shell: toolbar, device frames, overlay, console bridge
│   └── runtime/                 # bundled into every preview: react-native wrapper, Platform,
│                                # React Refresh setup, auto-mocks, RN API shims, stories
├── media/walkthrough/           # Getting Started walkthrough pages
├── vendor/                      # pinned react, react-dom, react-native-web, react-refresh
├── test/
│   ├── unit/                    # vitest (incl. real esbuild builds of fixtures)
│   ├── integration/             # @vscode/test-electron + mocha
│   ├── bench/                   # npm run bench (PRD §7 targets)
│   └── fixtures/                # expo-app, bare-rn-app, router-app
└── docs/                        # ARCHITECTURE, DECISIONS, KNOWN_DIFFERENCES, WRITING_MOCKS
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
| `npm run test:integration` | VS Code integration tests (`VSCODE_TEST_VERSION=1.90.0` for the minimum engine; `MOCHA_GREP` to filter) |
| `npm run bench` | Production build, then measures activation, cold build, warm rebuild p90 and memory in VS Code and prints the PRD §7 table (exits non-zero if a target is missed) |
| `npm run package` | Produce platform-specific `.vsix` files via `vsce package --target <platform>` |

## Adding a built-in mock

1. Create `src/mocks/<package-name>.ts(x)` exporting the same public API shape as the real package (types optional but encouraged).
2. Register it in `src/mocks/index.ts`.
3. Import it from a fixture (e.g. `test/unit/fixtures/hello-project/components/Mocked.tsx`, asserted in `test/unit/bundler/bundle.test.ts`), and for anything visual add a demo to `test/fixtures/expo-app/components/reference/` that `test/integration/suite/reference.test.ts` renders.

## Coding standards

- TypeScript `strict: true`. No `any` in public APIs.
- All extension ⇄ webview messages go through `src/preview/protocol.ts`.
- Never run workspace code in the extension host; workspace code runs only in the webview. The only exception is `rnlens.config.js`, loaded only when `vscode.workspace.isTrusted`.
- Every bundler plugin needs unit tests with fixtures.
- Conventional Commits (`feat:`, `fix:`, `perf:` …).

## Release

1. Update `CHANGELOG.md`.
2. `npm version <patch|minor|major>`.
3. CI builds a VSIX per platform (win32-x64, win32-arm64, linux-x64, linux-arm64, alpine-x64, darwin-x64, darwin-arm64; web is not supported) and uploads them as workflow artifacts.
4. Publish those VSIX files to the Marketplace and Open VSX (`vsce publish --packagePath …`, `ovsx publish …`). Publishing isn't automated yet.
