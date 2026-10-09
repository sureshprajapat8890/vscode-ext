import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import type { AppTarget, ComponentTarget, PreviewTarget } from './types';

export const ENTRY_SPECIFIER = 'rnlens:entry';
const NAMESPACE = 'rnlens-entry';
export const APP_KEY = 'RNLensPreview';

const DECORATOR_FILES = ['decorators.tsx', 'decorators.ts', 'decorators.jsx', 'decorators.js'];

/**
 * The decorators module for a project: `override` (from rnlens.config.js, relative to the project)
 * when given, else `.rnlens/decorators.*` if present.
 */
export function findDecorators(projectRoot: string, override?: string): string | undefined {
  if (override) return path.resolve(projectRoot, override);
  return DECORATOR_FILES.map((f) => path.join(projectRoot, '.rnlens', f)).find((f) =>
    existsSync(f),
  );
}

const str = JSON.stringify;

function componentEntry(target: ComponentTarget, decoratorsFile: string | undefined): string[] {
  const file = str(target.file);
  const lines = [
    `import { ErrorBoundary } from 'rnlens:runtime';`,
    `import { createElement } from 'react';`,
    `import { AppRegistry } from 'react-native';`,
    `import * as Target from ${file};`,
  ];
  const variant = target.variant;
  const propsVariant = variant?.kind === 'props';
  if (variant && !propsVariant) lines.push(`import * as Variants from ${str(variant.file)};`);
  if (decoratorsFile) lines.push(`import Decorators from ${str(decoratorsFile)};`);

  const missing = (where: string, name: string, hint: string): string =>
    `throw new Error('RN Lens: ' + ${where} + ' has no export named ' + ${str(str(name))} + '. ${hint}');`;

  lines.push(`const Component = Target[${str(target.exportName)}];`);
  lines.push(
    `if (Component == null) { ${missing(file, target.exportName, 'Export the component, or preview a different export.')} }`,
  );
  if (variant && propsVariant) {
    // `export const previews = { Name: props }`, or keyed by export: `{ Button: { Name: props } }`.
    lines.push(
      `const previews = Target.previews || {};`,
      `const forExport = previews[${str(target.exportName)}];`,
      `const variantProps = forExport && typeof forExport === 'object' && ${str(variant.name)} in forExport`,
      `  ? forExport[${str(variant.name)}]`,
      `  : previews[${str(variant.name)}];`,
      `if (variantProps == null) {`,
      `  throw new Error('RN Lens: the previews object in ' + ${file} + ' has no variant ' + ${str(str(variant.name))} + '. Pick another variant in the preview toolbar.');`,
      `}`,
      `const Shown = () => createElement(Component, variantProps);`,
    );
  } else if (variant) {
    lines.push(`const Shown = Variants[${str(variant.name)}];`);
    lines.push(
      `if (Shown == null) { ${missing(str(variant.file), variant.name, 'Pick another variant in the preview toolbar.')} }`,
    );
  } else {
    lines.push(`const Shown = Component;`);
  }

  if (decoratorsFile) {
    lines.push(
      `if (typeof Decorators !== 'function' && (typeof Decorators !== 'object' || Decorators === null)) {`,
      `  throw new Error('RN Lens: ' + ${str(decoratorsFile)} + ' must default-export a component that renders its children.');`,
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
    `AppRegistry.registerComponent(${str(APP_KEY)}, () => RNLensPreviewRoot);`,
    `AppRegistry.runApplication(${str(APP_KEY)}, { rootTag: globalThis.__RNLENS_ROOT__ });`,
  );
  return lines;
}

function appEntry(target: AppTarget): string[] {
  const file = str(target.file);
  const lines = [
    `import { ErrorBoundary, mountedRootCount } from 'rnlens:runtime';`,
    `import { AppRegistry } from 'react-native';`,
  ];
  if (target.mode === 'component') {
    lines.push(
      `import * as Root from ${file};`,
      `if (Root.default == null) {`,
      `  throw new Error('RN Lens: ' + ${file} + ' has no default export, so it can\\'t be used as the app root. Export the root component, or set rnLens.entry to your entry file.');`,
      `}`,
      `AppRegistry.registerComponent('main', () => Root.default);`,
    );
  } else {
    // Importing the entry registers the app; Expo's registerRootComponent (and any
    // index.web.js) also renders it straight into #root, which is the preview's mount element.
    lines.push(`import ${file};`);
  }
  lines.push(
    `AppRegistry.setWrapperComponentProvider(() => ErrorBoundary);`,
    `if (mountedRootCount() === 0) {`,
    `  const keys = AppRegistry.getAppKeys();`,
    `  if (keys.length === 0) {`,
    `    throw new Error('RN Lens: ' + ${file} + " didn't register an app. Expected AppRegistry.registerComponent(...) or Expo's registerRootComponent(...); set rnLens.entry if your entry is elsewhere.");`,
    `  }`,
    `  AppRegistry.runApplication(keys[keys.length - 1], { rootTag: globalThis.__RNLENS_ROOT__ });`,
    `}`,
  );
  return lines;
}

/**
 * Source of the in-memory entry module for a preview target. It imports the RN Lens runtime first
 * (so its patches apply before user code runs) and mounts into `globalThis.__RNLENS_ROOT__`.
 * Components are wrapped in the project's decorators and an error boundary; apps run as-is.
 */
export function generateEntry(target: PreviewTarget, decoratorsFile?: string): string {
  const lines =
    target.kind === 'component' ? componentEntry(target, decoratorsFile) : appEntry(target);
  return [...lines, ''].join('\n');
}

/**
 * Serves `rnlens:entry` (regenerated on every build, so variant switches and newly added decorators
 * take effect without a new context) and `rnlens:runtime[/<module>]` from the runtime directory.
 */
export function virtualEntryPlugin(
  getTarget: () => PreviewTarget,
  projectRoot: string,
  runtimeDir: string,
  decoratorsOverride?: string,
): Plugin {
  return {
    name: 'rnlens-virtual-entry',
    setup(build) {
      build.onResolve({ filter: /^rnlens:entry$/ }, () => ({
        path: 'entry',
        namespace: NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: generateEntry(getTarget(), findDecorators(projectRoot, decoratorsOverride)),
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
