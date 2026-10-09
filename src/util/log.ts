import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

/** The shared "RN Lens" output channel. Created lazily on first use. */
export function getLog(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel('RN Lens', { log: true });
  return channel;
}

export function disposeLog(): void {
  channel?.dispose();
  channel = undefined;
}
