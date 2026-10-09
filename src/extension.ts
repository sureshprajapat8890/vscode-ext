import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import { BundlerService } from './bundler/BundlerService';
import type { PreviewTarget, SimulatedPlatform } from './bundler/types';
import {
  COMPONENT_SELECTOR,
  ComponentCodeLensProvider,
} from './codelens/ComponentCodeLensProvider';
import { detectComponents, pickDefaultComponent } from './codelens/componentDetection';
import { MockDiagnostics } from './diagnostics/mockDiagnostics';
import { loadProjectConfig } from './project/config';
import type { RNProject } from './project/detectProject';
import { collectImportUsage, generateMockStub, mockFilePath } from './project/mockStub';
import { ProjectRegistry } from './project/projectRegistry';
import {
  PREVIEW_VIEW_TYPE,
  PreviewPanelManager,
  type PreviewEnvOverride,
  type PreviewSnapshot,
} from './preview/PreviewPanelManager';
import { isPanelTarget } from './preview/protocol';
import { PreviewStatusBar } from './preview/statusBar';
import { UserError } from './util/errors';
import { disposeLog, getLog, recentLogLines } from './util/log';
import { safeCommand } from './util/safeCommand';

const PREVIEWABLE_LANGUAGES = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

/** Public API returned from `activate`, used by integration tests. */
export interface RNLensApi {
  getProjects(): readonly RNProject[];
  /** Resolves once the initial workspace scan has finished. */
  ready: Promise<void>;
  /** Only present when the extension runs under the VS Code test runner. */
  testing?: {
    snapshot(): Promise<PreviewSnapshot | undefined>;
    /** Snapshots of every open panel, oldest first. */
    snapshotAll(): Promise<(PreviewSnapshot | undefined)[]>;
    clickOverlayFrame(index: number): void;
    press(text: string): void;
    selectVariant(name: string | null): Promise<void>;
    setPlatform(platform: SimulatedPlatform): Promise<void>;
    currentTarget(): PreviewTarget | undefined;
    isLocked(): boolean;
    buildTimes(): readonly number[];
    setEnv(env: PreviewEnvOverride): void;
    contextCount(): number;
    /** Modules (project and dependencies) in the active panel's last successful build. */
    moduleCount(): number | undefined;
    activationMs(): number;
    panelCount(): number;
    closePreview(): Promise<void>;
    recentLog(): readonly string[];
  };
}

function componentLabel(
  file: vscode.Uri,
  exportName: string,
  localName: string | undefined,
): string {
  if (exportName !== 'default') return exportName;
  return localName ?? path.basename(file.fsPath, path.extname(file.fsPath));
}

/** Unsaved contents of a project file open in the editor, in `onType` mode. */
function readUnsaved(file: string): string | undefined {
  if (
    vscode.workspace.getConfiguration('rnLens').get<string>('updateMode', 'onSave') !== 'onType'
  ) {
    return undefined;
  }
  const normalized = path.normalize(file).toLowerCase();
  const doc = vscode.workspace.textDocuments.find(
    (d) =>
      d.isDirty &&
      d.uri.scheme === 'file' &&
      path.normalize(d.uri.fsPath).toLowerCase() === normalized,
  );
  return doc?.getText();
}

/** Milliseconds from loading the bundle to the end of `activate` (PRD target: < 200 ms). */
let activationMs = 0;

