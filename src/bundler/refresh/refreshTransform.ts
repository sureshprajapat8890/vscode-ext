import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import {
  Analyzer,
  detectComponents,
  isFunctionNode,
  isNode,
  PASCAL_CASE,
  unwrapExpression,
  wrapperName,
  type Binding,
  type FunctionNode,
} from '../../codelens/componentDetection';

/** Local name given to anonymous default exports so they can be registered. */
export const DEFAULT_EXPORT_NAME = '__RNLens$default';

export interface RefreshComponent {
  /** Top-level binding holding the component. */
  local: string;
  /** Stable family ID: `<module id>#<local name>`. */
  id: string;
  /** Hook-call signature; when it changes, React remounts the component instead of keeping state. */
  signature: string;
}

export interface RefreshAnalysis {
  /** Source with anonymous default exports given a name (positions on other lines unchanged). */
  source: string;
  components: RefreshComponent[];
  /**
   * The module exports only components, so an edit can be applied by Fast Refresh alone. Edits to
   * other modules make their importers re-run (and may need a full reload).
   */
  isBoundary: boolean;
}

const HOOK_NAME = /^use[A-Z0-9]/;
/** Hooks whose arguments are part of the signature (changing them resets state). */
const HOOKS_WITH_ARGS = new Set(['useState', 'useReducer', 'useRef']);

/** The function implementing a component binding (looking through memo/forwardRef and TS wrappers). */
function componentFunction(node: Binding): FunctionNode | undefined {
  if (node.type === 'FunctionDeclaration') return node;
  if (node.type === 'ClassDeclaration') return undefined;
  const expr = unwrapExpression(node);
  if (isFunctionNode(expr)) return expr;
  if (expr.type === 'CallExpression') {
    const [arg] = expr.arguments;
    if (arg && arg.type !== 'SpreadElement' && arg.type !== 'ArgumentPlaceholder') {
      return componentFunction(arg);
    }
  }
  return undefined;
}

/** Hook calls made directly by `fn` (not by nested functions), as signature text. */
function hookSignature(fn: FunctionNode, source: string): string {
  const parts: string[] = [];
  const visit = (node: t.Node, isRoot: boolean): void => {
    if (!isRoot && isFunctionNode(node)) return;
    if (node.type === 'CallExpression') {
      const name = wrapperName(node.callee);
      if (name && HOOK_NAME.test(name)) {
        const args = HOOKS_WITH_ARGS.has(name)
          ? `(${node.arguments.map((a) => source.slice(a.start ?? 0, a.end ?? 0)).join(', ')})`
          : '';
        parts.push(`${name}${args}`);
      }
    }
    for (const key of Object.keys(node) as (keyof typeof node)[]) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const value: unknown = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (isNode(child)) visit(child, false);
      }
    }
  };
  visit(fn.body, false);
  return parts.join('\n');
}

/** Names of every value the module exports (`default` included); undefined for `export *`. */
function exportedValueNames(program: t.Program): string[] | undefined {
  const names: string[] = [];
  for (const statement of program.body) {
    if (statement.type === 'ExportAllDeclaration') return undefined;
    if (statement.type === 'ExportDefaultDeclaration') {
      names.push('default');
    } else if (statement.type === 'ExportNamedDeclaration' && statement.exportKind !== 'type') {
      if (statement.source) return undefined;
      const decl = statement.declaration;
      if (decl?.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id.type === 'Identifier') names.push(d.id.name);
          else return undefined; // destructured exports: treat as non-component
        }
      } else if (
        (decl?.type === 'FunctionDeclaration' || decl?.type === 'ClassDeclaration') &&
        decl.id
      ) {
        names.push(decl.id.name);
      } else if (decl && decl.type.startsWith('TS')) {
        // type/interface/enum declarations: enums are values, but rare in RN components
        if (decl.type === 'TSEnumDeclaration') names.push(decl.id.name);
      }
      for (const spec of statement.specifiers) {
        if (spec.type !== 'ExportSpecifier' || spec.exportKind === 'type') continue;
        names.push(spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value);
      }
    }
  }
  return names;
}

/**
 * Finds the components React Fast Refresh should track in a module, names anonymous default
 * exports so they can be registered, and decides whether the module is a refresh boundary.
 */
