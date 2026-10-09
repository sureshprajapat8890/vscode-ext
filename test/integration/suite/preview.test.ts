import * as assert from 'node:assert/strict';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import type { PreviewSnapshot } from '../../../src/preview/PreviewPanelManager';

const EXTENSION_ID = 'rn-lens.rn-lens';
/** PRD §3 goal 1: cold preview in under 3 s. CI machines can opt into a looser budget. */
const COLD_BUDGET_MS = Number(process.env.RNLENS_COLD_BUDGET_MS ?? 3000);

async function waitForSnapshot(
  api: RNLensApi,
  predicate: (s: PreviewSnapshot) => boolean,
  timeoutMs = 20_000,
): Promise<PreviewSnapshot> {
  const testing = api.testing;
  assert.ok(testing, 'testing API is available in test mode');
  const deadline = Date.now() + timeoutMs;
  let last: PreviewSnapshot | undefined;
  while (Date.now() < deadline) {
    last = await testing.snapshot();
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`preview did not reach the expected state; last snapshot: ${JSON.stringify(last)}`);
}

describe('preview', function () {
  this.timeout(60_000);
  let api: RNLensApi;
  let helloUri: vscode.Uri;

  before(async () => {
    const ext = vscode.extensions.getExtension<RNLensApi>(EXTENSION_ID);
    assert.ok(ext);
    api = await ext.activate();
    await api.ready;
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    helloUri = vscode.Uri.file(path.join(folder.uri.fsPath, 'components', 'Hello.tsx'));
  });

  after(async () => {
    await api.testing?.closePreview();
  });

  it(`renders a Hello component cold in < ${COLD_BUDGET_MS} ms`, async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(helloUri));
    const started = Date.now();
    await vscode.commands.executeCommand('rnLens.openPreview');
    const snapshot = await waitForSnapshot(api, (s) => s.text.includes('Hello'));
    const elapsed = Date.now() - started;
    assert.equal(snapshot.text.trim(), 'Hello');
    assert.ok(elapsed < COLD_BUDGET_MS, `cold preview took ${elapsed} ms`);
  });

  it('rebuilds and re-renders when the file is saved', async () => {
    const doc = await vscode.workspace.openTextDocument(helloUri);
    const original = doc.getText();
    const replace = async (text: string): Promise<void> => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        helloUri,
        new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
        text,
      );
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(await doc.save());
    };
    try {
      await replace(original.replace('>Hello<', '>Hello again<'));
      await waitForSnapshot(api, (s) => s.text.includes('Hello again'));
    } finally {
      await replace(original);
    }
    await waitForSnapshot(api, (s) => s.text.trim() === 'Hello');
  });

  it('reloads on command', async () => {
    const before = await waitForSnapshot(api, (s) => s.renderedId !== undefined);
    await vscode.commands.executeCommand('rnLens.reload');
    await waitForSnapshot(
      api,
      (s) => (s.renderedId ?? 0) > (before.renderedId ?? 0) && s.text.trim() === 'Hello',
    );
  });

  it('disposes the esbuild context when the panel closes', async () => {
    const testing = api.testing;
    assert.ok(testing);
    assert.equal(testing.contextCount(), 1);
    await testing.closePreview();
    assert.equal(testing.contextCount(), 0);
    assert.equal(await testing.snapshot(), undefined);
  });
});
