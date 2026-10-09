import * as assert from 'node:assert/strict';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';

const EXTENSION_ID = 'rn-lens.rn-lens';

describe('activation', () => {
  let api: RNLensApi;

  before(async () => {
    const ext = vscode.extensions.getExtension<RNLensApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} is installed`);
    api = await ext.activate();
    await api.ready;
  });

  it('detects the Expo fixture as an RN project', () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'a workspace folder is open');
    const projects = api.getProjects();
    assert.equal(projects.length, 1);
    assert.equal(path.normalize(projects[0].root), path.normalize(folder.uri.fsPath));
    assert.equal(projects[0].kind, 'expo');
  });

  it('contributes every README command', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    const commands = (ext?.packageJSON as { contributes: { commands: { command: string }[] } })
      .contributes.commands;
    const contributed = commands.map((c) => c.command);
    for (const id of [
      'rnLens.openPreview',
      'rnLens.openPreviewToSide',
      'rnLens.previewApp',
      'rnLens.reload',
      'rnLens.toggleLock',
      'rnLens.clearCache',
    ]) {
      assert.ok(contributed.includes(id), `${id} is contributed`);
    }
  });
});
