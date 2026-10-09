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
  type PreviewTarget,
  type SimulatedPlatform,
  type VariantRef,
} from '../bundler/types';
import { findDecorators } from '../bundler/virtualEntry';
import { detectComponents, pickDefaultComponent } from '../codelens/componentDetection';
import { BundleSourceMap } from '../diagnostics/sourceMaps';
import { detectAppEntry } from '../project/appEntry';
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
import { findVariantFile, listAllVariants, type VariantInfo } from './variants';

export const PREVIEW_VIEW_TYPE = 'rnLens.preview';
const SNAPSHOT_TIMEOUT_MS = 2000;
/** Recent bundles remembered so late runtime errors can still be mapped. */
const BUNDLES_KEPT = 2;
const TYPE_DEBOUNCE_MS = 300;
const FOLLOW_DEBOUNCE_MS = 250;
const PREVIEWABLE_LANGUAGES = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

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
  variants: VariantInfo[];
}

/** The bundle reference for a variant chosen by name, if the component has one by that name. */
function variantRef(
  name: string | null | undefined,
  variants: readonly VariantInfo[],
  variantFile: string | undefined,
  componentFile: string,
): VariantRef | undefined {
  const info = name ? variants.find((v) => v.name === name) : undefined;
  if (!info) return undefined;
  if (info.kind === 'props') return { kind: 'props', file: componentFile, name: info.name };
  return variantFile ? { kind: 'file', file: variantFile, name: info.name } : undefined;
}

function formatBuildMessage(m: BuildMessage): string {
  const where = m.file ? `${m.file}:${m.line ?? 0}:${(m.column ?? 0) + 1}: ` : '';
  return `${where}${m.text}`;
}

const isInNodeModules = (file: string): boolean => file.split(/[\\/]/).includes('node_modules');

/** Files whose change requires a fresh esbuild context rather than an incremental rebuild. */
export function needsReload(projectRoot: string, file: string): boolean {
  const base = path.basename(file);
  if (['package.json', 'app.json', 'tsconfig.json'].includes(base)) return true;
  if (/^(?:babel\.config|\.babelrc|rnlens\.config)(?:\.[cm]?js|\.json)?$/.test(base)) return true;
  if (base === '.env' || base.startsWith('.env.')) return true;
  // A new platform-specific file changes which imports the context must intercept.
  if (/\.(?:ios|android|native)\.(?:tsx|ts|jsx|js)$/.test(base)) return true;
  return isWithin(path.join(projectRoot, '.rnlens', 'mocks'), file, path);
}

function mockSummary(mocked: readonly MockedPackage[]): string {
  return mocked
    .map((m) =>
      m.source === 'project'
        ? `${m.specifier} (your mock)`
        : m.source === 'auto'
          ? `${m.specifier} (no-op auto-mock${m.note ? `: ${m.note}` : ''})`
          : `${m.specifier} (built-in mock${m.note ? `: ${m.note}` : ''})`,
    )
    .join(', ');
}

const settings = () => vscode.workspace.getConfiguration('rnLens');
const settingPlatform = (): SimulatedPlatform =>
  settings().get<SimulatedPlatform>('simulatedPlatform', 'ios');

