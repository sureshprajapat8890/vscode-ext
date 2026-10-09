import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import type * as t from '@babel/types';

const BABEL_CONFIG_FILES = [
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.mjs',
  'babel.config.json',
  '.babelrc',
  '.babelrc.js',
  '.babelrc.json',
];
const RESOLVER_NAMES = new Set(['module-resolver', 'babel-plugin-module-resolver']);

export interface BabelAliases {
  /** Alias prefix → absolute path or package specifier. Regex aliases (`^…`) are skipped. */
  aliases: Record<string, string>;
  /** Absolute `root` directories bare imports also resolve from. */
  roots: string[];
  /** The config file the aliases came from. */
  source: string | undefined;
}

const isNode = (v: unknown): v is t.Node =>
  !!v && typeof v === 'object' && typeof (v as t.Node).type === 'string';

function walk(node: t.Node, visit: (n: t.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node) as (keyof typeof node)[]) {
    if (key === 'loc') continue;
    const value: unknown = node[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (isNode(child)) walk(child, visit);
    }
  }
}

function stringValue(node: t.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function propertyKey(p: t.ObjectProperty): string | undefined {
  if (p.key.type === 'Identifier' && !p.computed) return p.key.name;
  return stringValue(p.key);
}

function objectProps(node: t.Node | undefined): Map<string, t.Node> {
  const props = new Map<string, t.Node>();
  if (node?.type !== 'ObjectExpression') return props;
  for (const p of node.properties) {
    if (p.type !== 'ObjectProperty') continue;
    const key = propertyKey(p);
    if (key !== undefined) props.set(key, p.value);
  }
  return props;
}

/** Finds `['module-resolver', { root, alias }]` options objects anywhere in a parsed config. */
function resolverOptions(program: t.Node): t.Node[] {
  const found: t.Node[] = [];
  walk(program, (n) => {
    if (n.type !== 'ArrayExpression') return;
    const [name, options] = n.elements;
    const plugin = name ? stringValue(name as t.Node) : undefined;
    if (plugin && RESOLVER_NAMES.has(plugin) && options?.type === 'ObjectExpression')
      found.push(options);
  });
  return found;
}

function parseConfig(file: string, text: string): t.Node | undefined {
  try {
    if (file.endsWith('.json') || path.basename(file) === '.babelrc') {
      // JSON configs: parse as an expression so the same walker applies.
      return parse(`(${text})`, { sourceType: 'script' }).program;
    }
    return parse(text, { sourceType: 'unambiguous', plugins: ['typescript'], errorRecovery: true })
      .program;
  } catch {
    return undefined;
  }
}

/**
 * Reads `babel-plugin-module-resolver` aliases and roots from the project's Babel config by
 * static analysis: only string literals are understood, and the config is never executed.
 */
export function readBabelAliases(projectRoot: string): BabelAliases {
  for (const name of BABEL_CONFIG_FILES) {
    const file = path.join(projectRoot, name);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const program = parseConfig(file, text);
    if (!program) return { aliases: {}, roots: [], source: file };

    const aliases: Record<string, string> = {};
    const roots: string[] = [];
    for (const options of resolverOptions(program)) {
      const props = objectProps(options);
      const cwd = path.dirname(file);
      const root = props.get('root');
      const rootValues =
        root?.type === 'ArrayExpression'
          ? root.elements.map((e) => stringValue(e as t.Node))
          : [stringValue(root)];
      for (const r of rootValues) if (r) roots.push(path.resolve(cwd, r));
      for (const [key, value] of objectProps(props.get('alias'))) {
        const target = stringValue(value);
        if (!target || key.startsWith('^')) continue;
        aliases[key] = target.startsWith('.') ? path.resolve(cwd, target) : target;
      }
    }
    return { aliases, roots, source: file };
  }
  return { aliases: {}, roots: [], source: undefined };
}
