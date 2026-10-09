export type SimulatedPlatform = 'ios' | 'android' | 'web';

export interface VariantRef {
  /**
   * `file`: a named export of the colocated `<Name>.preview.*` file (a zero-argument component).
   * `props`: a key of the component file's own `export const previews = { … }` (props to render
   * the component with). Defaults to `file`.
   */
  kind?: 'file' | 'props';
  /** Absolute path of the `.preview.*` file, or of the component file for `props` variants. */
  file: string;
  /** Variant name. */
  name: string;
}

/** What a preview renders. App-level targets arrive in a later phase. */
export interface ComponentTarget {
  kind: 'component';
  /** Absolute path of the module exporting the component. */
  file: string;
  /** Export to render: an identifier, or `"default"`. */
  exportName: string;
  /** Render this variant instead of the bare component. Not part of the context key. */
  variant?: VariantRef;
}

/** The whole app, started from its entry module (or root component). */
export interface AppTarget {
  kind: 'app';
  /** Absolute path of the entry module, or of the root component file. */
  file: string;
  mode: 'module' | 'component';
  /** expo-router routes directory, when the app uses expo-router. */
  routerAppDir?: string;
}

export type PreviewTarget = ComponentTarget | AppTarget;

export interface BundleKey {
  projectRoot: string;
  target: PreviewTarget;
  platform: SimulatedPlatform;
}

export interface BuildMessage {
  text: string;
  /** Absolute path, when esbuild reported a location. */
  file?: string;
  /** 1-based line. */
  line?: number;
  /** 0-based column. */
  column?: number;
  lineText?: string;
}

export interface MockedPackage {
  specifier: string;
  source: 'project' | 'built-in' | 'auto';
  note?: string;
  /** Files that imported it (absolute paths). */
  importers?: string[];
}

export interface BundleSuccess {
  ok: true;
  code: string;
  css: string;
  buildMs: number;
  warnings: BuildMessage[];
  mocked: MockedPackage[];
}

export interface BundleFailure {
  ok: false;
  errors: BuildMessage[];
  warnings: BuildMessage[];
  buildMs: number;
}

export type BundleResult = BundleSuccess | BundleFailure;

/** Identifies an esbuild context. Variants are excluded: switching one only regenerates the entry. */
export function bundleKeyId(key: BundleKey): string {
  const t = key.target;
  const what = t.kind === 'component' ? t.exportName : `${t.mode}:${t.routerAppDir ?? ''}`;
  return JSON.stringify([key.projectRoot, key.platform, t.kind, t.file, what]);
}
