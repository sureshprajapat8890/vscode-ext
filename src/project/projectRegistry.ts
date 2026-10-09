import * as vscode from 'vscode';
import { detectProjects, type RNProject } from './detectProject';
import { getLog } from '../util/log';

const CONTEXT_KEY = 'rnLens.isRNProject';
const REFRESH_DEBOUNCE_MS = 500;
const MAX_PACKAGE_JSON_FILES = 200;

async function readWorkspaceFile(filePath: string): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Tracks which workspace folders contain React Native / Expo projects and keeps the
 * `rnLens.isRNProject` context key in sync as package.json files change.
 */
export class ProjectRegistry implements vscode.Disposable {
  private projects: RNProject[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<readonly RNProject[]>();

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    const schedule = (uri: vscode.Uri): void => {
      if (!uri.fsPath.split(/[\\/]/).includes('node_modules')) {
        this.scheduleRefresh();
      }
    };
    this.disposables.push(
      watcher,
      watcher.onDidCreate(schedule),
      watcher.onDidChange(schedule),
      watcher.onDidDelete(schedule),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      this.changeEmitter,
    );
  }

  getProjects(): readonly RNProject[] {
    return this.projects;
  }

  /** Re-scans the workspace. Concurrent calls share one scan. */
  refresh(): Promise<void> {
    this.refreshing ??= this.scan().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async scan(): Promise<void> {
    const uris = await vscode.workspace.findFiles(
      '**/package.json',
      '**/node_modules/**',
      MAX_PACKAGE_JSON_FILES,
    );
    const projects = await detectProjects(
      uris.filter((u) => u.scheme === 'file').map((u) => u.fsPath),
      readWorkspaceFile,
    );
    this.projects = projects;
    await vscode.commands.executeCommand('setContext', CONTEXT_KEY, projects.length > 0);

    const log = getLog();
    if (projects.length === 0) {
      log.info('No React Native or Expo project found in this workspace.');
    }
    for (const p of projects) {
      log.info(
        `Detected ${p.kind === 'expo' ? 'Expo' : 'bare React Native'} project ` +
          `${p.name ?? '(unnamed)'} at ${p.root}`,
      );
    }
    this.changeEmitter.fire(projects);
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
