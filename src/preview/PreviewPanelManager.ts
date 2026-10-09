import * as vscode from 'vscode';
import type { BundlerService } from '../bundler/BundlerService';
import {
  bundleKeyId,
  type BundleKey,
  type MockedPackage,
  type PreviewTarget,
  type SimulatedPlatform,
} from '../bundler/types';
import type { ProjectRegistry } from '../project/projectRegistry';
import { UserError } from '../util/errors';
import { getLog } from '../util/log';
import {
  PREVIEW_VIEW_TYPE,
  PreviewPanel,
  needsReload,
  settingPlatform,
  settings,
  type PanelHost,
  type PreviewEnvOverride,
  type PreviewRequest,
  type PreviewSnapshot,
} from './PreviewPanel';
import type { PanelTarget } from './protocol';
import type { PreviewStatus, PreviewStatusBar } from './statusBar';

export { PREVIEW_VIEW_TYPE, needsReload };
export type { PreviewEnvOverride, PreviewRequest, PreviewSnapshot };

const TYPE_DEBOUNCE_MS = 300;
const NO_PREVIEW =
  'No RN Lens preview is open, so there is nothing to reload. Run "RN Lens: Open Preview" first.';

export interface ShowOptions {
  /** Open in an additional panel instead of retargeting the active one (side-by-side previews). */
  newPanel?: boolean;
}

/**
 * Owns the preview panels. Commands act on the active panel (the one focused most recently);
 * saves, typing, editor changes and settings reach every panel. Panels previewing the same target
 * share esbuild contexts, which are disposed when the last such panel closes.
 */
