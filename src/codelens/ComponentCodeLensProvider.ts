import * as vscode from 'vscode';
import type { ProjectRegistry } from '../project/projectRegistry';
import { detectComponents, type DetectedComponent } from './componentDetection';

const PARSE_DEBOUNCE_MS = 300;

export const COMPONENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', language: 'javascript' },
  { scheme: 'file', language: 'javascriptreact' },
  { scheme: 'file', language: 'typescript' },
  { scheme: 'file', language: 'typescriptreact' },
];

interface CacheEntry {
  version: number;
  components: DetectedComponent[];
}

function delay(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(true);
    }, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve(false);
    });
  });
}

/** "▶ Preview" above each exported component in files that belong to an RN project. */
export class ComponentCodeLensProvider implements vscode.CodeLensProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly projects: ProjectRegistry) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const components = await this.componentsOf(document, token);
    if (!components || components.length === 0 || token.isCancellationRequested) return [];
    if (!(await this.projects.projectFor(document.uri))) return [];

    return components.map((c) => {
      const range = new vscode.Range(c.line, c.column, c.line, c.column);
      const name = c.exportName === 'default' ? (c.localName ?? 'default export') : c.exportName;
      return new vscode.CodeLens(range, {
        title: '▶ Preview',
        tooltip: `Preview ${name} with RN Lens`,
        command: 'rnLens.previewComponent',
        arguments: [document.uri, c.exportName],
      });
    });
  }

  /** Parses at most once per document version; edits in progress are debounced. */
  private async componentsOf(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<DetectedComponent[] | undefined> {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached?.version === document.version) return cached.components;
    if (document.isDirty && !(await delay(PARSE_DEBOUNCE_MS, token))) return undefined;
    if (token.isCancellationRequested) return undefined;

    const components = detectComponents(document.getText());
    this.cache.set(key, { version: document.version, components });
    return components;
  }

  /** Drops cached parses for closed documents. */
  forget(document: vscode.TextDocument): void {
    this.cache.delete(document.uri.toString());
  }
}
