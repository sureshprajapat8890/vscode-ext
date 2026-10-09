import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import { detectComponents } from '../codelens/componentDetection';

const PREVIEW_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

export interface VariantInfo {
  name: string;
  /** `file`: from `<Name>.preview.*`; `props`: from the component's `export const previews`. */
  kind: 'file' | 'props';
}

/** `Button.tsx` → the colocated `Button.preview.(tsx|ts|jsx|js)`, if one exists. */
export function findVariantFile(componentFile: string): string | undefined {
  const dir = path.dirname(componentFile);
  const base = path.basename(componentFile, path.extname(componentFile));
  if (base.endsWith('.preview')) return undefined;
  return PREVIEW_EXTENSIONS.map((ext) => path.join(dir, `${base}.preview${ext}`)).find((f) =>
    existsSync(f),
  );
}

export function isVariantFile(file: string): boolean {
  return /\.preview\.(?:tsx|ts|jsx|js)$/.test(file);
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Variant names (named component exports) of a `.preview` file, in source order. */
export async function listVariants(variantFile: string): Promise<string[]> {
  const source = await readText(variantFile);
  if (source === undefined) return [];
  return detectComponents(source)
    .map((c) => c.exportName)
    .filter((name) => name !== 'default');
}

function keyName(p: t.ObjectProperty): string | undefined {
  if (p.key.type === 'Identifier' && !p.computed) return p.key.name;
  if (p.key.type === 'StringLiteral') return p.key.value;
  return undefined;
}

function objectEntries(node: t.Node | null | undefined): [string, t.Node][] {
  if (node?.type !== 'ObjectExpression') return [];
  const entries: [string, t.Node][] = [];
  for (const p of node.properties) {
    if (p.type !== 'ObjectProperty') continue;
    const key = keyName(p);
    if (key !== undefined) entries.push([key, p.value]);
  }
  return entries;
}

function unwrap(node: t.Node | null | undefined): t.Node | null | undefined {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ParenthesizedExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Variant names from `export const previews = { Name: props }` in a component file. The object
 * applies to the default export (or, without one, to the file's first exported component). When
 * it's keyed by export name — `{ Button: { Primary: props } }` — the entry for `exportName` is used.
 */
export function listInlineVariants(source: string, exportName: string): string[] {
  let program: t.Program;
  try {
    program = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    }).program;
  } catch {
    return [];
  }
  let previews: t.Node | null | undefined;
  for (const statement of program.body) {
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.declaration?.type !== 'VariableDeclaration'
    )
      continue;
    for (const d of statement.declaration.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === 'previews') previews = unwrap(d.init);
    }
  }
  const entries = objectEntries(previews);
  if (entries.length === 0) return [];

  const components = detectComponents(source).map((c) => c.exportName);
  const keyedByExport = entries.every(
    ([key, value]) => components.includes(key) && unwrap(value)?.type === 'ObjectExpression',
  );
  if (keyedByExport) {
    const own = entries.find(([key]) => key === exportName);
    return own ? objectEntries(unwrap(own[1])).map(([key]) => key) : [];
  }
  const primary = components.includes('default') ? 'default' : components[0];
  return exportName === primary ? entries.map(([key]) => key) : [];
}

/**
 * All variants for a component: named exports of its `.preview` file first, then keys of its own
 * `previews` object (a name already provided by the `.preview` file wins).
 */
export async function listAllVariants(
  componentFile: string,
  exportName: string,
): Promise<{ variantFile: string | undefined; variants: VariantInfo[] }> {
  const variantFile = findVariantFile(componentFile);
  const fromFile = variantFile ? await listVariants(variantFile) : [];
  const source = await readText(componentFile);
  const inline = source === undefined ? [] : listInlineVariants(source, exportName);
  const variants: VariantInfo[] = fromFile.map((name) => ({ name, kind: 'file' }));
  for (const name of inline) {
    if (!fromFile.includes(name)) variants.push({ name, kind: 'props' });
  }
  return { variantFile, variants };
}
