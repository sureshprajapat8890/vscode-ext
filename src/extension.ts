import path from 'node:path';
import * as vscode from 'vscode';
import { BundlerService } from './bundler/BundlerService';
import {
  COMPONENT_SELECTOR,
  ComponentCodeLensProvider,
} from './codelens/ComponentCodeLensProvider';
import { detectComponents, pickDefaultComponent } from './codelens/componentDetection';
import type { RNProject } from './project/detectProject';
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
import { disposeLog, getLog } from './util/log';
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
    clickOverlayFrame(index: number): void;
    selectVariant(name: string | null): Promise<void>;
    buildTimes(): readonly number[];
    setEnv(env: PreviewEnvOverride): void;
    contextCount(): number;
    closePreview(): Promise<void>;
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

export function activate(context: vscode.ExtensionContext): RNLensApi {
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
    onDepsWarning: (message) => log.warn(message),
  });
  const status = new PreviewStatusBar();
  const previews = new PreviewPanelManager(
    context.extensionUri,
    cacheDir,
    bundler,
    projects,
    status,
  );
  const codeLenses = new ComponentCodeLensProvider(projects);
  context.subscriptions.push(
    status,
    vscode.languages.registerCodeLensProvider(COMPONENT_SELECTOR, codeLenses),
    vscode.workspace.onDidCloseTextDocument((doc) => codeLenses.forget(doc)),
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

    safeCommand('rnLens.openPreview', async (uri?: vscode.Uri) => {
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
      await previews.show({
        file: target,
        exportName: component.exportName,
        label: componentLabel(target, component.exportName, component.localName),
      });
    }),

    safeCommand('rnLens.previewComponent', async (uri: vscode.Uri | string, exportName: string) => {
      const file = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri;
      if (!(file instanceof vscode.Uri) || typeof exportName !== 'string') {
        throw new UserError(
          '"RN Lens: Preview Component" needs a file and an export name; use the ▶ Preview CodeLens instead.',
        );
      }
      await previews.show({ file, exportName, label: componentLabel(file, exportName, undefined) });
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
      clickOverlayFrame: (index) => previews.clickOverlayFrame(index),
      selectVariant: (name) => previews.selectVariantForTest(name),
      buildTimes: () => previews.buildTimes,
      setEnv: (env) => previews.setEnv(env),
      contextCount: () => bundler.contextCount,
      closePreview: () => previews.close(),
    };
  }
  return api;
}

export function deactivate(): void {
  disposeLog();
}
