import path from 'node:path';
import * as vscode from 'vscode';
import type { BundlerService } from '../bundler/BundlerService';
import {
  bundleKeyId,
  type BuildMessage,
  type BundleKey,
  type SimulatedPlatform,
} from '../bundler/types';
import { isWithin } from '../project/detectProject';
import type { ProjectRegistry } from '../project/projectRegistry';
import { UserError } from '../util/errors';
import { getLog } from '../util/log';
import { createNonce, renderPreviewHtml, sanitizeAllowList } from './html';
import { isWebviewMessage, type HostMessage, type WebviewMessage } from './protocol';

export const PREVIEW_VIEW_TYPE = 'rnLens.preview';
const SNAPSHOT_TIMEOUT_MS = 2000;

export interface PreviewRequest {
  file: vscode.Uri;
  exportName: string;
  /** Human-readable component name for the panel title. */
  label: string;
}

export interface PreviewSnapshot {
  text: string;
  renderedId: number | undefined;
}

function formatBuildMessage(m: BuildMessage): string {
  const where = m.file ? `${m.file}:${m.line ?? 0}:${(m.column ?? 0) + 1}: ` : '';
  return `${where}${m.text}`;
}

const isInNodeModules = (file: string): boolean => file.split(/[\\/]/).includes('node_modules');

/**
 * Owns the preview webview panel: builds the current target, delivers bundles to the webview, and
 * rebuilds when files in the previewed project are saved.
 */
