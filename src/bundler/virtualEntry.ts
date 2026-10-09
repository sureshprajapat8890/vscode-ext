import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import type { PreviewTarget } from './types';

export const ENTRY_SPECIFIER = 'rnlens:entry';
const NAMESPACE = 'rnlens-entry';
export const APP_KEY = 'RNLensPreview';

const DECORATOR_FILES = ['decorators.tsx', 'decorators.ts', 'decorators.jsx', 'decorators.js'];

/** `.rnlens/decorators.*` in the project, if present. */
export function findDecorators(projectRoot: string): string | undefined {
  return DECORATOR_FILES.map((f) => path.join(projectRoot, '.rnlens', f)).find((f) =>
    existsSync(f),
  );
}

/**
 * Source of the in-memory entry module for a preview target. It imports the RN Lens runtime first
 * (so its patches apply before user code runs), picks the component or variant, wraps it in the
 * project's decorators and an error boundary, and mounts it into `globalThis.__RNLENS_ROOT__`.
 */
export function generateEntry(target: PreviewTarget, decoratorsFile?: string): string {
  const file = JSON.stringify(target.file);
  const lines = [
    `import { ErrorBoundary } from 'rnlens:runtime';`,
    `import { createElement } from 'react';`,
    `import { AppRegistry } from 'react-native';`,
    `import * as Target from ${file};`,
  ];
  if (target.variant) {
    lines.push(`import * as Variants from ${JSON.stringify(target.variant.file)};`);
  }
  if (decoratorsFile) {
    lines.push(`import Decorators from ${JSON.stringify(decoratorsFile)};`);
  }

  const missing = (where: string, name: string, hint: string): string =>
    `throw new Error('RN Lens: ' + ${where} + ' has no export named ' + ${JSON.stringify(JSON.stringify(name))} + '. ${hint}');`;

  lines.push(`const Component = Target[${JSON.stringify(target.exportName)}];`);
  lines.push(
    `if (Component == null) { ${missing(file, target.exportName, 'Export the component, or preview a different export.')} }`,
  );
  if (target.variant) {
    const variantFile = JSON.stringify(target.variant.file);
    lines.push(`const Shown = Variants[${JSON.stringify(target.variant.name)}];`);
    lines.push(
      `if (Shown == null) { ${missing(variantFile, target.variant.name, 'Pick another variant in the preview toolbar.')} }`,
    );
  } else {
    lines.push(`const Shown = Component;`);
  }

  if (decoratorsFile) {
    lines.push(
      `if (typeof Decorators !== 'function' && (typeof Decorators !== 'object' || Decorators === null)) {`,
      `  throw new Error('RN Lens: ' + ${JSON.stringify(decoratorsFile)} + ' must default-export a component that renders its children.');`,
      `}`,
      `const Decorate = Decorators;`,
    );
  } else {
    lines.push(`const Decorate = ({ children }) => children;`);
  }

  lines.push(
    `function RNLensPreviewRoot() {`,
    `  return createElement(ErrorBoundary, null, createElement(Decorate, null, createElement(Shown)));`,
    `}`,
    `AppRegistry.registerComponent(${JSON.stringify(APP_KEY)}, () => RNLensPreviewRoot);`,
    `const root = AppRegistry.runApplication(${JSON.stringify(APP_KEY)}, { rootTag: globalThis.__RNLENS_ROOT__ });`,
    `globalThis.__RNLENS_UNMOUNT__ = () => root.unmount();`,
    '',
  );
  return lines.join('\n');
}

/**
 * Serves `rnlens:entry` (regenerated on every build, so variant switches and newly added decorators
 * take effect without a new context) and `rnlens:runtime[/<module>]` from the runtime directory.
 */
export function virtualEntryPlugin(
  getTarget: () => PreviewTarget,
  projectRoot: string,
  runtimeDir: string,
): Plugin {
  return {
    name: 'rnlens-virtual-entry',
    setup(build) {
      build.onResolve({ filter: /^rnlens:entry$/ }, () => ({
        path: 'entry',
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: generateEntry(getTarget(), findDecorators(projectRoot)),
        loader: 'js',
        resolveDir: projectRoot,
      }));
      build.onResolve({ filter: /^rnlens:runtime(\/[A-Za-z]+)?$/ }, async (args) => {
        const sub = args.path.slice('rnlens:runtime'.length) || '/index';
        const result = await build.resolve(`.${sub}`, { kind: args.kind, resolveDir: runtimeDir });
        return result.errors.length > 0 ? { errors: result.errors } : { path: result.path };
      });
    },
  };
}