export class PreviewPanelManager implements PanelHost, vscode.Disposable {
  private readonly panels = new Set<PreviewPanel>();
  private active: PreviewPanel | undefined;
  private typeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    readonly extensionUri: vscode.Uri,
    readonly cacheDir: string,
    readonly bundler: BundlerService,
    readonly projects: ProjectRegistry,
    private readonly status: PreviewStatusBar,
    /** Called after each successful build with the packages that were mocked. */
    private readonly mockedCallback: (
      projectRoot: string,
      mocked: readonly MockedPackage[],
    ) => void = () => undefined,
  ) {
    const log = getLog();
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDidChangeText(e)),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) for (const panel of this.panels) panel.follow(editor);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('rnLens.simulatedPlatform')) {
          for (const panel of this.panels) {
            panel
              .setPlatform(settingPlatform())
              .catch((err: unknown) => log.error('Switching the simulated platform failed', err));
          }
        }
        if (e.affectsConfiguration('rnLens.networkAllowList')) {
          for (const panel of this.panels) panel.renderHtml();
        }
        if (
          e.affectsConfiguration('rnLens.entry') ||
          e.affectsConfiguration('rnLens.extraAliases') ||
          // Unsaved contents are read by a plugin inside the esbuild context.
          e.affectsConfiguration('rnLens.updateMode')
        ) {
          this.reloadAll().catch(() => undefined);
        }
      }),
    );
  }

  get isOpen(): boolean {
    return this.panels.size > 0;
  }

  get panelCount(): number {
    return this.panels.size;
  }

  get isLocked(): boolean {
    return this.active?.isLocked ?? false;
  }

  /** The file and export the active panel previews (test hook). */
  get currentTarget(): PreviewTarget | undefined {
    return this.active?.currentTarget;
  }

  /** Modules in the active panel's last successful build. */
  get moduleCount(): number | undefined {
    return this.active?.moduleCount;
  }

  /** Durations (ms) of the active panel's successful builds, oldest first. */
  get buildTimes(): readonly number[] {
    return this.active?.buildTimes ?? [];
  }

  /** Previews a component in the active panel (or a new one). */
  async show(request: PreviewRequest, options: ShowOptions = {}): Promise<void> {
    await this.panelFor(options).show(request);
  }

  /** Previews the whole app of the project containing `hint` (or the workspace's first project). */
  async showApp(hint?: vscode.Uri, options: ShowOptions = {}): Promise<void> {
    const fallback = this.active?.key?.projectRoot ?? this.projects.getProjects()[0]?.root;
    await this.panelFor(options).showApp(hint, fallback);
  }

  /** True when a preview panel has focus (so there is no active text editor). */
  get hasFocus(): boolean {
    return [...this.panels].some((p) => p.webviewPanel.active);
  }

  /** Opens the active panel's target in a new panel beside it (e.g. iPhone and Pixel). */
  async duplicateActive(): Promise<void> {
    const source = this.active;
    if (!source?.key) {
      throw new UserError(
        'No RN Lens preview is open, so there is nothing to show in a new panel. Open a component file and run "RN Lens: Open Preview" first.',
      );
    }
    await this.panelFor({ newPanel: true }).showSameAs(source);
  }

  /** Re-attaches a panel restored by VS Code after a restart. */
  async restore(webviewPanel: vscode.WebviewPanel, target: PanelTarget): Promise<void> {
    const panel = this.addPanel(webviewPanel, target.platform);
    await panel.restore(target);
  }

  /** Restarts the active panel's esbuild contexts and rebuilds. */
  async reload(): Promise<void> {
    if (!this.active) throw new UserError(NO_PREVIEW);
    await this.active.reload();
  }

  /** Restarts every open panel's contexts (e.g. after configuration changed). */
  async reloadAll(): Promise<void> {
    const keys = new Map<string, BundleKey>();
    for (const panel of this.panels) {
      if (panel.key) keys.set(bundleKeyId(panel.key), panel.key);
    }
    await Promise.all([...keys.values()].map((key) => this.reloadKey(key)));
  }

  /** Rebuilds every open panel (e.g. after the bundler cache was cleared). */
  async rebuildIfOpen(): Promise<void> {
    await Promise.all([...this.panels].map((p) => p.rebuild('the build cache was cleared')));
  }

  /** Switches the active panel's simulated platform. */
  async setPlatform(platform: SimulatedPlatform): Promise<void> {
    await this.active?.setPlatform(platform);
  }

  /** Locks the active panel to its target, or unlocks it to follow the active editor. */
  toggleLock(): boolean {
    if (!this.active) {
      throw new UserError(
        'No RN Lens preview is open, so there is nothing to lock. Open a preview first.',
      );
    }
    return this.active.toggleLock();
  }

  snapshot(): Promise<PreviewSnapshot | undefined> {
    return this.active?.snapshot() ?? Promise.resolve(undefined);
  }

  snapshotAll(): Promise<(PreviewSnapshot | undefined)[]> {
    return Promise.all([...this.panels].map((p) => p.snapshot()));
  }

  selectVariantForTest(name: string | null): Promise<void> {
    return this.active?.selectVariant(name) ?? Promise.resolve();
  }

  clickOverlayFrame(index: number): void {
    this.active?.clickOverlayFrame(index);
  }

  press(text: string): void {
    this.active?.press(text);
  }

  setEnv(env: PreviewEnvOverride): void {
    this.active?.setEnv(env);
  }

  /** Closes every panel and waits for their esbuild contexts to be released. */
  async close(): Promise<void> {
    await Promise.all([...this.panels].map((p) => p.close()));
  }

  // PanelHost

  onMocked(projectRoot: string, mocked: readonly MockedPackage[]): void {
    this.mockedCallback(projectRoot, mocked);
  }

  onStatus(panel: PreviewPanel, status: PreviewStatus): void {
    if (panel === this.active) this.status.set(status);
  }

  onActive(panel: PreviewPanel): void {
    if (this.active === panel) return;
    this.active = panel;
    this.status.set(panel.currentStatus);
    void this.syncContextKeys();
  }

  onLockChanged(panel: PreviewPanel): void {
    if (panel === this.active) void this.syncContextKeys();
  }

  onDisposed(panel: PreviewPanel): void {
    this.panels.delete(panel);
    if (this.active !== panel) return;
    this.active = [...this.panels].at(-1);
    this.status.set(this.active?.currentStatus ?? { kind: 'hidden' });
    void this.syncContextKeys();
  }

  async reloadKey(key: BundleKey): Promise<void> {
    const id = bundleKeyId(key);
    await this.bundler.reset(key);
    this.bundler.invalidateProject(key.projectRoot);
    const sharing = [...this.panels].filter((p) => p.key && bundleKeyId(p.key) === id);
    await Promise.all(sharing.map((p) => p.rebuild('the preview was reloaded')));
  }

  private panelFor(options: ShowOptions): PreviewPanel {
    if (this.active && !options.newPanel) return this.active;
    // Extra panels open in the editor group right of the active preview, side by side.
    const column =
      options.newPanel && this.active?.webviewPanel.viewColumn
        ? Math.min(this.active.webviewPanel.viewColumn + 1, vscode.ViewColumn.Nine)
        : vscode.ViewColumn.Beside;
    const webviewPanel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      'RN Lens',
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    return this.addPanel(webviewPanel, undefined);
  }

  private addPanel(
    webviewPanel: vscode.WebviewPanel,
    platform: SimulatedPlatform | undefined,
  ): PreviewPanel {
    const panel = new PreviewPanel(webviewPanel, this, platform);
    this.panels.add(panel);
    this.onActive(panel);
    return panel;
  }

  private async syncContextKeys(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'rnLens.previewLocked', this.isLocked);
    await this.active?.updateContextKeys();
  }

  private onDidSave(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'file') return;
    const file = doc.uri.fsPath;
    const affected = [...this.panels].filter((p) => p.isProjectSource(file));
    if (affected.length === 0) return;
    const work = async (): Promise<void> => {
      await Promise.all(affected.map((p) => p.refreshVariantsFor(file)));
      const reloadKeys = new Map<string, BundleKey>();
      const rebuild: PreviewPanel[] = [];
      for (const panel of affected) {
        const key = panel.key;
        if (key && needsReload(key.projectRoot, file)) reloadKeys.set(bundleKeyId(key), key);
        else rebuild.push(panel);
      }
      await Promise.all([
        ...[...reloadKeys.values()].map((key) => this.reloadKey(key)),
        ...rebuild.map((p) => p.rebuild()),
      ]);
    };
    work().catch((err: unknown) => getLog().error('Rebuild after save failed', err));
  }

  /** `onType` mode: rebuild (with unsaved contents) shortly after edits stop. */
  private onDidChangeText(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0 || e.document.uri.scheme !== 'file') return;
    if (settings().get<string>('updateMode', 'onSave') !== 'onType') return;
    const file = e.document.uri.fsPath;
    const affected = [...this.panels].filter((p) => p.isProjectSource(file));
    if (affected.length === 0) return;
    clearTimeout(this.typeTimer);
    this.typeTimer = setTimeout(() => {
      for (const panel of affected) {
        panel.rebuild().catch((err: unknown) => getLog().error('Rebuild while typing failed', err));
      }
    }, TYPE_DEBOUNCE_MS);
  }

  dispose(): void {
    clearTimeout(this.typeTimer);
    for (const panel of [...this.panels]) panel.webviewPanel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
