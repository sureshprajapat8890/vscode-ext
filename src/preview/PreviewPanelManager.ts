import { existsSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { assetCacheDir } from '../bundler/buildOptions';
import { bundleFingerprint, type BundlerService } from '../bundler/BundlerService';
import {
  bundleKeyId,
  type BuildMessage,
  type BundleKey,
  type MockedPackage,
  type SimulatedPlatform,
} from '../bundler/types';
import { findDecorators } from '../bundler/virtualEntry';
import { BundleSourceMap } from '../diagnostics/sourceMaps';
import { isWithin } from '../project/detectProject';
import type { ProjectRegistry } from '../project/projectRegistry';
import { UserError } from '../util/errors';
import { getLog } from '../util/log';
import { createNonce, renderPreviewHtml, sanitizeAllowList } from './html';
import {
  isWebviewMessage,
  type ConsoleLevel,
  type HostMessage,
  type OverlaySnapshot,
  type PanelTarget,
  type WebviewMessage,
} from './protocol';
import type { PreviewStatusBar } from './statusBar';
import { findVariantFile, listVariants } from './variants';

export const PREVIEW_VIEW_TYPE = 'rnLens.preview';
const SNAPSHOT_TIMEOUT_MS = 2000;
/** Recent bundles remembered so late runtime errors can still be mapped. */
const BUNDLES_KEPT = 2;

export interface PreviewRequest {
  file: vscode.Uri;
  exportName: string;
  /** Human-readable component name for the panel title. */
  label: string;
  /** Variant to select, if any. */
  variant?: string | null;
}

export interface PreviewSnapshot {
  text: string;
  renderedId: number | undefined;
  overlay: OverlaySnapshot;
  env: { deviceId: string; width: number; height: number; scheme: 'light' | 'dark' };
}

export interface PreviewEnvOverride {
  deviceId?: string;
  scheme?: 'light' | 'dark';
  landscape?: boolean;
}

interface Current {
  key: BundleKey;
  label: string;
  variantFile: string | undefined;
  variants: string[];
}

function formatBuildMessage(m: BuildMessage): string {
  const where = m.file ? `${m.file}:${m.line ?? 0}:${(m.column ?? 0) + 1}: ` : '';
  return `${where}${m.text}`;
}

const isInNodeModules = (file: string): boolean => file.split(/[\\/]/).includes('node_modules');

/** Files whose change requires a fresh esbuild context rather than an incremental rebuild. */
function needsReload(projectRoot: string, file: string): boolean {
  const base = path.basename(file);
  if (base === 'package.json' || base === 'app.json' || base === 'tsconfig.json') return true;
  if (base === '.env' || base.startsWith('.env.')) return true;
  // A new platform-specific file changes which imports the context must intercept.
  if (/\.(?:ios|android|native)\.(?:tsx|ts|jsx|js)$/.test(base)) return true;
  return isWithin(path.join(projectRoot, '.rnlens', 'mocks'), file, path);
}

function mockSummary(mocked: readonly MockedPackage[]): string {
  return mocked
    .map((m) =>
      m.source === 'project'
        ? `${m.specifier} (your mock in .rnlens/mocks)`
        : `${m.specifier} (built-in mock${m.note ? `: ${m.note}` : ''})`,
    )
    .join(', ');
}

/**
 * Owns the preview webview panel: builds the current target, delivers bundles to the webview,
 * maps runtime errors to source, and rebuilds when files in the previewed project are saved.
 */
export class PreviewPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private current: Current | undefined;
  private webviewReady = false;
  /** Latest bundle or build error, re-sent when the webview (re)loads. */
  private latest: HostMessage | undefined;
  private buildSeq = 0;
  private snapshotSeq = 0;
  private lastMockSummary = '';
  private successfulBuildTimes: number[] = [];
  /** Fingerprint of each recently delivered bundle, and its source map once one was built. */
  private readonly bundles = new Map<number, { fingerprint: string; map?: BundleSourceMap }>();
  private readonly snapshotWaiters = new Map<number, (s: PreviewSnapshot | undefined) => void>();
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cacheDir: string,
    private readonly bundler: BundlerService,
    private readonly projects: ProjectRegistry,
    private readonly status: PreviewStatusBar,
  ) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('rnLens.simulatedPlatform')) {
          this.onPlatformSettingChanged().catch((err: unknown) =>
            getLog().error('Switching the simulated platform failed', err),
          );
        }
      }),
    );
  }

  /** Rebuilds the open preview for the newly configured platform (resolves `.ios` / `.android`). */
  private async onPlatformSettingChanged(): Promise<void> {
    const current = this.current;
    if (!current) return;
    const platform = vscode.workspace
      .getConfiguration('rnLens')
      .get<SimulatedPlatform>('simulatedPlatform', 'ios');
    if (platform === current.key.platform) return;
    void this.bundler.release(current.key);
    current.key = { ...current.key, platform };
    await this.rebuild();
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  async show(request: PreviewRequest): Promise<void> {
    this.ensurePanel();
    await this.retarget(request);
  }

  /** Re-attaches a panel restored by VS Code after a restart. */
  async restore(panel: vscode.WebviewPanel, target: PanelTarget): Promise<void> {
    this.panel?.dispose();
    this.setupPanel(panel);
    await this.retarget({
      file: vscode.Uri.file(target.file),
      exportName: target.exportName,
      label: target.label,
      variant: target.variant,
    });
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

  /** Rebuilds the open preview (if any) after the bundler cache was cleared. */
  async rebuildIfOpen(): Promise<void> {
    if (this.current) await this.rebuild();
  }

  /** Test-only: rendered text, overlay and device state, or undefined if the webview isn't ready. */
  snapshot(): Promise<PreviewSnapshot | undefined> {
    if (!this.panel || !this.webviewReady) return Promise.resolve(undefined);
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

  /** Test-only: selects a variant as the toolbar dropdown would. */
  selectVariantForTest(name: string | null): Promise<void> {
    return this.selectVariant(name);
  }

  /** Durations (ms) of successful builds since the panel opened, oldest first. */
  get buildTimes(): readonly number[] {
    return this.successfulBuildTimes;
  }

  /** Test-only: clicks the n-th clickable frame in the error overlay. */
  clickOverlayFrame(index: number): void {
    this.post({ type: '__test_click_frame', index });
  }

  /** Test-only: switches device, color scheme or orientation in the toolbar. */
  setEnv(env: PreviewEnvOverride): void {
    this.post({ type: '__test_set_env', ...env });
  }

  /** Closes the panel and waits for its esbuild context to be released. */
  async close(): Promise<void> {
    const key = this.current?.key;
    this.panel?.dispose();
    if (key) await this.bundler.release(key);
  }

  private async retarget(request: PreviewRequest): Promise<void> {
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
    const file = request.file.fsPath;
    const variantFile = findVariantFile(file);
    const variants = variantFile ? await listVariants(variantFile) : [];
    const variantName =
      request.variant && variants.includes(request.variant) ? request.variant : null;
    const key: BundleKey = {
      projectRoot: project.root,
      platform,
      target: {
        kind: 'component',
        file,
        exportName: request.exportName,
        variant: variantFile && variantName ? { file: variantFile, name: variantName } : undefined,
      },
    };
    if (this.current && bundleKeyId(this.current.key) !== bundleKeyId(key)) {
      void this.bundler.release(this.current.key);
    }
    this.current = { key, label: request.label, variantFile, variants };
    void this.updateContextKeys();

    const panel = this.panel;
    if (!panel) return;
    panel.title = `RN Lens: ${request.label}`;
    panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Beside, true);
    this.sendInit();
    this.sendVariants();
    await this.rebuild();
  }

  private async rebuild(): Promise<void> {
    const current = this.current;
    if (!current || !this.panel) return;
    const id = ++this.buildSeq;
    const log = getLog();
    this.post({ type: 'building', title: current.label });
    this.status.set({ kind: 'building' });

    const result = await this.bundler.build(current.key);
    if (id !== this.buildSeq || this.current !== current) {
      return; // A newer build or a different target superseded this one.
    }
    for (const w of result.warnings) log.warn(formatBuildMessage(w));
    if (result.ok) {
      log.info(`Built ${current.label} in ${result.buildMs} ms`);
      this.successfulBuildTimes.push(result.buildMs);
      const summary = mockSummary(result.mocked);
      if (summary && summary !== this.lastMockSummary) {
        log.info(`Native modules replaced with mocks because they can't run on web: ${summary}`);
      }
      this.lastMockSummary = summary;
      this.bundles.set(id, { fingerprint: bundleFingerprint(result.code) });
      for (const old of [...this.bundles.keys()].filter((k) => k <= id - BUNDLES_KEPT)) {
        this.bundles.delete(old);
      }
      this.status.set({ kind: 'ok', buildMs: result.buildMs });
      this.deliver({
        type: 'bundle',
        id,
        code: result.code,
        css: result.css,
        buildMs: result.buildMs,
        platform: current.key.platform,
        mocked: result.mocked,
      });
    } else {
      log.error(
        `Build failed for ${current.label}:\n${result.errors.map(formatBuildMessage).join('\n')}`,
      );
      this.status.set({ kind: 'buildError' });
      this.deliver({ type: 'buildError', id, errors: result.errors });
    }
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      'RN Lens',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.setupPanel(panel);
    return panel;
  }

  private setupPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.webviewReady = false;
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'vendor'),
        vscode.Uri.file(this.cacheDir),
        ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
      ],
    };

    const allow = sanitizeAllowList(
      vscode.workspace.getConfiguration('rnLens').get<unknown[]>('networkAllowList', []),
    );
    if (allow.rejected.length > 0) {
      getLog().warn(
        `Ignored rnLens.networkAllowList entries that aren't origins like "http://localhost:4000": ${allow.rejected.join(', ')}`,
      );
    }
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

    this.panelDisposables.push(
      panel.onDidDispose(() => this.onPanelDisposed(panel)),
      webview.onDidReceiveMessage((m: unknown) => this.onMessage(m)),
    );
  }

  private onPanelDisposed(panel: vscode.WebviewPanel): void {
    if (this.panel !== panel) return;
    if (this.current) void this.bundler.release(this.current.key);
    for (const d of this.panelDisposables.splice(0)) d.dispose();
    this.panel = undefined;
    this.current = undefined;
    this.latest = undefined;
    this.webviewReady = false;
    this.bundles.clear();
    this.successfulBuildTimes = [];
    this.status.set({ kind: 'hidden' });
    for (const resolve of this.snapshotWaiters.values()) resolve(undefined);
    this.snapshotWaiters.clear();
  }

  private onMessage(message: unknown): void {
    if (!isWebviewMessage(message)) return;
    const m: WebviewMessage = message;
    const log = getLog();
    switch (m.type) {
      case 'ready':
        this.webviewReady = true;
        this.sendInit();
        this.sendVariants();
        if (this.latest) this.post(this.latest);
        break;
      case 'rendered':
        log.debug(`Rendered bundle #${m.id}`);
        break;
      case 'runtimeError':
        this.onRuntimeError(m).catch((err: unknown) =>
          log.error('Mapping a runtime error failed', err),
        );
        break;
      case 'console':
        this.onConsole(m.level, m.text);
        break;
      case 'openSource':
        this.openSource(m.file, m.line, m.column).catch((err: unknown) =>
          log.error(`Could not open ${m.file}`, err),
        );
        break;
      case 'selectVariant':
        this.selectVariant(m.name).catch((err: unknown) =>
          log.error('Switching variant failed', err),
        );
        break;
      case 'reload':
        this.reload().catch((err: unknown) => log.error('Reload failed', err));
        break;
      case 'showOutput':
        log.show(true);
        break;
      case '__test_snapshot_result':
        this.snapshotWaiters.get(m.requestId)?.({
          text: m.text,
          renderedId: m.renderedId,
          overlay: m.overlay,
          env: m.env,
        });
        this.snapshotWaiters.delete(m.requestId);
        break;
    }
  }

  /**
   * The source map for a delivered bundle. Maps are built on demand (normal rebuilds skip them)
   * and only trusted when the mapping build produced exactly the code that is running.
   */
  private async sourceMapFor(bundleId: number | undefined): Promise<BundleSourceMap | undefined> {
    const current = this.current;
    const bundle = bundleId === undefined ? undefined : this.bundles.get(bundleId);
    if (!current || !bundle) return undefined;
    if (bundle.map) return bundle.map;
    const built = await this.bundler.sourceMapFor(current.key);
    if (!built || built.fingerprint !== bundle.fingerprint) {
      getLog().debug('Source map unavailable for this bundle (files changed since it was built).');
      return undefined;
    }
    bundle.map = new BundleSourceMap(
      built.map,
      path.join(current.key.projectRoot, '.rnlens', 'out'),
      current.key.projectRoot,
      [vscode.Uri.joinPath(this.extensionUri, 'dist').fsPath],
    );
    return bundle.map;
  }

  private async onRuntimeError(
    m: Extract<WebviewMessage, { type: 'runtimeError' }>,
  ): Promise<void> {
    this.status.set({ kind: 'runtimeError' });
    let frames: ReturnType<BundleSourceMap['mapStack']> = [];
    let componentFrames: ReturnType<BundleSourceMap['mapStack']> = [];
    try {
      const map = await this.sourceMapFor(m.id);
      if (map) {
        frames = map.mapStack(m.stack);
        componentFrames = map.mapStack(m.componentStack);
      }
    } catch (err) {
      getLog().warn('Could not map the runtime error through the source map', err);
    }
    const top = frames.find((f) => f.userCode) ?? frames.find((f) => f.file);
    const where = top?.file ? ` (${top.file}:${top.line}:${top.column})` : '';
    getLog().error(`Runtime error in preview: ${m.message}${where}`);
    this.post({
      type: 'runtimeErrorResolved',
      errorId: m.errorId,
      message: m.message,
      frames,
      componentFrames,
    });
  }

  private onConsole(level: ConsoleLevel, text: string): void {
    const log = getLog();
    const line = `[preview] ${text}`;
    if (level === 'error') log.error(line);
    else if (level === 'warn') log.warn(line);
    else if (level === 'debug') log.debug(line);
    else log.info(line);
  }

  private async openSource(file: string, line: number, column: number): Promise<void> {
    if (!path.isAbsolute(file) || !existsSync(file)) return;
    const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
    // Open next to the preview, never on top of it.
    const editorColumn =
      this.panel?.viewColumn === vscode.ViewColumn.One
        ? vscode.ViewColumn.Two
        : vscode.ViewColumn.One;
    await vscode.window.showTextDocument(vscode.Uri.file(file), {
      viewColumn: editorColumn,
      selection: new vscode.Range(position, position),
      preview: false,
    });
  }

  private async selectVariant(name: string | null): Promise<void> {
    const current = this.current;
    if (!current) return;
    const variant =
      name && current.variantFile && current.variants.includes(name)
        ? { file: current.variantFile, name }
        : undefined;
    current.key = { ...current.key, target: { ...current.key.target, variant } };
    this.sendInit();
    await this.rebuild();
  }

  private onDidSave(doc: vscode.TextDocument): void {
    const current = this.current;
    if (!current || doc.uri.scheme !== 'file') return;
    const file = doc.uri.fsPath;
    const root = current.key.projectRoot;
    if (!isWithin(root, file, path) || isInNodeModules(file)) return;
    const work = async (): Promise<void> => {
      if (current.variantFile === file || findVariantFile(current.key.target.file) === file) {
        await this.refreshVariants();
      }
      if (needsReload(root, file)) await this.reload();
      else await this.rebuild();
      void this.updateContextKeys();
    };
    work().catch((err: unknown) => getLog().error('Rebuild after save failed', err));
  }

  private async refreshVariants(): Promise<void> {
    const current = this.current;
    if (!current) return;
    current.variantFile = findVariantFile(current.key.target.file);
    current.variants = current.variantFile ? await listVariants(current.variantFile) : [];
    const selected = current.key.target.variant?.name;
    if (selected && !current.variants.includes(selected)) {
      current.key = { ...current.key, target: { ...current.key.target, variant: undefined } };
    }
    this.sendVariants();
  }

  private async updateContextKeys(): Promise<void> {
    const current = this.current;
    if (!current) return;
    await vscode.commands.executeCommand(
      'setContext',
      'rnLens.hasVariants',
      current.variants.length > 0,
    );
    await vscode.commands.executeCommand(
      'setContext',
      'rnLens.hasDecorators',
      findDecorators(current.key.projectRoot) !== undefined,
    );
  }

  private sendInit(): void {
    const current = this.current;
    const panel = this.panel;
    if (!current || !panel) return;
    const t = current.key.target;
    this.post({
      type: 'init',
      target: {
        file: t.file,
        exportName: t.exportName,
        label: current.label,
        variant: t.variant?.name ?? null,
      },
      defaultDevice: vscode.workspace
        .getConfiguration('rnLens')
        .get<string>('defaultDevice', 'iphone-15'),
      assetBase: panel.webview
        .asWebviewUri(vscode.Uri.file(assetCacheDir(this.cacheDir)))
        .toString(),
    });
  }

  private sendVariants(): void {
    const current = this.current;
    if (!current) return;
    this.post({
      type: 'variants',
      names: current.variants,
      selected: current.key.target.variant?.name ?? null,
    });
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