export function activate(context: vscode.ExtensionContext): RNLensApi {
  const loadStart =
    (globalThis as { __RNLENS_LOAD_START__?: number }).__RNLENS_LOAD_START__ ?? performance.now();
  const log = getLog();
  log.info(`RN Lens ${String(context.extension.packageJSON.version)} activating`);

  const projects = new ProjectRegistry();
  const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
  const cacheDir = vscode.Uri.joinPath(context.globalStorageUri, 'cache').fsPath;
  const bundler = new BundlerService({
    vendorDir: vscode.Uri.joinPath(context.extensionUri, 'vendor').fsPath,
    runtimeDir: vscode.Uri.joinPath(dist, 'runtime').fsPath,
    mocksDir: vscode.Uri.joinPath(dist, 'mocks').fsPath,
    cacheDir,
    resolveProjectConfig: (projectRoot) =>
      loadProjectConfig(projectRoot, {
        extraAliases: vscode.workspace
          .getConfiguration('rnLens')
          .get<Record<string, unknown>>('extraAliases', {}),
        trusted: vscode.workspace.isTrusted,
      }),
    readUnsaved,
    onDepsWarning: (message) => log.warn(message),
    onProjectNote: (message) => log.info(message),
  });
  const status = new PreviewStatusBar();
  const mockDiagnostics = new MockDiagnostics();
  const previews = new PreviewPanelManager(
    context.extensionUri,
    cacheDir,
    bundler,
    projects,
    status,
    (projectRoot, mocked) => {
      mockDiagnostics
        .update(projectRoot, mocked)
        .catch((err: unknown) => log.warn('Updating mock diagnostics failed', err));
    },
  );
  const codeLenses = new ComponentCodeLensProvider(projects);

  /** Previews the default component of `uri` (or the active editor's file). */
  async function openPreview(uri: vscode.Uri | undefined, newPanel: boolean): Promise<void> {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      throw new UserError(
        'No file is open, so there is nothing to preview. Open a component file and run "RN Lens: Open Preview" again.',
      );
    }
    const doc = await vscode.workspace.openTextDocument(target);
    const name = path.basename(target.fsPath);
    if (!PREVIEWABLE_LANGUAGES.has(doc.languageId)) {
      throw new UserError(
        `${name} isn't a JavaScript or TypeScript file, so RN Lens can't preview it. Open a .js, .jsx, .ts or .tsx component file.`,
      );
    }
    const component = pickDefaultComponent(detectComponents(doc.getText()));
    if (!component) {
      throw new UserError(
        `No exported React component was found in ${name}. RN Lens previews a default export, or exported ` +
          'PascalCase components that return JSX. Export a component from this file, or open a different one.',
      );
    }
    await previews.show(
      {
        file: target,
        exportName: component.exportName,
        label: componentLabel(target, component.exportName, component.localName),
      },
      { newPanel },
    );
  }

  context.subscriptions.push(
    status,
    mockDiagnostics,
    vscode.languages.registerCodeLensProvider(COMPONENT_SELECTOR, codeLenses),
    vscode.languages.registerCodeActionsProvider(COMPONENT_SELECTOR, mockDiagnostics, {
      providedCodeActionKinds: MockDiagnostics.providedCodeActionKinds,
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => codeLenses.forget(doc)),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      // rnlens.config.js may now be loaded.
      for (const p of projects.getProjects()) bundler.invalidateProject(p.root);
      if (previews.isOpen) previews.reload().catch(() => undefined);
    }),
    vscode.window.registerWebviewPanelSerializer(PREVIEW_VIEW_TYPE, {
      async deserializeWebviewPanel(panel, state: unknown) {
        const target = (state as { target?: unknown } | undefined)?.target;
        if (!isPanelTarget(target)) {
          panel.dispose();
          return;
        }
        await previews.restore(panel, target).catch((err: unknown) => {
          log.warn(`Could not restore the RN Lens preview of ${target.file}`, err);
          panel.dispose();
        });
      },
    }),
    projects.onDidChange((found) => {
      for (const p of found) bundler.invalidateProject(p.root);
    }),
    projects,
    previews,
    { dispose: () => void bundler.dispose() },

    safeCommand('rnLens.openPreview', (uri?: vscode.Uri) => openPreview(uri, false)),
    safeCommand('rnLens.openPreviewToSide', (uri?: vscode.Uri) =>
      // From a focused preview (its title bar button): the same component in another panel.
      !(uri instanceof vscode.Uri) && previews.hasFocus
        ? previews.duplicateActive()
        : openPreview(uri, true),
    ),

    safeCommand('rnLens.previewComponent', async (uri: vscode.Uri | string, exportName: string) => {
      const file = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri;
      if (!(file instanceof vscode.Uri) || typeof exportName !== 'string') {
        throw new UserError(
          '"RN Lens: Preview Component" needs a file and an export name; use the ▶ Preview CodeLens instead.',
        );
      }
      await previews.show({ file, exportName, label: componentLabel(file, exportName, undefined) });
    }),

    safeCommand('rnLens.previewApp', (uri?: vscode.Uri) =>
      previews.showApp(
        uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri,
      ),
    ),

    safeCommand('rnLens.toggleLock', async () => {
      if (!previews.isOpen) {
        throw new UserError(
          'No RN Lens preview is open, so there is nothing to lock. Open a preview first.',
        );
      }
      const locked = previews.toggleLock();
      void vscode.window.setStatusBarMessage(
        locked ? 'RN Lens: preview locked' : 'RN Lens: preview follows the active editor',
        3000,
      );
    }),

    safeCommand('rnLens.createMock', async (uri: vscode.Uri, specifier: string) => {
      if (!(uri instanceof vscode.Uri) || typeof specifier !== 'string') {
        throw new UserError(
          '"Create mock" needs a file and a package name; use the quick fix on the RN Lens warning.',
        );
      }
      const project = await projects.projectFor(uri);
      if (!project) {
        throw new UserError(
          `${path.basename(uri.fsPath)} isn't inside a React Native or Expo project.`,
        );
      }
      const existing = ['.tsx', '.ts'].map((ext) =>
        mockFilePath(project.root, specifier, ext === '.tsx'),
      );
      const found = existing.find((f) => existsSync(f));
      if (found) {
        await vscode.window.showTextDocument(vscode.Uri.file(found));
        return;
      }
      const usage = collectImportUsage([await readFile(uri.fsPath, 'utf8')], specifier);
      const stub = generateMockStub(specifier, usage);
      const file = mockFilePath(project.root, specifier, stub.tsx);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, stub.source, { flag: 'wx' });
      log.info(`Created ${file}`);
      await vscode.window.showTextDocument(vscode.Uri.file(file));
      if (previews.isOpen) await previews.reload();
    }),

    safeCommand('rnLens.reload', () => previews.reload()),

    safeCommand('rnLens.clearCache', async () => {
      await bundler.clearCache();
      log.info('Cleared the RN Lens build cache.');
      await previews.rebuildIfOpen();
    }),

    safeCommand('rnLens.showOutput', () => log.show(true)),
  );

  const ready = projects.refresh().catch((err: unknown) => {
    log.error('Project detection failed', err);
  });

  const api: RNLensApi = { getProjects: () => projects.getProjects(), ready };
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    api.testing = {
      snapshot: () => previews.snapshot(),
      snapshotAll: () => previews.snapshotAll(),
      clickOverlayFrame: (index) => previews.clickOverlayFrame(index),
      press: (text) => previews.press(text),
      selectVariant: (name) => previews.selectVariantForTest(name),
      setPlatform: (platform) => previews.setPlatform(platform),
      currentTarget: () => previews.currentTarget,
      isLocked: () => previews.isLocked,
      buildTimes: () => previews.buildTimes,
      setEnv: (env) => previews.setEnv(env),
      contextCount: () => bundler.contextCount,
      moduleCount: () => previews.moduleCount,
      activationMs: () => activationMs,
      panelCount: () => previews.panelCount,
      closePreview: () => previews.close(),
      recentLog: () => recentLogLines(),
    };
  }
  activationMs = Math.round(performance.now() - loadStart);
  log.debug(`Activated in ${activationMs} ms`);
  return api;
}

export function deactivate(): void {
  disposeLog();
}
