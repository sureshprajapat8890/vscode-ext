export type SimulatedPlatform = 'ios' | 'android' | 'web';

/** What a preview renders. App-level targets arrive in a later phase. */
export interface ComponentTarget {
  kind: 'component';
  /** Absolute path of the module exporting the component. */
  file: string;
  /** Export to render: an identifier, or `"default"`. */
  exportName: string;
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

export interface BundleSuccess {
  ok: true;
  code: string;
  css: string;
  /** External source map (JSON) for `code`; kept in the extension host for error mapping. */
  map: string;
  buildMs: number;
  warnings: BuildMessage[];
}

export interface BundleFailure {
  ok: false;
  errors: BuildMessage[];
  warnings: BuildMessage[];
  buildMs: number;
}

export type BundleResult = BundleSuccess | BundleFailure;

export function bundleKeyId(key: BundleKey): string {
  const t = key.target;
  return JSON.stringify([key.projectRoot, key.platform, t.kind, t.file, t.exportName]);
}