export class PreviewPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private current: { key: BundleKey; label: string } | undefined;
  private webviewReady = false;
  /** Latest bundle or build error, re-sent when the webview (re)loads. */
  private latest: HostMessage | undefined;
  private buildSeq = 0;
  private snapshotSeq = 0;
  private readonly snapshotWaiters = new Map<number, (s: PreviewSnapshot | undefined) => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bundler: BundlerService,
    private readonly projects: ProjectRegistry,
  ) {
    this.disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc)));
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  async show(request: PreviewRequest): Promise<void> {
    const project = await this.projects.projectFor(request.file);
    if (!project) {
      throw new UserError(
        `${path.basename(request.file.fsPath)} isn't inside a React Native or Expo project, so RN Lens can't preview it. ` +
          'Open a file from a project whose package.json depends on react-native or expo.',
      );
    }
    const platform = vscode.workspace
      .getConfiguration('rnLens')
      .get<SimulatedPlatform>('simulatedPlatform', 'ios');
    const key: BundleKey = {
      projectRoot: project.root,
      platform,
      target: { kind: 'component', file: request.file.fsPath, exportName: request.exportName },
    };
    if (this.current && bundleKeyId(this.current.key) !== bundleKeyId(key)) {
      void this.bundler.release(this.current.key);
    }
    this.current = { key, label: request.label };

    const panel = this.ensurePanel();
    panel.title = `RN Lens: ${request.label}`;
    panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Beside, true);
    await this.rebuild();
  }

  /** Disposes the current esbuild context and builds from scratch. */
  async reload(): Promise<void> {
    if (!this.current) {
      throw new UserError(
        'No RN Lens preview is open, so there is nothing to reload. Run "RN Lens: Open Preview" first.',
      );
    }
    await this.bundler.release(this.current.key);
    this.bundler.invalidateProject(this.current.key.projectRoot);
    await this.rebuild();
  }

  /** Test-only: the rendered text of the preview root, or undefined if the webview isn't ready. */
  snapshot(): Promise<PreviewSnapshot | undefined> {
    if (!this.panel || !this.webviewReady) {
      return Promise.resolve(undefined);
    }
    const requestId = ++this.snapshotSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.snapshotWaiters.delete(requestId);
        resolve(undefined);
      }, SNAPSHOT_TIMEOUT_MS);
      this.snapshotWaiters.set(requestId, (s) => {
        clearTimeout(timer);
        resolve(s);
      });
      this.post({ type: '__test_snapshot', requestId });
    });
  }

  /** Closes the panel and waits for its esbuild context to be released. */
  async close(): Promise<void> {
    const key = this.current?.key;
    this.panel?.dispose();
    if (key) await this.bundler.release(key);
  }

  private async rebuild(): Promise<void> {
    const current = this.current;
    if (!current || !this.panel) return;
    const id = ++this.buildSeq;
    const log = getLog();
    this.post({ type: 'building', title: current.label });

    const result = await this.bundler.build(current.key);
    if (id !== this.buildSeq || this.current !== current) {
      return; // A newer build or a different target superseded this one.
    }
    for (const w of result.warnings) log.warn(formatBuildMessage(w));
    if (result.ok) {
      log.info(`Built ${current.label} in ${result.buildMs} ms`);
      this.deliver({
        type: 'bundle',
        id,
        code: result.code,
        css: result.css,
        buildMs: result.buildMs,
      });
    } else {
      log.error(
        `Build failed for ${current.label}:\n${result.errors.map(formatBuildMessage).join('\n')}`,
      );
      this.deliver({ type: 'buildError', id, errors: result.errors });
    }
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel;

    const roots = [
      vscode.Uri.joinPath(this.extensionUri, 'dist'),
      vscode.Uri.joinPath(this.extensionUri, 'vendor'),
      ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
    ];
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      'RN Lens',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots },
    );
    this.panel = panel;
    this.webviewReady = false;

    const allow = sanitizeAllowList(
      vscode.workspace.getConfiguration('rnLens').get<unknown[]>('networkAllowList', []),
    );
    if (allow.rejected.length > 0) {
      getLog().warn(
        `Ignored rnLens.networkAllowList entries that aren't origins like "http://localhost:4000": ${allow.rejected.join(', ')}`,
      );
    }
    const webview = panel.webview;
    webview.html = renderPreviewHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'))
        .toString(),
      connectSrc: allow.origins,
    });

    panel.onDidDispose(() => this.onPanelDisposed(panel), null, this.disposables);
    webview.onDidReceiveMessage((m: unknown) => this.onMessage(m), null, this.disposables);
    return panel;
  }

  private onPanelDisposed(panel: vscode.WebviewPanel): void {
    if (this.panel !== panel) return;
    if (this.current) void this.bundler.release(this.current.key);
    this.panel = undefined;
    this.current = undefined;
    this.latest = undefined;
    this.webviewReady = false;
    for (const resolve of this.snapshotWaiters.values()) resolve(undefined);
    this.snapshotWaiters.clear();
  }

  private onMessage(message: unknown): void {
    if (!isWebviewMessage(message)) return;
    const m: WebviewMessage = message;
    switch (m.type) {
      case 'ready':
        this.webviewReady = true;
        if (this.latest) this.post(this.latest);
        break;
      case 'rendered':
        getLog().debug(`Rendered bundle #${m.id}`);
        break;
      case 'runtimeError':
        getLog().error(`Runtime error in preview: ${m.stack ?? m.message}`);
        break;
      case '__test_snapshot_result':
        this.snapshotWaiters.get(m.requestId)?.({ text: m.text, renderedId: m.renderedId });
        this.snapshotWaiters.delete(m.requestId);
        break;
    }
  }

  private onDidSave(doc: vscode.TextDocument): void {
    const current = this.current;
    if (!current || doc.uri.scheme !== 'file') return;
    const file = doc.uri.fsPath;
    if (!isWithin(current.key.projectRoot, file, path) || isInNodeModules(file)) return;
    const work = path.basename(file) === 'package.json' ? this.reload() : this.rebuild();
    work.catch((err: unknown) => getLog().error('Rebuild after save failed', err));
  }

  private deliver(message: HostMessage): void {
    this.latest = message;
    this.post(message);
  }

  private post(message: HostMessage): void {
    if (this.panel && this.webviewReady) {
      void this.panel.webview.postMessage(message);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
