import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import type { PreviewSnapshot } from '../../../src/preview/PreviewPanelManager';
import {
  activateApi,
  fixtureUri,
  percentile,
  replaceAndSave,
  testing,
  waitFor,
  waitForSnapshot,
} from './helpers';

/** PRD §3 goal 1 / §7: warm rebuild under 300 ms (p90). */
const WARM_BUDGET_MS = Number(process.env.RNLENS_WARM_BUDGET_MS ?? 300);

async function preview(file: vscode.Uri, exportName = 'default'): Promise<void> {
  await vscode.commands.executeCommand('rnLens.previewComponent', file, exportName);
}

const has =
  (...parts: string[]) =>
  (s: PreviewSnapshot): boolean =>
    !s.overlay.visible && parts.every((p) => s.text.includes(p));

describe('Phase 2 — reference components', function () {
  this.timeout(120_000);
  let api: RNLensApi;

  before(async () => {
    api = await activateApi();
  });

  after(async () => {
    await testing(api).closePreview();
  });

  const cases: [string, string[]][] = [
    ['FlatListDemo', ['Apples', 'Bananas', 'Cherries']],
    ['TextInputDemo', ['Hello, Ada']],
    ['ImageDemo', ['Loaded: large,small', 'Size: 1024x1024']],
    ['PressableDemo', ['Pressed 0 times']],
    ['ScrollViewDemo', ['Row 1', 'Row 30']],
    ['AnimatedDemo', ['Fading in', 'Animation finished']],
    ['SafeAreaDemo', ['Content starts at 59']],
    ['IconDemo', ['Home']],
    ['StorageDemo', ['Storage: stored hello']],
    ['PlatformDemo', ['Platform: iOS', 'Window: 393x852', 'Scheme: light']],
  ];

  for (const [name, expected] of cases) {
    it(`renders ${name}`, async () => {
      await preview(fixtureUri('components', 'reference', `${name}.tsx`));
      await waitForSnapshot(api, has(...expected));
    });
  }

  it('reflects device, rotation and color scheme changes without rebuilding', async () => {
    await preview(fixtureUri('components', 'reference', 'PlatformDemo.tsx'));
    await waitForSnapshot(api, has('Window: 393x852'));
    const builds = testing(api).buildTimes().length;
    testing(api).setEnv({ deviceId: 'pixel-8', landscape: true, scheme: 'dark' });
    const s = await waitForSnapshot(api, has('Window: 915x412', 'Scheme: dark'));
    assert.deepEqual(s.env, { deviceId: 'pixel-8', width: 915, height: 412, scheme: 'dark' });
    assert.equal(testing(api).buildTimes().length, builds);
    testing(api).setEnv({ deviceId: 'iphone-15', landscape: false, scheme: 'light' });
    await waitForSnapshot(api, has('Window: 393x852', 'Scheme: light'));
  });

  it('rebuilds for Android when rnLens.simulatedPlatform changes', async () => {
    await preview(fixtureUri('components', 'reference', 'PlatformDemo.tsx'));
    await waitForSnapshot(api, has('Platform: iOS'));
    const config = vscode.workspace.getConfiguration('rnLens');
    try {
      await config.update('simulatedPlatform', 'android', vscode.ConfigurationTarget.Global);
      await waitForSnapshot(api, has('Platform: Android'));
    } finally {
      await config.update('simulatedPlatform', undefined, vscode.ConfigurationTarget.Global);
    }
    await waitForSnapshot(api, has('Platform: iOS'));
  });

  it('wraps previews in .rnlens/decorators and switches .preview variants', async () => {
    await preview(fixtureUri('components', 'Greeting.tsx'), 'Greeting');
    await waitForSnapshot(api, has('Hi world (ocean)'));
    await testing(api).selectVariant('Formal');
    await waitForSnapshot(api, has('Hi Dr. Lovelace (ocean)'));
    await testing(api).selectVariant('Casual');
    await waitForSnapshot(api, has('Hi Ada (ocean)'));
    await testing(api).selectVariant(null);
    await waitForSnapshot(api, has('Hi world (ocean)'));
  });

  it('shows a thrown error in the overlay at the right file:line, and opens it on click', async () => {
    const file = fixtureUri('components', 'ThrowDemo.tsx');
    await preview(file);
    const s = await waitForSnapshot(
      api,
      (snap) =>
        snap.overlay.visible && snap.overlay.frames.some((f) => f.file?.endsWith('ThrowDemo.tsx')),
    );
    assert.equal(s.overlay.title, 'Runtime error');
    assert.match(s.overlay.message, /Kaboom from ThrowDemo/);
    const linked = s.overlay.frames.filter((f) => f.file && f.line !== undefined);
    const index = linked.findIndex((f) => f.file?.endsWith('ThrowDemo.tsx'));
    assert.equal(linked[index].line, 4);

    testing(api).clickOverlayFrame(index);
    // The editor becomes active before its selection change reaches the extension host,
    // so wait for both.
    await waitFor(
      () => {
        const e = vscode.window.activeTextEditor;
        return e?.document.uri.fsPath.endsWith('ThrowDemo.tsx') && e.selection.active.line === 3
          ? e
          : undefined;
      },
      () => {
        const e = vscode.window.activeTextEditor;
        return `expected ThrowDemo.tsx at line 4; active: ${e?.document.uri.fsPath}:${(e?.selection.active.line ?? -1) + 1} (clicked frame ${index} of ${JSON.stringify(linked)})`;
      },
    );
  });

  it(`rebuilds warm in < ${WARM_BUDGET_MS} ms (p90 over 20 edits)`, async () => {
    const file = fixtureUri('components', 'Counter.tsx');
    const original = (await vscode.workspace.openTextDocument(file)).getText();
    await preview(file);
    await waitForSnapshot(api, has('Edit 0'));
    const before = testing(api).buildTimes().length;
    const endToEnd: number[] = [];
    try {
      for (let i = 1; i <= 20; i++) {
        const started = Date.now();
        await replaceAndSave(file, original.replace('Edit 0', `Edit ${i}`));
        await waitForSnapshot(api, has(`Edit ${i}`));
        endToEnd.push(Date.now() - started);
      }
    } finally {
      await replaceAndSave(file, original);
    }
    const builds = testing(api)
      .buildTimes()
      .slice(before, before + 20);
    assert.equal(builds.length, 20);
    const p90Build = percentile(builds, 90);
    console.log(
      `      warm rebuild p90: build ${p90Build} ms, save→rendered ${percentile(endToEnd, 90)} ms`,
    );
    assert.ok(p90Build < WARM_BUDGET_MS, `warm build p90 was ${p90Build} ms: ${builds.join(', ')}`);
  });

  it('offers a ▶ Preview CodeLens for each exported component', async () => {
    const uri = fixtureUri('components', 'Greeting.tsx');
    await vscode.workspace.openTextDocument(uri);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
      10,
    );
    const previewLenses = lenses.filter((l) => l.command?.command === 'rnLens.previewComponent');
    assert.equal(previewLenses.length, 1);
    assert.equal(previewLenses[0].command?.title, '▶ Preview');
    assert.equal(previewLenses[0].command?.arguments?.[1], 'Greeting');
  });
});
