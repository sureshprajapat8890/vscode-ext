import path from 'node:path';
import * as vscode from 'vscode';
import { BundlerService } from './bundler/BundlerService';
import { detectComponents, pickDefaultComponent } from './codelens/componentDetection';
import type { RNProject } from './project/detectProject';
import { ProjectRegistry } from './project/projectRegistry';
import { PreviewPanelManager, type PreviewSnapshot } from './preview/PreviewPanelManager';
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
  const bundler = new BundlerService({
    vendorDir: vscode.Uri.joinPath(context.extensionUri, 'vendor').fsPath,
    onDepsWarning: (message) => log.warn(message),
  });
  const previews = new PreviewPanelManager(context.extensionUri, bundler, projects);
  context.subscriptions.push(
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
  );

  const ready = projects.refresh().catch((err: unknown) => {
    log.error('Project detection failed', err);
  });

  const api: RNLensApi = { getProjects: () => projects.getProjects(), ready };
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    api.testing = {
      snapshot: () => previews.snapshot(),
      contextCount: () => bundler.contextCount,
      closePreview: () => previews.close(),
    };
  }
  return api;
}

export function deactivate(): void {
  disposeLog();
}
