export type SimulatedPlatform = 'ios' | 'android' | 'web';

export interface VariantRef {
  /** Absolute path of the `<Name>.preview.*` file. */
  file: string;
  /** Named export of that file to render. */
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

export type PreviewTarget = ComponentTarget;

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
  return JSON.stringify([key.projectRoot, key.platform, t.kind, t.file, t.exportName]);
}
