import { writeFileSync } from 'node:fs';
import os from 'node:os';
import * as vscode from 'vscode';
import type { PreviewSnapshot } from '../../src/preview/PreviewPanelManager';
import {
  activateApi,
  fixtureUri,
  replaceAndSave,
  testing,
  waitForSnapshot,
} from '../integration/suite/helpers';
import type { BenchResults } from './report';

const WARM_EDITS = 20;
const MB = 1024 * 1024;

const shows =
  (text: string) =>
  (s: PreviewSnapshot): boolean =>
    !s.overlay.visible && s.text.includes(text);

/** Runs inside the VS Code extension host (as an extension test suite) and writes the results. */
export async function run(): Promise<void> {
  const out = process.env.RNLENS_BENCH_OUT;
  if (!out) throw new Error('RNLENS_BENCH_OUT is not set; run the benchmark with "npm run bench".');
  const api = await activateApi();
  const t = testing(api);
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  let peakHeap = process.memoryUsage().heapUsed;
  const sample = (): void => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  };

  // Cold: nothing cached on disk or in memory, and esbuild not loaded yet.
  await vscode.commands.executeCommand('rnLens.clearCache');
  let started = Date.now();
  await vscode.commands.executeCommand('rnLens.previewApp');
  await waitForSnapshot(api, shows('Home screen'), 60_000);
  const coldApp = {
    renderedMs: Date.now() - started,
    buildMs: t.buildTimes()[0],
    modules: t.moduleCount() ?? 0,
  };
  sample();

  // Warm: edit a screen of the running app.
  const screen = fixtureUri('screens', 'HomeScreen.tsx');
  const original = (await vscode.workspace.openTextDocument(screen)).getText();
  const before = t.buildTimes().length;
  const renderedMs: number[] = [];
  try {
    for (let i = 1; i <= WARM_EDITS; i++) {
      started = Date.now();
      await replaceAndSave(screen, original.replace('>Home screen<', `>Home screen ${i}<`));
      await waitForSnapshot(api, shows(`Home screen ${i}`));
      renderedMs.push(Date.now() - started);
      sample();
    }
  } finally {
    await replaceAndSave(screen, original);
  }
  const warm = { buildMs: t.buildTimes().slice(before, before + WARM_EDITS), renderedMs };
  await t.closePreview();

  // Cold, a single component (contexts and on-disk caches cleared again).
  await vscode.commands.executeCommand('rnLens.clearCache');
  started = Date.now();
  await vscode.commands.executeCommand('rnLens.openPreview', fixtureUri('components', 'Hello.tsx'));
  await waitForSnapshot(api, shows('Hello'), 60_000);
  const coldComponent = {
    renderedMs: Date.now() - started,
    buildMs: t.buildTimes()[0],
    modules: t.moduleCount() ?? 0,
  };
  sample();
  await t.closePreview();

  const cpu = os.cpus()[0]?.model.trim() ?? 'unknown CPU';
  const results: BenchResults = {
    environment: `VS Code ${vscode.version}, ${os.platform()} ${os.arch()}, ${cpu}`,
    activationMs: t.activationMs(),
    coldApp,
    coldComponent,
    warm,
    memory: {
      baselineRssMb: Math.round(baselineRss / MB),
      peakRssMb: Math.round(peakRss / MB),
      peakHeapMb: Math.round(peakHeap / MB),
    },
    notes: [
      'Activation: from loading dist/extension.js to the end of activate(); esbuild loads lazily on the first build.',
      'Cold: after "RN Lens: Clear Cache", from the command to the rendered preview. Warm: from save to the rendered change.',
      'Memory: extension host RSS growth from before the first preview to the peak while previewing. esbuild runs in its own process and is not included.',
    ],
  };
  writeFileSync(out, JSON.stringify(results, null, 2));
}
