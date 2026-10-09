import * as vscode from 'vscode';

export type PreviewStatus =
  | { kind: 'hidden' }
  | { kind: 'building' }
  | { kind: 'ok'; buildMs: number }
  | { kind: 'buildError' }
  | { kind: 'runtimeError' };

/** `RN Lens: ✓ 142 ms` / `RN Lens: ✗ build error` while a preview is open. */
export class PreviewStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'rnLens.status',
    vscode.StatusBarAlignment.Right,
    100,
  );

  constructor() {
    this.item.name = 'RN Lens';
    this.item.command = 'rnLens.showOutput';
  }

  set(status: PreviewStatus): void {
    const item = this.item;
    item.backgroundColor = undefined;
    switch (status.kind) {
      case 'hidden':
        item.hide();
        return;
      case 'building':
        item.text = '$(sync~spin) RN Lens';
        item.tooltip = 'RN Lens: building preview…';
        break;
      case 'ok':
        item.text = `$(device-mobile) RN Lens: ✓ ${status.buildMs} ms`;
        item.tooltip = `RN Lens: preview built in ${status.buildMs} ms. Click to show the RN Lens output.`;
        break;
      case 'buildError':
        item.text = '$(error) RN Lens: ✗ build error';
        item.tooltip = 'RN Lens: the preview failed to build. Click to show details.';
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      case 'runtimeError':
        item.text = '$(error) RN Lens: ✗ runtime error';
        item.tooltip = 'RN Lens: the preview threw an error. Click to show details.';
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
    item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
