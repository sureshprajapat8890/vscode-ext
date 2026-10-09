import { parse } from '@babel/parser';
import type * as t from '@babel/types';

export interface DetectedComponent {
  /** Name to import: an identifier, or `"default"` for the default export. */
  exportName: string;
  /** Local binding name when known (e.g. the function name behind a default export). */
  localName: string | undefined;
  /** 0-based line and column of the export statement. */
  line: number;
  column: number;
}

const PASCAL_CASE = /^[A-Z][A-Za-z0-9_]*$/;
const WRAPPERS = new Set(['memo', 'forwardRef']);
const CLASS_BASES = new Set(['Component', 'PureComponent']);

type FunctionNode = t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
type Binding = t.Expression | t.FunctionDeclaration | t.ClassDeclaration;

function isFunctionNode(node: t.Node): node is FunctionNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

/** Strips TypeScript-only wrappers (`x as T`, `x satisfies T`, `x!`) and parentheses. */
function unwrapExpression(node: t.Expression): t.Expression {
  let current = node;
  for (;;) {
    switch (current.type) {
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'ParenthesizedExpression':
        current = current.expression;
        break;
      default:
        return current;
    }
  }
}

/** True when `node` (or anything inside it) is a JSX element or fragment. */
function containsJSX(node: t.Node | null | undefined): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    return true;
  }
  for (const key of Object.keys(node) as (keyof typeof node)[]) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') {
      continue;
    }
    const value: unknown = node[key];
    if (Array.isArray(value)) {
      if (value.some((v) => isNode(v) && containsJSX(v))) {
        return true;
      }
    } else if (isNode(value) && containsJSX(value)) {
      return true;
    }
  }
  return false;
}

function isNode(value: unknown): value is t.Node {
  return !!value && typeof value === 'object' && typeof (value as t.Node).type === 'string';
}

/** Collects `return` statements of a function body, not descending into nested functions or classes. */
function collectReturns(node: t.Node, out: t.ReturnStatement[]): void {
  if (node.type === 'ReturnStatement') {
    out.push(node);
    return;
  }
  for (const key of Object.keys(node) as (keyof typeof node)[]) {
    if (key === 'loc') continue;
    const value: unknown = node[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (isNode(child) && !isFunctionNode(child) && !child.type.startsWith('Class')) {
        collectReturns(child, out);
      }
    }
  }
}

function bodyReturnsJSX(body: t.BlockStatement | t.Expression): boolean {
  if (body.type !== 'BlockStatement') {
    return containsJSX(body);
  }
  const returns: t.ReturnStatement[] = [];
  collectReturns(body, returns);
  return returns.some((r) => containsJSX(r.argument));
}

function functionReturnsJSX(fn: FunctionNode): boolean {
  return bodyReturnsJSX(fn.body);
}

function wrapperName(callee: t.Node): string | undefined {
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    return callee.property.name;
  }
  return undefined;
}

function isClassComponent(node: t.ClassDeclaration | t.ClassExpression): boolean {
  const base = node.superClass;
  if (!base || (base.type !== 'Identifier' && base.type !== 'MemberExpression')) {
    return false;
  }
  const name = wrapperName(base);
  if (!name || !CLASS_BASES.has(name)) {
    return false;
  }
  return node.body.body.some(
    (member) =>
      member.type === 'ClassMethod' &&
      member.key.type === 'Identifier' &&
      member.key.name === 'render' &&
      bodyReturnsJSX(member.body),
  );
}

class Analyzer {
  private readonly bindings = new Map<string, Binding>();
  private readonly visiting = new Set<string>();

  constructor(program: t.Program) {
    for (const statement of program.body) {
      const decl =
        statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
          ? statement.declaration
          : statement;
      if (!decl) continue;
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
        this.bindings.set(decl.id.name, decl);
      } else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id.type === 'Identifier' && d.init) {
            this.bindings.set(d.id.name, d.init);
          }
        }
      }
    }
  }

  isComponent(node: Binding): boolean {
    if (node.type === 'FunctionDeclaration') {
      return functionReturnsJSX(node);
    }
    if (node.type === 'ClassDeclaration') {
      return isClassComponent(node);
    }
    const expr = unwrapExpression(node);
    switch (expr.type) {
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return functionReturnsJSX(expr);
      case 'ClassExpression':
        return isClassComponent(expr);
      case 'CallExpression': {
        const name = wrapperName(expr.callee);
        const [arg] = expr.arguments;
        return (
          !!name &&
          WRAPPERS.has(name) &&
          !!arg &&
          arg.type !== 'SpreadElement' &&
          arg.type !== 'ArgumentPlaceholder' &&
          this.isComponent(arg)
        );
      }
      case 'Identifier':
        return this.isComponentBinding(expr.name);
      default:
        return false;
    }
  }

  isComponentBinding(name: string): boolean {
    const binding = this.bindings.get(name);
    if (!binding || this.visiting.has(name)) {
      return false;
    }
    this.visiting.add(name);
    try {
      return this.isComponent(binding);
    } finally {
      this.visiting.delete(name);
    }
  }
}

function localNameOf(node: t.Node): string | undefined {
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
    return node.id.name;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  return undefined;
}

/**
 * Finds exported React components in a JS/TS source file, in source order.
 * A component is exported (named or default), has a PascalCase name (default exports may be
 * anonymous), and is a function returning JSX, a class with a JSX-returning `render`, or a
 * `memo`/`forwardRef` call wrapping one. Returns `[]` for files that cannot be parsed.
 */
export function detectComponents(source: string): DetectedComponent[] {
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

  const analyzer = new Analyzer(program);
  const found: DetectedComponent[] = [];
  const seen = new Set<string>();
  const add = (exportName: string, localName: string | undefined, at: t.Node): void => {
    if (seen.has(exportName)) return;
    seen.add(exportName);
    found.push({
      exportName,
      localName,
      line: (at.loc?.start.line ?? 1) - 1,
      column: at.loc?.start.column ?? 0,
    });
  };

  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const decl = statement.declaration;
      if (decl.type === 'TSDeclareFunction') continue;
      if (analyzer.isComponent(decl as Binding)) {
        add('default', localNameOf(decl), statement);
      }
      continue;
    }
    if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') {
      continue;
    }
    const decl = statement.declaration;
    if (decl) {
      if (
        (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') &&
        decl.id &&
        PASCAL_CASE.test(decl.id.name) &&
        analyzer.isComponent(decl)
      ) {
        add(decl.id.name, decl.id.name, statement);
      } else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (
            d.id.type === 'Identifier' &&
            d.init &&
            PASCAL_CASE.test(d.id.name) &&
            analyzer.isComponent(d.init)
          ) {
            add(d.id.name, d.id.name, statement);
          }
        }
      }
      continue;
    }
    if (statement.source) continue; // re-exports from other files are previewed from their own file
    for (const spec of statement.specifiers) {
      if (spec.type !== 'ExportSpecifier' || spec.exportKind === 'type') continue;
      const exported =
        spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value;
      const isDefault = exported === 'default';
      if (
        (isDefault || PASCAL_CASE.test(exported)) &&
        analyzer.isComponentBinding(spec.local.name)
      ) {
        add(exported, spec.local.name, statement);
      }
    }
  }
  return found;
}

/** The component RN Lens previews for a file: the default export, else the first exported component. */
export function pickDefaultComponent(
  components: readonly DetectedComponent[],
): DetectedComponent | undefined {
  return components.find((c) => c.exportName === 'default') ?? components[0];
}
