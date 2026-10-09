import * as vscode from 'vscode';
import type { RNLensApi } from '../../../src/extension';
import type { PreviewSnapshot } from '../../../src/preview/PreviewPanelManager';
import { activateApi, fixtureUri, testing, waitForSnapshot } from './helpers';

const has =
  (...parts: string[]) =>
  (s: PreviewSnapshot): boolean =>
    !s.overlay.visible && parts.every((p) => s.text.includes(p));

describe('Phase 4 — Storybook CSF stories as variants', function () {
  this.timeout(120_000);
  let api: RNLensApi;

  before(async () => {
    api = await activateApi();
  });

  after(async () => {
    await testing(api).closePreview();
  });

  it('renders stories with meta args, render functions, decorators and CSF2 functions', async () => {
    const file = fixtureUri('components', 'Greeting.tsx');
    await vscode.commands.executeCommand('rnLens.previewComponent', file, 'Greeting');
    await waitForSnapshot(api, has('Hi world (ocean)'), 30_000);
    // Stories render inside the story's decorators and the project's .rnlens/decorators.
    await testing(api).selectVariant('Basic');
    await waitForSnapshot(api, has('Story frame', 'Hi Storybook (ocean)'));
    await testing(api).selectVariant('Linus');
    await waitForSnapshot(api, has('Story frame', 'Hi Linus (ocean)'));
    await testing(api).selectVariant('Pair');
    await waitForSnapshot(api, has('Hi Storybook (ocean)', 'Hi Margaret (ocean)'));
    await testing(api).selectVariant('Legacy');
    await waitForSnapshot(api, has('Story frame', 'Hi CSF2 (ocean)'));
  });
});
