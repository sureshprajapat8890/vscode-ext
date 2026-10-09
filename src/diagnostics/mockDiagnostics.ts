import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import type { MockedPackage } from '../bundler/types';
import { isWithin } from '../project/detectProject';

export const AUTO_MOCK_CODE = 'rnlens.autoMock';
const SPECIFIER_IN_MESSAGE = /^"([^"]+)"/;

const inNodeModules = (file: string): boolean => file.split(/[\\/]/).includes('node_modules');

/** The package named by an RN Lens auto-mock diagnostic. */
export function specifierOf(diagnostic: vscode.Diagnostic): string | undefined {
  const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
  if (code !== AUTO_MOCK_CODE) return undefined;
  return SPECIFIER_IN_MESSAGE.exec(diagnostic.message)?.[1];
}

/** Range of the quoted specifier in `text`, or undefined if it isn't imported literally. */
export function findSpecifierRange(text: string, specifier: string): vscode.Range | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const quote of ["'", '"']) {
      const col = lines[i].indexOf(`${quote}${specifier}${quote}`);
      if (col >= 0) return new vscode.Range(i, col, i, col + specifier.length + 2);
    }
  }
  return undefined;
}

/**
 * Warnings on import statements of packages RN Lens auto-mocked (no web implementation, or not
 * installed), each with a "Create mock for …" quick fix.
 */
export class MockDiagnostics implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  private readonly collection = vscode.languages.createDiagnosticCollection('rnLens');
  /** Files with diagnostics, per project, so a rebuild can clear stale ones. */
  private readonly filesByProject = new Map<string, Set<string>>();

  async update(projectRoot: string, mocked: readonly MockedPackage[]): Promise<void> {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const mock of mocked) {
      if (mock.source !== 'auto' || mock.specifier.startsWith('node:')) continue;
      for (const importer of mock.importers ?? []) {
        if (!isWithin(projectRoot, importer, path) || inNodeModules(importer)) continue;
        let text: string;
        try {
          text = await readFile(importer, 'utf8');
        } catch {
          continue;
        }
        const range = findSpecifierRange(text, mock.specifier);
        if (!range) continue;
        const reason = mock.note ? ` (${mock.note})` : '';
        const diagnostic = new vscode.Diagnostic(
          range,
          `"${mock.specifier}" can't run in the RN Lens preview${reason}, so it was replaced with a no-op mock. Create a mock to control what it returns.`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'RN Lens';
        diagnostic.code = AUTO_MOCK_CODE;
        byFile.set(importer, [...(byFile.get(importer) ?? []), diagnostic]);
      }
    }
    for (const stale of this.filesByProject.get(projectRoot) ?? []) {
      if (!byFile.has(stale)) this.collection.delete(vscode.Uri.file(stale));
    }
    for (const [file, diagnostics] of byFile)
      this.collection.set(vscode.Uri.file(file), diagnostics);
    this.filesByProject.set(projectRoot, new Set(byFile.keys()));
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    return context.diagnostics.flatMap((diagnostic) => {
      const specifier = specifierOf(diagnostic);
      if (!specifier) return [];
      const action = new vscode.CodeAction(
        `Create mock for ${specifier}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      action.command = {
        command: 'rnLens.createMock',
        title: `Create mock for ${specifier}`,
        arguments: [document.uri, specifier],
      };
      return [action];
    });
  }

  dispose(): void {
    this.collection.dispose();
  }
}
