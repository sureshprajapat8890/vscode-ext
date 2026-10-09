import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import { detectComponents } from '../codelens/componentDetection';

const PREVIEW_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

export interface VariantInfo {
  name: string;
  /**
   * `file`: from `<Name>.preview.*`; `props`: from the component's `export const previews`;
   * `story`: from the Storybook CSF file `<Name>.stories.*`.
   */
  kind: 'file' | 'props' | 'story';
}

function findColocated(componentFile: string, suffix: string): string | undefined {
  const dir = path.dirname(componentFile);
  const base = path.basename(componentFile, path.extname(componentFile));
  if (base.endsWith('.preview') || base.endsWith('.stories')) return undefined;
  return PREVIEW_EXTENSIONS.map((ext) => path.join(dir, `${base}${suffix}${ext}`)).find((f) =>
    existsSync(f),
  );
}

/** `Button.tsx` → the colocated `Button.preview.(tsx|ts|jsx|js)`, if one exists. */
export function findVariantFile(componentFile: string): string | undefined {
  return findColocated(componentFile, '.preview');
}

/** `Button.tsx` → the colocated Storybook file `Button.stories.(tsx|ts|jsx|js)`, if one exists. */
export function findStoriesFile(componentFile: string): string | undefined {
  return findColocated(componentFile, '.stories');
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

function stringList(node: t.Node | null | undefined): string[] | undefined {
  const value = unwrap(node);
  if (value?.type === 'StringLiteral') return [value.value];
  if (value?.type !== 'ArrayExpression') return undefined;
  const items = value.elements.map((e) => (e?.type === 'StringLiteral' ? e.value : undefined));
  return items.every((i) => i !== undefined) ? (items as string[]) : undefined;
}

/**
 * Story names of a Storybook CSF file, in source order: its named exports, minus `__`-prefixed
 * ones and those excluded by the default export's `includeStories` / `excludeStories` (string
 * lists; regular expressions aren't evaluated).
 */
export function listStories(source: string): string[] {
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
  const names: string[] = [];
  const locals = new Map<string, t.Node | null | undefined>();
  let meta: t.Node | null | undefined;
  for (const statement of program.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const d of statement.declarations) {
        if (d.id.type === 'Identifier') locals.set(d.id.name, d.init);
      }
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration;
      meta = declaration.type === 'Identifier' ? locals.get(declaration.name) : declaration;
    }
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const declaration = statement.declaration;
    if (declaration?.type === 'VariableDeclaration') {
      for (const d of declaration.declarations) {
        if (d.id.type === 'Identifier') names.push(d.id.name);
      }
    } else if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      names.push(declaration.id.name);
    } else if (!declaration && !statement.source) {
      for (const s of statement.specifiers) {
        if (s.type !== 'ExportSpecifier') continue;
        const exported = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value;
        if (exported !== 'default') names.push(exported);
      }
    }
  }
  const metaEntries = new Map(objectEntries(unwrap(meta)));
  const include = stringList(metaEntries.get('includeStories'));
  const exclude = stringList(metaEntries.get('excludeStories')) ?? [];
  return names.filter(
    (n) => !n.startsWith('__') && !exclude.includes(n) && (!include || include.includes(n)),
  );
}

/**
 * All variants for a component: named exports of its `.preview` file first, then keys of its own
 * `previews` object, then stories of its Storybook file (an earlier source wins a name clash).
 */
export async function listAllVariants(
  componentFile: string,
  exportName: string,
): Promise<{
  variantFile: string | undefined;
  storiesFile: string | undefined;
  variants: VariantInfo[];
}> {
  const variantFile = findVariantFile(componentFile);
  const fromFile = variantFile ? await listVariants(variantFile) : [];
  const source = await readText(componentFile);
  const inline = source === undefined ? [] : listInlineVariants(source, exportName);
  const storiesFile = findStoriesFile(componentFile);
  const storiesSource = storiesFile ? await readText(storiesFile) : undefined;
  const stories = storiesSource === undefined ? [] : listStories(storiesSource);
  const variants: VariantInfo[] = [];
  const add = (name: string, kind: VariantInfo['kind']): void => {
    if (!variants.some((v) => v.name === name)) variants.push({ name, kind });
  };
  for (const name of fromFile) add(name, 'file');
  for (const name of inline) add(name, 'props');
  for (const name of stories) add(name, 'story');
  return { variantFile, storiesFile, variants };
}
