import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { detectComponents } from '../codelens/componentDetection';

const PREVIEW_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

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

/** Variant names (named component exports) of a `.preview` file, in source order. */
export async function listVariants(variantFile: string): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(variantFile, 'utf8');
  } catch {
    return [];
  }
  return detectComponents(source)
    .map((c) => c.exportName)
    .filter((name) => name !== 'default');
}
