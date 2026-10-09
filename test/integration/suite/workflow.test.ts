import * as assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import type { PreviewSnapshot } from '../../../src/preview/PreviewPanelManager';
import {
  activateApi,
  fixtureUri,
  replaceAndSave,
  testing,
  waitFor,
  waitForSnapshot,
} from './helpers';

const has =
  (...parts: string[]) =>
  (s: PreviewSnapshot): boolean =>
    !s.overlay.visible && parts.every((p) => s.text.includes(p));

async function pressAndWait(api: RNLensApi, text: string, ...expected: string[]): Promise<void> {
  testing(api).press(text);
  await waitForSnapshot(api, has(...expected));
}

describe('Phase 3 — app preview, platform, typing, lock, mocks', function () {
  this.timeout(120_000);
  let api: RNLensApi;

  before(async () => {
    api = await activateApi();
  });

  after(async () => {
    await testing(api).closePreview();
  });

  it('previews the React Navigation app and navigates all five screens', async () => {
    await vscode.commands.executeCommand('rnLens.previewApp');
    await waitForSnapshot(api, has('Home screen', 'Badge: default'), 30_000);

    await pressAndWait(api, 'Feed', 'Feed screen', 'First post');
    await pressAndWait(api, 'Profile', 'Profile screen');
    await pressAndWait(api, 'Home', 'Home screen');
    await pressAndWait(api, 'Open settings', 'Settings screen');
    // expo-font's useFonts loads a .ttf served from the RN Lens asset cache.
    await waitForSnapshot(api, has('Fonts: loaded'));

    await vscode.commands.executeCommand('rnLens.reload');
    await waitForSnapshot(api, has('Home screen'));
    await pressAndWait(api, 'Open details', 'Details screen for item 42');
  });

  it('renders .android.tsx variants after switching the toolbar platform to Android', async () => {
    await vscode.commands.executeCommand('rnLens.previewApp');
    await waitForSnapshot(api, has('Badge: default'));
    await testing(api).setPlatform('android');
    await waitForSnapshot(api, has('Badge: Android'));
    await testing(api).setPlatform('ios');
    await waitForSnapshot(api, has('Badge: default'));
  });

  it('previews an expo-router app through its generated route context', async () => {
    const routerRoot = path.resolve(fixtureUri().fsPath, '..', 'router-app');
    await vscode.commands.executeCommand(
      'rnLens.previewApp',
      vscode.Uri.file(path.join(routerRoot, 'app', '_layout.tsx')),
    );
    await waitForSnapshot(api, has('Tab One'), 30_000);
  });

  it('updates while typing in onType mode, using unsaved contents', async () => {
    const config = vscode.workspace.getConfiguration('rnLens');
    const file = fixtureUri('components', 'Counter.tsx');
    const doc = await vscode.workspace.openTextDocument(file);
    const original = doc.getText();
    await config.update('updateMode', 'onType', vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('rnLens.previewComponent', file, 'default');
      await waitForSnapshot(api, has('Edit 0'));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        file,
        new vscode.Range(doc.positionAt(0), doc.positionAt(original.length)),
        original.replace('Edit 0', 'Edit typed'),
      );
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(doc.isDirty, 'the edit is not saved');
      await waitForSnapshot(api, has('Edit typed'));
    } finally {
      await replaceAndSave(file, original);
      await config.update('updateMode', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('follows the active editor unless the preview is locked', async () => {
    // As in real use, the preview sits beside an editor (here, the component's own file).
    await testing(api).closePreview();
    await vscode.window.showTextDocument(fixtureUri('components', 'Hello.tsx'), {
      viewColumn: vscode.ViewColumn.One,
    });
    await vscode.commands.executeCommand(
      'rnLens.previewComponent',
      fixtureUri('components', 'Hello.tsx'),
      'default',
    );
    await waitForSnapshot(api, (s) => s.text.trim() === 'Hello');

    const inEditorColumn = { viewColumn: vscode.ViewColumn.One };
    await vscode.window.showTextDocument(fixtureUri('components', 'Greeting.tsx'), inEditorColumn);
    await waitForSnapshot(api, has('Hi world (ocean)'));

    await vscode.commands.executeCommand('rnLens.toggleLock');
    assert.equal(testing(api).isLocked(), true);
    try {
      await vscode.window.showTextDocument(
        fixtureUri('components', 'reference', 'PressableDemo.tsx'),
        inEditorColumn,
      );
      await new Promise((r) => setTimeout(r, 800));
      const s = await waitForSnapshot(api, () => true);
      assert.ok(s.text.includes('Hi world'), `locked preview changed to: ${s.text}`);
    } finally {
      await vscode.commands.executeCommand('rnLens.toggleLock');
    }
    assert.equal(testing(api).isLocked(), false);
  });

  it('auto-mocks a missing package and offers "Create mock for …"', async () => {
    const file = fixtureUri('components', 'MapDemo.tsx');
    const mockFile = path.join(fixtureUri().fsPath, '.rnlens', 'mocks', 'react-native-maps.tsx');
    rmSync(mockFile, { force: true });
    try {
      await vscode.commands.executeCommand('rnLens.previewComponent', file, 'default');
      await waitForSnapshot(api, has('Map demo'));

      const diagnostic = await waitFor(
        () => vscode.languages.getDiagnostics(file).find((d) => d.source === 'RN Lens'),
        () =>
          `no RN Lens diagnostic on MapDemo.tsx: ${JSON.stringify(vscode.languages.getDiagnostics(file))}`,
      );
      assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning);
      assert.equal(diagnostic.range.start.line, 2);
      assert.match(diagnostic.message, /^"react-native-maps" can't run in the RN Lens preview/);

      await vscode.workspace.openTextDocument(file);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        file,
        diagnostic.range,
      );
      const create = actions.find((a) => a.title === 'Create mock for react-native-maps');
      assert.ok(create?.command, `actions: ${actions.map((a) => a.title).join(', ')}`);
      await vscode.commands.executeCommand(
        create.command.command,
        ...(create.command.arguments ?? []),
      );

      assert.ok(existsSync(mockFile), 'the mock file was created');
      const created = await vscode.workspace.openTextDocument(mockFile);
      assert.match(created.getText(), /export function Marker\(/);
      assert.match(created.getText(), /export default function MapView\(/);
      // The project mock replaces the auto-mock, so the warning goes away.
      await waitFor(
        () =>
          vscode.languages.getDiagnostics(file).some((d) => d.source === 'RN Lens')
            ? undefined
            : true,
        () => 'the auto-mock warning was not cleared',
      );
      await waitForSnapshot(api, has('Map demo'));
    } finally {
      rmSync(mockFile, { force: true });
    }
  });
});
