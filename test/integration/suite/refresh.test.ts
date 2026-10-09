import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import type { PreviewSnapshot } from '../../../src/preview/PreviewPanelManager';
import { activateApi, fixtureUri, replaceAndSave, testing, waitForSnapshot } from './helpers';

const has =
  (...parts: string[]) =>
  (s: PreviewSnapshot): boolean =>
    !s.overlay.visible && parts.every((p) => s.text.includes(p));

describe('Phase 4 — React Fast Refresh', function () {
  this.timeout(120_000);
  let api: RNLensApi;
  const file = fixtureUri('components', 'StatefulCounter.tsx');
  let original: string;

  before(async () => {
    api = await activateApi();
    original = (await vscode.workspace.fs.readFile(file)).toString();
  });

  after(async () => {
    await replaceAndSave(file, original);
    await testing(api).closePreview();
  });

  it('keeps useState values when a component is edited and saved', async () => {
    await vscode.window.showTextDocument(file);
    await vscode.commands.executeCommand('rnLens.openPreview');
    await waitForSnapshot(api, has('Label A: 0'), 30_000);
    testing(api).press('Increment');
    await waitForSnapshot(api, has('Label A: 1'));
    testing(api).press('Increment');
    await waitForSnapshot(api, has('Label A: 2'));

    await replaceAndSave(file, original.replace('Label A', 'Label B'));
    const after = await waitForSnapshot(api, has('Label B: 2'));
    assert.ok(!after.text.includes('Label A'), after.text);

    // A change to the hooks resets state, as in React Native's Fast Refresh.
    await replaceAndSave(
      file,
      original.replace('Label A', 'Label C').replace('useState(0)', 'useState(10)'),
    );
    await waitForSnapshot(api, has('Label C: 10'));
  });

  it('hot-updates a screen of the app in place, keeping the navigation state', async () => {
    const screen = fixtureUri('screens', 'FeedScreen.tsx');
    const source = (await vscode.workspace.fs.readFile(screen)).toString();
    try {
      await vscode.commands.executeCommand('rnLens.previewApp');
      await waitForSnapshot(api, has('Home screen'), 30_000);
      testing(api).press('Feed');
      await waitForSnapshot(api, has('Feed screen'));
      // The screen is imported only by the (unchanged) navigator module.
      await replaceAndSave(screen, source.replace('>Feed screen<', '>Feed screen (edited)<'));
      // A full reload would go back to the Home tab, where the Feed screen isn't rendered yet.
      await waitForSnapshot(api, has('Feed screen (edited)', 'First post'));
      assert.equal(testing(api).currentTarget()?.kind, 'app');
    } finally {
      await replaceAndSave(screen, source);
    }
  });
});
