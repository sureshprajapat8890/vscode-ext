import path from 'node:path';
import { parse } from '@babel/parser';

export interface ImportUsage {
  /** Local name of the default import, if any (e.g. `MapView`). */
  defaultName: string | undefined;
  /** Named imports, by their exported name. */
  named: string[];
}

/** How `specifier` is imported across `sources` (ES imports only; unparseable files are skipped). */
export function collectImportUsage(sources: readonly string[], specifier: string): ImportUsage {
  const usage: ImportUsage = { defaultName: undefined, named: [] };
  for (const source of sources) {
    let program;
    try {
      program = parse(source, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      }).program;
    } catch {
      continue;
    }
    for (const statement of program.body) {
      if (statement.type !== 'ImportDeclaration' || statement.source.value !== specifier) continue;
      if (statement.importKind === 'type') continue;
      for (const spec of statement.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') {
          usage.defaultName ??= spec.local.name;
        } else if (spec.type === 'ImportSpecifier' && spec.importKind !== 'type') {
          const name =
            spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
          if (name === 'default') usage.defaultName ??= spec.local.name;
          else if (!usage.named.includes(name)) usage.named.push(name);
        }
      }
    }
  }
  usage.named.sort();
  return usage;
}

const isComponentName = (name: string): boolean =>
  /^[A-Z][a-z0-9]/.test(name) || /^[A-Z]$/.test(name);
const isConstantName = (name: string): boolean => /^[A-Z][A-Z0-9_]+$/.test(name);

/** Path of the project mock for `specifier` (`.rnlens/mocks/@scope/pkg.tsx`). */
export function mockFilePath(projectRoot: string, specifier: string, tsx: boolean): string {
  return (
    path.join(projectRoot, '.rnlens', 'mocks', ...specifier.split('/')) + (tsx ? '.tsx' : '.ts')
  );
}

/**
 * A typed stub mocking `specifier` for the imports actually used: PascalCase names become
 * components rendering a View (with their children), UPPER_CASE names constants, everything else
 * no-op functions. Returns the source and whether it needs JSX (.tsx).
 */
export function generateMockStub(
  specifier: string,
  usage: ImportUsage,
): { source: string; tsx: boolean } {
  const components = usage.named.filter((n) => isComponentName(n) && !isConstantName(n));
  const constants = usage.named.filter(isConstantName);
  const functions = usage.named.filter((n) => !components.includes(n) && !constants.includes(n));
  const defaultIsComponent = usage.defaultName !== undefined && isComponentName(usage.defaultName);
  const tsx = components.length > 0 || defaultIsComponent;

  const lines = [
    '/**',
    ` * RN Lens mock for "${specifier}". Previews use this file instead of the real package, which`,
    " * needs native code that can't run on web. Edit the stubs to return whatever your previews need.",
    ' */',
  ];
  if (tsx) {
    lines.push(
      `import type { ReactNode } from 'react';`,
      `import { View } from 'react-native';`,
      '',
      'interface MockProps {',
      '  children?: ReactNode;',
      '  style?: unknown;',
      '  [prop: string]: unknown;',
      '}',
    );
  }
  const component = (name: string, exported: string): string[] => [
    '',
    `${exported} function ${name}({ children, style }: MockProps) {`,
    '  return <View style={style}>{children}</View>;',
    '}',
  ];
  for (const name of components) lines.push(...component(name, 'export'));
  for (const name of functions) {
    lines.push(
      '',
      `export function ${name}(..._args: unknown[]): undefined {`,
      '  return undefined;',
      '}',
    );
  }
  for (const name of constants)
    lines.push('', `export const ${name}: unknown = ${JSON.stringify(name.toLowerCase())};`);

  if (usage.defaultName !== undefined) {
    if (defaultIsComponent) {
      lines.push(...component(usage.defaultName, 'export default'));
    } else {
      lines.push(
        '',
        `const ${usage.defaultName} = {};`,
        '',
        `export default ${usage.defaultName};`,
      );
    }
  } else if (usage.named.length === 0) {
    lines.push('', 'export default {};');
  }
  lines.push('');
  return { source: lines.join('\n'), tsx };
}