/**
 * Owns the preview webview panel: builds the current target, delivers bundles to the webview,
 * maps runtime errors to source, rebuilds on save (or while typing), follows the active editor
 * unless locked, and reacts to settings.
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
  /** Simulated platform of the open panel (toolbar toggle; follows the setting when it changes). */
  private platform: SimulatedPlatform = settingPlatform();
  private locked = false;
  /** File opened from the error overlay: don't retarget the preview to it. */
  private ignoreFollowFor: string | undefined;
  private typeTimer: ReturnType<typeof setTimeout> | undefined;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
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
    /** Called after each successful build with the packages that were mocked. */
    private readonly onMocked: (
      projectRoot: string,
      mocked: readonly MockedPackage[],
    ) => void = () => undefined,
  ) {
    const log = getLog();
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDidChangeText(e)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('rnLens.simulatedPlatform')) {
          this.setPlatform(settingPlatform()).catch((err: unknown) =>
            log.error('Switching the simulated platform failed', err),
          );
        }
        if (e.affectsConfiguration('rnLens.networkAllowList') && this.panel) {
          this.renderHtml(this.panel);
        }
        if (
          e.affectsConfiguration('rnLens.entry') ||
          e.affectsConfiguration('rnLens.extraAliases')
        ) {
          this.reload().catch(() => undefined);
        }
        if (e.affectsConfiguration('rnLens.updateMode')) {
          // The unsaved-buffers plugin is part of the esbuild context.
          this.reload().catch(() => undefined);
        }
      }),
    );
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Previews a component. */
  async show(request: PreviewRequest): Promise<void> {
    const project = await this.projectOf(request.file);
    const file = request.file.fsPath;
    const { variantFile, variants } = await listAllVariants(file, request.exportName);
    this.ensurePanel();
    await this.retarget(
      {
        kind: 'component',
        file,
        exportName: request.exportName,
        variant: variantRef(request.variant, variants, variantFile, file),
      },
      project,
      request.label,
      variantFile,
      variants,
    );
  }

  /** Previews the whole app of the project containing `hint` (or the workspace's first project). */
  async showApp(hint?: vscode.Uri): Promise<void> {
    let projectRoot: string | undefined;
    if (hint) {
      projectRoot = (await this.projects.projectFor(hint))?.root;
    }
    projectRoot ??= this.current?.key.projectRoot ?? this.projects.getProjects()[0]?.root;
    if (!projectRoot) {
      throw new UserError(
        "There's no React Native or Expo project in this workspace, so there's no app to preview. " +
          'Open a folder whose package.json depends on react-native or expo.',
      );
    }
    const entry = detectAppEntry(
      projectRoot,
      this.platform,
      settings().get<string>('entry') || undefined,
    );
    if ('error' in entry) throw new UserError(entry.error);
    getLog().info(`Previewing the app from ${entry.description}: ${entry.file}`);
    this.ensurePanel();
    await this.retarget(
      { kind: 'app', file: entry.file, mode: entry.mode, routerAppDir: entry.routerAppDir },
      projectRoot,
      'App',
      undefined,
      [],
    );
  }

  /** Re-attaches a panel restored by VS Code after a restart. */
  async restore(panel: vscode.WebviewPanel, target: PanelTarget): Promise<void> {
    this.panel?.dispose();
    this.setupPanel(panel);
    if (target.platform) this.platform = target.platform;
    if (target.kind === 'app') {
      await this.showApp(vscode.Uri.file(target.file));
    } else {
      await this.show({
        file: vscode.Uri.file(target.file),
        exportName: target.exportName,
        label: target.label,
        variant: target.variant,
      });
    }
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

  /** Switches the simulated platform of the open preview (rebuilds to resolve platform files). */
  async setPlatform(platform: SimulatedPlatform): Promise<void> {
    this.platform = platform;
    const current = this.current;
    if (!current || current.key.platform === platform) return;
    void this.bundler.release(current.key);
    current.key = { ...current.key, platform };
    this.sendInit();
    await this.rebuild();
  }

  /** Locks the preview to its current target, or unlocks it to follow the active editor. */
  async toggleLock(): Promise<boolean> {
    this.locked = !this.locked;
    await vscode.commands.executeCommand('setContext', 'rnLens.previewLocked', this.locked);
    this.sendInit();
    return this.locked;
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

  /** The file and export currently previewed (test hook). */
  get currentTarget(): PreviewTarget | undefined {
    return this.current?.key.target;
  }

  /** Test-only: clicks the n-th clickable frame in the error overlay. */
  clickOverlayFrame(index: number): void {
    this.post({ type: '__test_click_frame', index });
  }

  /** Test-only: presses the preview element whose text is exactly `text`. */
  press(text: string): void {
    this.post({ type: '__test_press', text });
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

  private async projectOf(file: vscode.Uri): Promise<string> {
    const project = await this.projects.projectFor(file);
    if (!project) {
      throw new UserError(
        `${path.basename(file.fsPath)} isn't inside a React Native or Expo project, so RN Lens can't preview it. ` +
          'Open a file from a project whose package.json depends on react-native or expo.',
      );
    }
    return project.root;
  }

  private async retarget(
    target: PreviewTarget,
    projectRoot: string,
    label: string,
    variantFile: string | undefined,
    variants: VariantInfo[],
  ): Promise<void> {
    const key: BundleKey = { projectRoot, platform: this.platform, target };
    if (this.current && bundleKeyId(this.current.key) !== bundleKeyId(key)) {
      void this.bundler.release(this.current.key);
    }
    this.current = { key, label, variantFile, variants };
    void this.updateContextKeys();

    const panel = this.panel;
    if (!panel) return;
    panel.title = `RN Lens: ${label}`;
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
        log.info(`Replaced with mocks because they can't run on web: ${summary}`);
      }
      this.lastMockSummary = summary;
      this.onMocked(current.key.projectRoot, result.mocked);
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
        mocked: result.mocked.map(({ specifier, source, note }) => ({ specifier, source, note })),
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
    this.platform = settingPlatform();
    this.setupPanel(panel);
    return panel;
  }

  private setupPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.panelDisposables.push(
      panel.onDidDispose(() => this.onPanelDisposed(panel)),
      panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m)),
    );
    this.renderHtml(panel);
  }

  /** (Re)writes the webview document; the webview reloads and asks for the latest state. */
  private renderHtml(panel: vscode.WebviewPanel): void {
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
    const allow = sanitizeAllowList(settings().get<unknown[]>('networkAllowList', []));
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
  }

  private onPanelDisposed(panel: vscode.WebviewPanel): void {
    if (this.panel !== panel) return;
    if (this.current) void this.bundler.release(this.current.key);
    for (const d of this.panelDisposables.splice(0)) d.dispose();
    clearTimeout(this.typeTimer);
    clearTimeout(this.followTimer);
    this.panel = undefined;
    this.current = undefined;
    this.latest = undefined;
    this.webviewReady = false;
    this.locked = false;
    void vscode.commands.executeCommand('setContext', 'rnLens.previewLocked', false);
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
      case 'setPlatform':
        this.setPlatform(m.platform).catch((err: unknown) =>
          log.error('Switching the simulated platform failed', err),
        );
        break;
      case 'toggleLock':
        this.toggleLock().catch((err: unknown) => log.error('Toggling the lock failed', err));
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
    // Open next to the preview, never on top of it, and don't retarget the preview to it.
    const editorColumn =
      this.panel?.viewColumn === vscode.ViewColumn.One
        ? vscode.ViewColumn.Two
        : vscode.ViewColumn.One;
    this.ignoreFollowFor = file;
    await vscode.window.showTextDocument(vscode.Uri.file(file), {
      viewColumn: editorColumn,
      selection: new vscode.Range(position, position),
      preview: false,
    });
  }

  private async selectVariant(name: string | null): Promise<void> {
    const current = this.current;
    if (!current || current.key.target.kind !== 'component') return;
    const target = current.key.target;
    const variant = variantRef(name, current.variants, current.variantFile, target.file);
    current.key = { ...current.key, target: { ...target, variant } };
    this.sendInit();
    await this.rebuild();
  }

  private isProjectSource(file: string): boolean {
    const current = this.current;
    return !!current && isWithin(current.key.projectRoot, file, path) && !isInNodeModules(file);
  }

  private onDidSave(doc: vscode.TextDocument): void {
    const current = this.current;
    if (!current || doc.uri.scheme !== 'file') return;
    const file = doc.uri.fsPath;
    if (!this.isProjectSource(file)) return;
    const root = current.key.projectRoot;
    const work = async (): Promise<void> => {
      const target = current.key.target;
      if (
        target.kind === 'component' &&
        (current.variantFile === file ||
          findVariantFile(target.file) === file ||
          target.file === file)
      ) {
        await this.refreshVariants();
      }
      if (needsReload(root, file)) await this.reload();
      else await this.rebuild();
      void this.updateContextKeys();
    };
    work().catch((err: unknown) => getLog().error('Rebuild after save failed', err));
  }

  /** `onType` mode: rebuild (with unsaved contents) shortly after edits stop. */
  private onDidChangeText(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0 || e.document.uri.scheme !== 'file') return;
    if (settings().get<string>('updateMode', 'onSave') !== 'onType') return;
    if (!this.isProjectSource(e.document.uri.fsPath)) return;
    clearTimeout(this.typeTimer);
    this.typeTimer = setTimeout(() => {
      this.rebuild().catch((err: unknown) => getLog().error('Rebuild while typing failed', err));
    }, TYPE_DEBOUNCE_MS);
  }

  /** Unless locked, a component preview follows the active editor to other component files. */
  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    const current = this.current;
    if (!editor || !this.panel || !current || this.locked) return;
    if (current.key.target.kind !== 'component') return;
    const doc = editor.document;
    const file = doc.uri.fsPath;
    if (doc.uri.scheme !== 'file' || !PREVIEWABLE_LANGUAGES.has(doc.languageId)) return;
    if (this.ignoreFollowFor === file) {
      this.ignoreFollowFor = undefined;
      return;
    }
    if (file === current.key.target.file || isInNodeModules(file)) return;
    // RN Lens's own files (mocks, decorators) aren't something to preview.
    if (file.split(/[\\/]/).includes('.rnlens')) return;
    clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => {
      const component = pickDefaultComponent(detectComponents(doc.getText()));
      if (!component || this.locked || this.current !== current) return;
      const label =
        component.exportName === 'default'
          ? (component.localName ?? path.basename(file, path.extname(file)))
          : component.exportName;
      this.show({ file: doc.uri, exportName: component.exportName, label }).catch((err: unknown) =>
        getLog().debug(`Not following to ${file}`, err),
      );
    }, FOLLOW_DEBOUNCE_MS);
  }

  private async refreshVariants(): Promise<void> {
    const current = this.current;
    if (!current || current.key.target.kind !== 'component') return;
    const target = current.key.target;
    const { variantFile, variants } = await listAllVariants(target.file, target.exportName);
    current.variantFile = variantFile;
    current.variants = variants;
    const selected = target.variant?.name;
    current.key = {
      ...current.key,
      target: { ...target, variant: variantRef(selected, variants, variantFile, target.file) },
    };
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
        kind: t.kind,
        file: t.file,
        exportName: t.kind === 'component' ? t.exportName : '',
        label: current.label,
        variant: t.kind === 'component' ? (t.variant?.name ?? null) : null,
        platform: current.key.platform,
      },
      defaultDevice: settings().get<string>('defaultDevice', 'iphone-15'),
      assetBase: panel.webview
        .asWebviewUri(vscode.Uri.file(assetCacheDir(this.cacheDir)))
        .toString(),
      platform: current.key.platform,
      locked: this.locked,
    });
  }

  private sendVariants(): void {
    const current = this.current;
    if (!current) return;
    const t = current.key.target;
    this.post({
      type: 'variants',
      names: current.variants.map((v) => v.name),
      selected: t.kind === 'component' ? (t.variant?.name ?? null) : null,
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
    clearTimeout(this.typeTimer);
    clearTimeout(this.followTimer);
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
