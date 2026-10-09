import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import type { PreviewSnapshot } from '../../../src/preview/PreviewPanelManager';

export const EXTENSION_ID = 'rn-lens.rn-lens';

export async function activateApi(): Promise<RNLensApi> {
  const ext = vscode.extensions.getExtension<RNLensApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} is installed`);
  const api = await ext.activate();
  await api.ready;
  return api;
}

export function testing(api: RNLensApi): NonNullable<RNLensApi['testing']> {
  assert.ok(api.testing, 'testing API is available in test mode');
  return api.testing;
}

export function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'a workspace folder is open');
  return vscode.Uri.joinPath(folder.uri, ...segments);
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  describe: () => string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  return assert.fail(`timed out: ${describe()}`);
}

export async function waitForSnapshot(
  api: RNLensApi,
  predicate: (s: PreviewSnapshot) => boolean,
  timeoutMs = 20_000,
): Promise<PreviewSnapshot> {
  let last: PreviewSnapshot | undefined;
  return waitFor(
    async () => {
      last = await testing(api).snapshot();
      return last && predicate(last) ? last : undefined;
    },
    () => `preview did not reach the expected state; last snapshot: ${JSON.stringify(last)}`,
    timeoutMs,
  );
}

/** Replaces a document's whole text and saves it. */
export async function replaceAndSave(uri: vscode.Uri, text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    text,
  );
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(await doc.save());
}

export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
