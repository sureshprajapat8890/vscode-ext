import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import {
  activateApi,
  fixtureUri,
  replaceAndSave,
  testing,
  waitFor,
  waitForSnapshot,
} from './helpers';

const PANELS = 20;

describe('Phase 4 — multiple panels', function () {
  this.timeout(180_000);
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

  it('shows a target in two panels that share contexts and both hot-update', async () => {
    await vscode.commands.executeCommand('rnLens.openPreview', file);
    await waitForSnapshot(api, (s) => s.text.includes('Label A: 0'), 30_000);
    testing(api).press('Increment');
    await waitForSnapshot(api, (s) => s.text.includes('Label A: 1'));

    await vscode.commands.executeCommand('rnLens.openPreviewToSide', file);
    assert.equal(testing(api).panelCount(), 2);
    assert.equal(testing(api).contextCount(), 1, 'panels with the same target share contexts');
    await waitForSnapshot(api, (s) => s.text.includes('Label A: 0'));

    // Each panel keeps its own state through the hot update.
    await replaceAndSave(file, original.replace('Label A', 'Label B'));
    await waitFor(
      async () => {
        const texts = (await testing(api).snapshotAll()).map((s) => s?.text ?? '');
        return texts.some((t) => t.includes('Label B: 1')) &&
          texts.some((t) => t.includes('Label B: 0'))
          ? texts
          : undefined;
      },
      () => 'both panels did not hot-update with their own state',
    );
    await testing(api).closePreview();
    assert.equal(testing(api).panelCount(), 0);
    assert.equal(testing(api).contextCount(), 0);
  });

  it(`opening and closing ${PANELS} panels doesn't grow esbuild contexts`, async () => {
    const hello = fixtureUri('components', 'Hello.tsx');
    for (let i = 0; i < PANELS; i++) {
      await vscode.commands.executeCommand('rnLens.openPreviewToSide', hello);
    }
    assert.equal(testing(api).panelCount(), PANELS);
    assert.equal(testing(api).contextCount(), 1);
    await testing(api).closePreview();
    assert.equal(testing(api).contextCount(), 0);

    // One at a time, alternating targets: contexts never outlive their panels.
    const counter = fixtureUri('components', 'Counter.tsx');
    for (let i = 0; i < PANELS; i++) {
      await vscode.commands.executeCommand('rnLens.openPreviewToSide', i % 2 ? hello : counter);
      assert.equal(testing(api).contextCount(), 1);
      await testing(api).closePreview();
      assert.equal(testing(api).contextCount(), 0);
    }
  });
});