export function analyzeForRefresh(source: string, moduleId: string): RefreshAnalysis {
  let program: t.Program;
  try {
    program = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }).program;
  } catch {
    return { source, components: [], isBoundary: false };
  }

  const analyzer = new Analyzer(program);
  const components: RefreshComponent[] = [];
  const add = (local: string, node: Binding): void => {
    const fn = componentFunction(node);
    if (!fn) return;
    components.push({ local, id: `${moduleId}#${local}`, signature: hookSignature(fn, source) });
  };

  let rewritten = source;
  const edits: { start: number; end: number; text: string }[] = [];

  for (const statement of program.body) {
    const decl = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (statement.type === 'ExportDefaultDeclaration') {
      const d = statement.declaration;
      if (d.type === 'TSDeclareFunction') continue;
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) {
        if (PASCAL_CASE.test(d.id.name) && analyzer.isComponent(d)) add(d.id.name, d);
      } else if (d.type === 'FunctionDeclaration' && analyzer.isComponent(d)) {
        // `export default function (…) {}` → `export default function __RNLens$default(…) {}`
        const keyword = source.indexOf('function', d.start ?? 0);
        const at = keyword + 'function'.length;
        edits.push({ start: at, end: at, text: ` ${DEFAULT_EXPORT_NAME}` });
        add(DEFAULT_EXPORT_NAME, d);
      } else if (
        d.type !== 'ClassDeclaration' &&
        d.type !== 'Identifier' &&
        analyzer.isComponent(d as Binding)
      ) {
        // `export default () => …` → `const __RNLens$default = () => …; export default __RNLens$default;`
        edits.push({
          start: statement.start ?? 0,
          end: d.start ?? 0,
          text: `const ${DEFAULT_EXPORT_NAME} = `,
        });
        edits.push({
          start: statement.end ?? 0,
          end: statement.end ?? 0,
          text: `;export default ${DEFAULT_EXPORT_NAME};`,
        });
        add(DEFAULT_EXPORT_NAME, d as Binding);
      }
      continue;
    }
    if (!decl) continue;
    if (decl.type === 'FunctionDeclaration' && decl.id && PASCAL_CASE.test(decl.id.name)) {
      if (analyzer.isComponent(decl)) add(decl.id.name, decl);
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (
          d.id.type === 'Identifier' &&
          d.init &&
          PASCAL_CASE.test(d.id.name) &&
          analyzer.isComponent(d.init)
        ) {
          add(d.id.name, d.init);
        }
      }
    }
  }

  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  }

  const exported = exportedValueNames(program);
  const componentExports = new Set(detectComponents(source).map((c) => c.exportName));
  const isBoundary =
    exported !== undefined && exported.length > 0 && exported.every((n) => componentExports.has(n));

  return { source: rewritten, components, isBoundary };
}

const SOURCE_MAP_COMMENT = /\n\/\/# sourceMappingURL=[^\n]*\s*$/;

/** A top-level require as esbuild's CommonJS transform emits it for an import or re-export. */
const TOP_LEVEL_REQUIRE =
  /^(?:var \w+ = (?:__toESM\()?|__reExport\(\w+, )?require\(("(?:[^"\\]|\\.)*")\)/gm;

/**
 * The modules a CommonJS module (as esbuild's transform emits it) requires at its top level, in
 * order: `var import_x = require("x")`, `__toESM(require("x"))`, `__reExport(…, require("x"))` and
 * bare `require("x");`. Requires nested in functions are left out (they may be lazy on purpose).
 */
export function topLevelRequires(cjsCode: string): string[] {
  const specifiers: string[] = [];
  for (const match of cjsCode.matchAll(TOP_LEVEL_REQUIRE)) {
    const specifier = JSON.parse(match[1]) as string;
    if (!specifiers.includes(specifier)) specifiers.push(specifier);
  }
  return specifiers;
}

/**
 * Wraps a module already transformed to CommonJS for hot updates: on line 1 (so source map lines
 * stay aligned), reuse the cached exports when the update plan says this module doesn't need to
 * re-run; at the end, register its components with React Refresh and cache its exports.
 *
 * A reused module still requires its imports. Bundled modules only run when an importer requires
 * them, so otherwise a changed module imported only by unchanged ones (a screen imported by the
 * navigator) would never re-run. Unchanged imports just return their cached exports.
 */
export function wrapForHotReload(
  cjsCode: string,
  moduleId: string,
  components: readonly RefreshComponent[],
): string {
  const id = JSON.stringify(moduleId);
  const mapComment = SOURCE_MAP_COMMENT.exec(cjsCode)?.[0] ?? '';
  const body = mapComment ? cjsCode.slice(0, -mapComment.length) : cjsCode;
  const requires = topLevelRequires(body)
    .map((specifier) => `require(${JSON.stringify(specifier)}); `)
    .join('');
  const guard = `var __rnlensHot = globalThis.__RNLENS_HOT__; if (__rnlensHot && __rnlensHot.reuse(module, ${id})) { ${requires}return; } `;
  const registrations = components
    .map(
      (c) =>
        `  __rnlensRefresh.register(${c.local}, ${JSON.stringify(c.id)}); __rnlensRefresh.sign(${c.local}, ${JSON.stringify(c.signature)});`,
    )
    .join('\n');
  return (
    [
      guard + body,
      ';(function () {',
      '  var __rnlensRefresh = globalThis.__RNLENS_REFRESH__;',
      '  if (!__rnlensRefresh) return;',
      registrations,
      '})();',
      `if (__rnlensHot) __rnlensHot.store(module, ${id});`,
    ].join('\n') + mapComment
  );
}
