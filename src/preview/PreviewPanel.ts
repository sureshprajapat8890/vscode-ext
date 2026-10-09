import { existsSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { assetCacheDir, outDir } from '../bundler/buildOptions';
import { bundleFingerprint, type BundlerService } from '../bundler/BundlerService';
import { planDelivery, type DeliveredBundle } from '../bundler/refresh/hotPlan';
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
import { BundleSourceMap, mapStackAcross } from '../diagnostics/sourceMaps';
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
  type ProtocolPlan,
  type WebviewMessage,
} from './protocol';
import type { PreviewStatus } from './statusBar';
import { findStoriesFile, findVariantFile, listAllVariants, type VariantInfo } from './variants';

export const PREVIEW_VIEW_TYPE = 'rnLens.preview';
const SNAPSHOT_TIMEOUT_MS = 2000;
/** Recent bundles remembered so late runtime errors can still be mapped. */
const BUNDLES_KEPT = 2;
const FOLLOW_DEBOUNCE_MS = 250;
export const PREVIEWABLE_LANGUAGES = new Set([
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

/** What a panel needs from the extension; implemented by PreviewPanelManager. */
export interface PanelHost {
  readonly extensionUri: vscode.Uri;
  readonly cacheDir: string;
  readonly bundler: BundlerService;
  readonly projects: ProjectRegistry;
  /** Called after each successful build with the packages that were mocked. */
  onMocked(projectRoot: string, mocked: readonly MockedPackage[]): void;
  /** The status bar shows the active panel's status. */
  onStatus(panel: PreviewPanel, status: PreviewStatus): void;
  onActive(panel: PreviewPanel): void;
  onLockChanged(panel: PreviewPanel): void;
  onDisposed(panel: PreviewPanel): void;
  /** Restarts the esbuild contexts of `key` and rebuilds every panel using them. */
  reloadKey(key: BundleKey): Promise<void>;
}

/** Where a component's variants come from (besides its own `previews` object). */
interface VariantSources {
  /** The colocated `<Name>.preview.*` file. */
  variantFile: string | undefined;
  /** The colocated Storybook `<Name>.stories.*` file. */
  storiesFile: string | undefined;
}

interface Current {
  key: BundleKey;
  label: string;
  sources: VariantSources;
  variants: VariantInfo[];
}

const NO_SOURCES: VariantSources = { variantFile: undefined, storiesFile: undefined };

/** The bundle reference for a variant chosen by name, if the component has one by that name. */
function variantRef(
  name: string | null | undefined,
  variants: readonly VariantInfo[],
  sources: VariantSources,
  componentFile: string,
): VariantRef | undefined {
  const info = name ? variants.find((v) => v.name === name) : undefined;
  if (!info) return undefined;
  if (info.kind === 'props') return { kind: 'props', file: componentFile, name: info.name };
  const file = info.kind === 'story' ? sources.storiesFile : sources.variantFile;
  return file ? { kind: info.kind, file, name: info.name } : undefined;
}

function formatBuildMessage(m: BuildMessage): string {
  const where = m.file ? `${m.file}:${m.line ?? 0}:${(m.column ?? 0) + 1}: ` : '';
  return `${where}${m.text}`;
}

export const isInNodeModules = (file: string): boolean =>
  file.split(/[\\/]/).includes('node_modules');

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

export const settings = (): vscode.WorkspaceConfiguration =>
  vscode.workspace.getConfiguration('rnLens');
export const settingPlatform = (): SimulatedPlatform =>
  settings().get<SimulatedPlatform>('simulatedPlatform', 'ios');

/**
 * One preview webview panel: builds its target, delivers bundles (hot updates planned against what
 * this webview is running), maps runtime errors to source and follows the active editor unless
 * locked. Panels showing the same target share esbuild contexts.
 */
export class PreviewPanel {
  private current: Current | undefined;
  private webviewReady = false;
  /** Latest bundle or build error, re-sent when the webview (re)loads. */
  private latest: HostMessage | undefined;
  /** The app bundle the webview is running, for planning the next hot update. */
  private delivered: DeliveredBundle | undefined;
  /** Why the next delivered bundle must remount instead of hot-updating (explicit requests). */
  private forceFull: string | undefined;
  private buildSeq = 0;
  private snapshotSeq = 0;
  private lastMockSummary = '';
  private status: PreviewStatus = { kind: 'hidden' };
  /** Simulated platform (toolbar toggle; follows the setting when it changes). */
  private platform: SimulatedPlatform = settingPlatform();
  private locked = false;
  private disposed = false;
  /** File opened from the error overlay: don't retarget the preview to it. */
  private ignoreFollowFor: string | undefined;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
  /** Fingerprint of each recently delivered bundle, and its source maps once built. */
  private readonly bundles = new Map<
    number,
    { app: string; vendor: string; maps?: { app?: BundleSourceMap; vendor?: BundleSourceMap } }
  >();
  /** Vendor bundle version the webview is running (it's only re-sent when this changes). */
  private webviewVendor: string | undefined;
  private readonly snapshotWaiters = new Map<number, (s: PreviewSnapshot | undefined) => void>();
  private readonly disposables: vscode.Disposable[] = [];
  /** Durations (ms) of successful builds since the panel opened, oldest first. */
  readonly buildTimes: number[] = [];
  /** Modules in the last successful build. */
  moduleCount: number | undefined;

  constructor(
    readonly webviewPanel: vscode.WebviewPanel,
    private readonly host: PanelHost,
    platform?: SimulatedPlatform,
  ) {
    if (platform) this.platform = platform;
    this.disposables.push(
      webviewPanel.onDidDispose(() => this.onDisposed()),
      webviewPanel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m)),
      webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) this.host.onActive(this);
      }),
    );
    this.renderHtml();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get key(): BundleKey | undefined {
    return this.current?.key;
  }

  get currentTarget(): PreviewTarget | undefined {
    return this.current?.key.target;
  }

  get currentStatus(): PreviewStatus {
    return this.status;
  }

  /** Previews a component. */
  async show(request: PreviewRequest): Promise<void> {
    const projectRoot = await this.projectOf(request.file);
    const file = request.file.fsPath;
    const { variants, ...sources } = await listAllVariants(file, request.exportName);
    await this.retarget(
      {
        kind: 'component',
        file,
        exportName: request.exportName,
        variant: variantRef(request.variant, variants, sources, file),
      },
      projectRoot,
      request.label,
      sources,
      variants,
    );
  }

  /** Previews the whole app of the project containing `hint` (or `fallbackRoot`). */
  async showApp(hint: vscode.Uri | undefined, fallbackRoot: string | undefined): Promise<void> {
    let projectRoot: string | undefined;
    if (hint) projectRoot = (await this.host.projects.projectFor(hint))?.root;
    projectRoot ??= this.current?.key.projectRoot ?? fallbackRoot;
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
    await this.retarget(
      { kind: 'app', file: entry.file, mode: entry.mode, routerAppDir: entry.routerAppDir },
      projectRoot,
      'App',
      NO_SOURCES,
      [],
    );
  }

  /** Shows what a panel restored by VS Code after a restart was showing. */
  async restore(target: PanelTarget): Promise<void> {
    if (target.kind === 'app') {
      await this.showApp(vscode.Uri.file(target.file), undefined);
    } else {
      await this.show({
        file: vscode.Uri.file(target.file),
        exportName: target.exportName,
        label: target.label,
        variant: target.variant,
      });
    }
  }

  /** Shows the same target, variant and platform as `other` (sharing its esbuild contexts). */
  async showSameAs(other: PreviewPanel): Promise<void> {
    const source = other.current;
    if (!source) return;
    this.platform = source.key.platform;
    await this.retarget(
      source.key.target,
      source.key.projectRoot,
      source.label,
      source.sources,
      source.variants,
    );
  }

  /** Restarts the esbuild contexts (shared with panels showing the same target) and rebuilds. */
  async reload(): Promise<void> {
    if (!this.current) {
      throw new UserError(
        'No RN Lens preview is open, so there is nothing to reload. Run "RN Lens: Open Preview" first.',
      );
    }
    await this.host.reloadKey(this.current.key);
  }

  /** Switches the simulated platform (rebuilds to resolve platform files). */
  async setPlatform(platform: SimulatedPlatform): Promise<void> {
    this.platform = platform;
    const current = this.current;
    if (!current || current.key.platform === platform) return;
    void this.host.bundler.release(current.key, this);
    current.key = { ...current.key, platform };
    this.sendInit();
    await this.rebuild();
  }

  /** Locks the preview to its current target, or unlocks it to follow the active editor. */
  toggleLock(): boolean {
    this.locked = !this.locked;
    this.sendInit();
    this.host.onLockChanged(this);
    return this.locked;
  }

  reveal(): void {
    this.webviewPanel.reveal(this.webviewPanel.viewColumn, true);
  }

  /** Re-renders the webview document (e.g. after rnLens.networkAllowList changed). */
  renderHtml(): void {
    this.webviewReady = false;
    const webview = this.webviewPanel.webview;
    const { extensionUri, cacheDir } = this.host;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist'),
        vscode.Uri.joinPath(extensionUri, 'vendor'),
        vscode.Uri.file(cacheDir),
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
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'))
        .toString(),
      connectSrc: allow.origins,
    });
  }

  /** True if `file` is source of this panel's project (outside node_modules). */
  isProjectSource(file: string): boolean {
    const current = this.current;
    return !!current && isWithin(current.key.projectRoot, file, path) && !isInNodeModules(file);
  }

  /** Re-reads the variant list when a saved file is the component or its variants file. */
  async refreshVariantsFor(file: string): Promise<void> {
    const current = this.current;
    if (!current || current.key.target.kind !== 'component') return;
    const target = current.key.target;
    const related = [
      target.file,
      current.sources.variantFile,
      current.sources.storiesFile,
      findVariantFile(target.file),
      findStoriesFile(target.file),
    ];
    if (!related.includes(file)) return;
    const { variants, ...sources } = await listAllVariants(target.file, target.exportName);
    current.sources = sources;
    current.variants = variants;
    const selected = target.variant?.name;
    current.key = {
      ...current.key,
      target: { ...target, variant: variantRef(selected, variants, sources, target.file) },
    };
    this.sendVariants();
    void this.updateContextKeys();
  }

  /** Unless locked, a component preview follows the active editor to other component files. */
  follow(editor: vscode.TextEditor): void {
    const current = this.current;
    if (!current || this.locked || current.key.target.kind !== 'component') return;
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

  /**
   * Builds the current target and delivers the result to the webview, as a hot update when
   * possible. `fullReason` forces a remount (e.g. an explicit reload).
   */
  async rebuild(fullReason?: string): Promise<void> {
    const current = this.current;
    if (!current || this.disposed) return;
    if (fullReason) this.forceFull = fullReason;
    const id = ++this.buildSeq;
    const log = getLog();
    this.post({ type: 'building', title: current.label });
    this.setStatus({ kind: 'building' });

    const result = await this.host.bundler.build(current.key, this);
    if (id !== this.buildSeq || this.current !== current || this.disposed) {
      return; // A newer build or a different target superseded this one.
    }
    for (const w of result.warnings) log.warn(formatBuildMessage(w));
    if (!result.ok) {
      log.error(
        `Build failed for ${current.label}:\n${result.errors.map(formatBuildMessage).join('\n')}`,
      );
      this.setStatus({ kind: 'buildError' });
      this.deliver({ type: 'buildError', id, errors: result.errors });
      return;
    }
    log.info(`Built ${current.label} in ${result.buildMs} ms (${result.moduleCount} modules)`);
    this.buildTimes.push(result.buildMs);
    this.moduleCount = result.moduleCount;
    const summary = mockSummary(result.mocked);
    if (summary && summary !== this.lastMockSummary) {
      log.info(`Replaced with mocks because they can't run on web: ${summary}`);
    }
    this.lastMockSummary = summary;
    this.host.onMocked(current.key.projectRoot, result.mocked);
    this.bundles.set(id, {
      app: bundleFingerprint(result.app.code),
      vendor: result.vendor.version,
    });
    for (const old of [...this.bundles.keys()].filter((k) => k <= id - BUNDLES_KEPT)) {
      this.bundles.delete(old);
    }
    this.setStatus({ kind: 'ok', buildMs: result.buildMs });

    const next: DeliveredBundle = {
      contextId: bundleKeyId(current.key),
      vendorVersion: result.vendor.version,
      entryHash: result.entryHash,
      modules: result.modules,
    };
    // Previewing a target again starts it fresh (e.g. the app from its first screen).
    const plan: ProtocolPlan = this.forceFull
      ? { kind: 'full', reason: this.forceFull }
      : planDelivery(this.delivered, next, result.importers);
    this.forceFull = undefined;
    this.delivered = next;
    log.debug(
      plan.kind === 'full'
        ? `Full reload: ${plan.reason}`
        : `Hot update: ${plan.reexecute.length} module(s) re-run`,
    );
    this.deliver({
      type: 'bundle',
      id,
      app: result.app,
      vendor: result.vendor,
      plan,
      buildMs: result.buildMs,
      platform: current.key.platform,
      mocked: result.mocked.map(({ specifier, source, note }) => ({ specifier, source, note })),
    });
  }

  /** Test-only: rendered text, overlay and device state, or undefined if the webview isn't ready. */
  snapshot(): Promise<PreviewSnapshot | undefined> {
    if (!this.webviewReady || this.disposed) return Promise.resolve(undefined);
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
  selectVariant(name: string | null): Promise<void> {
    return this.onSelectVariant(name);
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

  /** Closes the panel and waits for its esbuild contexts to be released. */
  async close(): Promise<void> {
    const key = this.current?.key;
    this.webviewPanel.dispose();
    if (key) await this.host.bundler.release(key, this);
  }

  async updateContextKeys(): Promise<void> {
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

  private async projectOf(file: vscode.Uri): Promise<string> {
    const project = await this.host.projects.projectFor(file);
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
    sources: VariantSources,
    variants: VariantInfo[],
  ): Promise<void> {
    if (this.disposed) return;
    const key: BundleKey = { projectRoot, platform: this.platform, target };
    const previous = this.current?.key;
    this.current = { key, label, sources, variants };
    // Acquire the new contexts before releasing the old ones, so shared ones aren't restarted.
    const built = this.rebuild('the preview was opened');
    if (previous && bundleKeyId(previous) !== bundleKeyId(key)) {
      void this.host.bundler.release(previous, this);
    }
    void this.updateContextKeys();
    this.webviewPanel.title = `RN Lens: ${label}`;
    this.webviewPanel.reveal(this.webviewPanel.viewColumn ?? vscode.ViewColumn.Beside, true);
    this.sendInit();
    this.sendVariants();
    await built;
  }

  private setStatus(status: PreviewStatus): void {
    this.status = status;
    this.host.onStatus(this, status);
  }

  private onDisposed(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.current) void this.host.bundler.release(this.current.key, this);
    for (const d of this.disposables.splice(0)) d.dispose();
    clearTimeout(this.followTimer);
    this.current = undefined;
    this.latest = undefined;
    this.delivered = undefined;
    this.webviewReady = false;
    this.bundles.clear();
    for (const resolve of this.snapshotWaiters.values()) resolve(undefined);
    this.snapshotWaiters.clear();
    this.host.onDisposed(this);
  }

  private onMessage(message: unknown): void {
    if (!isWebviewMessage(message)) return;
    const m: WebviewMessage = message;
    const log = getLog();
    switch (m.type) {
      case 'ready':
        this.webviewReady = true;
        this.webviewVendor = undefined;
        this.sendInit();
        this.sendVariants();
        this.replayLatest();
        break;
      case 'requestFullBundle':
        this.webviewVendor = undefined;
        this.replayLatest();
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
        this.onSelectVariant(m.name).catch((err: unknown) =>
          log.error('Switching variant failed', err),
        );
        break;
      case 'setPlatform':
        this.setPlatform(m.platform).catch((err: unknown) =>
          log.error('Switching the simulated platform failed', err),
        );
        break;
      case 'toggleLock':
        this.toggleLock();
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
   * Source maps for a delivered build (app and vendor bundles). Maps are built on demand (normal
   * rebuilds skip them) and only trusted when the mapping build produced exactly the code that is
   * running.
   */
  private async sourceMapsFor(
    bundleId: number | undefined,
  ): Promise<{ app?: BundleSourceMap; vendor?: BundleSourceMap }> {
    const current = this.current;
    const bundle = bundleId === undefined ? undefined : this.bundles.get(bundleId);
    if (!current || !bundle) return {};
    if (bundle.maps) return bundle.maps;
    const built = await this.host.bundler.sourceMapsFor(current.key);
    const root = current.key.projectRoot;
    const internal = [vscode.Uri.joinPath(this.host.extensionUri, 'dist').fsPath];
    const toMap = (json: string): BundleSourceMap =>
      new BundleSourceMap(json, outDir(root), root, internal);
    bundle.maps = {
      app: built.app?.fingerprint === bundle.app ? toMap(built.app.map) : undefined,
      vendor: built.vendor?.fingerprint === bundle.vendor ? toMap(built.vendor.map) : undefined,
    };
    if (!bundle.maps.app) {
      getLog().debug('Source map unavailable for this bundle (files changed since it was built).');
    }
    return bundle.maps;
  }

  private async onRuntimeError(
    m: Extract<WebviewMessage, { type: 'runtimeError' }>,
  ): Promise<void> {
    this.setStatus({ kind: 'runtimeError' });
    let frames: ReturnType<BundleSourceMap['mapStack']> = [];
    let componentFrames: ReturnType<BundleSourceMap['mapStack']> = [];
    try {
      const maps = await this.sourceMapsFor(m.id);
      const byUrl = new Map<string, BundleSourceMap>();
      if (m.bundleUrls.app && maps.app) byUrl.set(m.bundleUrls.app, maps.app);
      if (m.bundleUrls.vendor && maps.vendor) byUrl.set(m.bundleUrls.vendor, maps.vendor);
      frames = mapStackAcross(m.stack, byUrl);
      componentFrames = mapStackAcross(m.componentStack, byUrl);
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
      this.webviewPanel.viewColumn === vscode.ViewColumn.One
        ? vscode.ViewColumn.Two
        : vscode.ViewColumn.One;
    this.ignoreFollowFor = file;
    await vscode.window.showTextDocument(vscode.Uri.file(file), {
      viewColumn: editorColumn,
      selection: new vscode.Range(position, position),
      preview: false,
    });
  }

  private async onSelectVariant(name: string | null): Promise<void> {
    const current = this.current;
    if (!current || current.key.target.kind !== 'component') return;
    const target = current.key.target;
    const variant = variantRef(name, current.variants, current.sources, target.file);
    current.key = { ...current.key, target: { ...target, variant } };
    this.sendInit();
    await this.rebuild();
  }

  private sendInit(): void {
    const current = this.current;
    if (!current) return;
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
      assetBase: this.webviewPanel.webview
        .asWebviewUri(vscode.Uri.file(assetCacheDir(this.host.cacheDir)))
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
    if (message.type !== 'bundle') {
      this.post(message);
      return;
    }
    // The vendor bundle is large and rarely changes: only send its code when the webview lacks it.
    const sendVendor = message.vendor.version !== this.webviewVendor;
    this.post(
      sendVendor ? message : { ...message, vendor: { ...message.vendor, code: undefined } },
    );
    if (sendVendor && this.webviewReady) this.webviewVendor = message.vendor.version;
  }

  /** Re-sends the latest build as a full reload (for a webview that just (re)loaded). */
  private replayLatest(): void {
    const latest = this.latest;
    if (!latest) return;
    this.deliver(
      latest.type === 'bundle'
        ? { ...latest, plan: { kind: 'full', reason: 'the preview reloaded' } }
        : latest,
    );
  }

  private post(message: HostMessage): void {
    if (this.webviewReady && !this.disposed) {
      void this.webviewPanel.webview.postMessage(message);
    }
  }
}
