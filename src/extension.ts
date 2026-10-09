import type * as vscode from 'vscode';
import { ProjectRegistry } from './project/projectRegistry';
import type { RNProject } from './project/detectProject';
import { disposeLog, getLog } from './util/log';

/** Public API returned from `activate`, used by integration tests. */
export interface RNLensApi {
  getProjects(): readonly RNProject[];
  /** Resolves once the initial workspace scan has finished. */
  ready: Promise<void>;
}

export function activate(context: vscode.ExtensionContext): RNLensApi {
  const log = getLog();
  log.info(`RN Lens ${String(context.extension.packageJSON.version)} activating`);

  const projects = new ProjectRegistry();
  context.subscriptions.push(projects);

  const ready = projects.refresh().catch((err: unknown) => {
    log.error('Project detection failed', err);
  });

  return {
    getProjects: () => projects.getProjects(),
    ready,
  };
}

export function deactivate(): void {
  disposeLog();
}
