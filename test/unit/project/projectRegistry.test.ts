import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { Uri, mockState } from '../vscodeMock';
import { ProjectRegistry } from '../../../src/project/projectRegistry';

/** The mock Uri stands in for vscode.Uri at runtime (vitest aliases `vscode` to the mock). */
const fileUri = (p: string): vscode.Uri => Uri.file(p) as unknown as vscode.Uri;

const root = path.resolve('/ws');
const app = path.join(root, 'app');
const expoPkg = JSON.stringify({ name: 'app', dependencies: { expo: '~57.0.0' } });

describe('ProjectRegistry', () => {
  let registry: ProjectRegistry;

  beforeEach(() => {
    mockState.reset();
    vi.useFakeTimers();
    registry = new ProjectRegistry();
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  it('finds RN projects, sets the context key and logs them', async () => {
    mockState.files.set(path.join(app, 'package.json'), expoPkg);
    mockState.foundFiles = [Uri.file(path.join(app, 'package.json'))];
    const changed = vi.fn();
    registry.onDidChange(changed);

    await registry.refresh();

    expect(registry.getProjects().map((p) => p.root)).toEqual([app]);
    expect(mockState.contextKeys.get('rnLens.isRNProject')).toBe(true);
    expect(mockState.findFilesCalls[0]).toEqual({
      include: '**/package.json',
      exclude: '**/node_modules/**',
      max: 200,
    });
    expect(mockState.logLines.some((l) => l.includes('Detected Expo project app'))).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('clears the context key and logs when no project exists', async () => {
    mockState.foundFiles = [Uri.file(path.join(root, 'package.json'))];
    await registry.refresh();
    expect(registry.getProjects()).toEqual([]);
    expect(mockState.contextKeys.get('rnLens.isRNProject')).toBe(false);
    expect(mockState.logLines.some((l) => l.includes('No React Native'))).toBe(true);
  });

  it('ignores non-file URIs', async () => {
    mockState.files.set(path.join(app, 'package.json'), expoPkg);
    mockState.foundFiles = [
      Uri.from({ scheme: 'vscode-vfs', path: path.join(app, 'package.json') }),
    ];
    await registry.refresh();
    expect(registry.getProjects()).toEqual([]);
  });

  it('shares one scan between concurrent refresh calls', async () => {
    await Promise.all([registry.refresh(), registry.refresh()]);
    expect(mockState.findFilesCalls).toHaveLength(1);
    await registry.refresh();
    expect(mockState.findFilesCalls).toHaveLength(2);
  });

  it('debounces rescans on package.json changes and ignores node_modules', async () => {
    const [watcher] = mockState.watchers;
    expect(watcher.pattern).toBe('**/package.json');

    watcher.change.fire(Uri.file(path.join(app, 'node_modules', 'x', 'package.json')));
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockState.findFilesCalls).toHaveLength(0);

    watcher.create.fire(Uri.file(path.join(app, 'package.json')));
    watcher.change.fire(Uri.file(path.join(app, 'package.json')));
    watcher.delete.fire(Uri.file(path.join(app, 'package.json')));
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockState.findFilesCalls).toHaveLength(1);
  });

  it('rescans when workspace folders change', async () => {
    mockState.workspaceFoldersChanged.fire({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockState.findFilesCalls).toHaveLength(1);
  });

  it('projectFor finds the project within the file’s workspace folder', async () => {
    mockState.workspaceFolders = [{ uri: Uri.file(root) }];
    mockState.files.set(path.join(app, 'package.json'), expoPkg);
    const project = await registry.projectFor(fileUri(path.join(app, 'src', 'Button.tsx')));
    expect(project?.root).toBe(app);
    expect(await registry.projectFor(fileUri(path.join(root, 'other', 'x.tsx')))).toBeUndefined();
  });

  it('projectFor searches up to the filesystem root for files outside the workspace', async () => {
    mockState.files.set(path.join(app, 'package.json'), expoPkg);
    expect((await registry.projectFor(fileUri(path.join(app, 'A.tsx'))))?.root).toBe(app);
  });

  it('projectFor ignores non-file URIs', async () => {
    const untitled = Uri.from({ scheme: 'untitled', path: 'Untitled-1' }) as unknown as vscode.Uri;
    expect(await registry.projectFor(untitled)).toBeUndefined();
  });

  it('disposes the watcher and cancels a pending rescan', async () => {
    mockState.workspaceFoldersChanged.fire({});
    registry.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockState.findFilesCalls).toHaveLength(0);
    expect(mockState.watchers[0].disposed).toBe(true);
  });
});
