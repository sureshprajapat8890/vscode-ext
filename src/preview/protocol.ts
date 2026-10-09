/**
 * Messages exchanged between the extension host and the preview webview.
 * Shared by both sides; must not import Node or VS Code modules.
 */

export interface ProtocolBuildMessage {
  text: string;
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
}

export interface ProtocolFrame {
  functionName: string | undefined;
  file: string | undefined;
  /** 1-based. */
  line: number | undefined;
  /** 1-based. */
  column: number | undefined;
  userCode: boolean;
  raw: string;
}

export interface ProtocolMock {
  specifier: string;
  source: 'project' | 'built-in' | 'auto';
  note?: string;
}

/** What the panel previews; persisted in webview state so panels survive a restart. */
export interface PanelTarget {
  /** `component` (default for state saved by older versions) or the whole `app`. */
  kind?: 'component' | 'app';
  /** Component file, or the app entry file. */
  file: string;
  /** Component export (empty for apps). */
  exportName: string;
  label: string;
  variant: string | null;
  /** Simulated platform chosen in the toolbar. */
  platform?: SimulatedOS;
}

export type SimulatedOS = 'ios' | 'android' | 'web';
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** Extension → webview. */
export type HostMessage =
  | {
      type: 'init';
      target: PanelTarget;
      defaultDevice: string;
      assetBase: string;
      platform: SimulatedOS;
      locked: boolean;
    }
  | {
      type: 'bundle';
      id: number;
      code: string;
      css: string;
      buildMs: number;
      platform: SimulatedOS;
      mocked: ProtocolMock[];
    }
  | { type: 'buildError'; id: number; errors: ProtocolBuildMessage[] }
  | { type: 'building'; title: string }
  | { type: 'variants'; names: string[]; selected: string | null }
  | {
      type: 'runtimeErrorResolved';
      errorId: number;
      message: string;
      frames: ProtocolFrame[];
      componentFrames: ProtocolFrame[];
    }
  | { type: '__test_snapshot'; requestId: number }
  | { type: '__test_click_frame'; index: number }
  | { type: '__test_press'; text: string }
  | { type: '__test_set_env'; deviceId?: string; scheme?: 'light' | 'dark'; landscape?: boolean };

export interface OverlaySnapshot {
  visible: boolean;
  title: string;
  message: string;
  frames: { label: string; file: string | undefined; line: number | undefined }[];
}

/** Webview → extension. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'rendered'; id: number }
  | {
      type: 'runtimeError';
      errorId: number;
      id: number | undefined;
      message: string;
      stack: string | undefined;
      componentStack: string | undefined;
    }
  | { type: 'console'; level: ConsoleLevel; text: string }
  | { type: 'openSource'; file: string; line: number; column: number }
  | { type: 'selectVariant'; name: string | null }
  | { type: 'reload' }
  | { type: 'showOutput' }
  | { type: 'setPlatform'; platform: SimulatedOS }
  | { type: 'toggleLock' }
  | {
      type: '__test_snapshot_result';
      requestId: number;
      text: string;
      renderedId: number | undefined;
      overlay: OverlaySnapshot;
      env: { deviceId: string; width: number; height: number; scheme: 'light' | 'dark' };
    };

const WEBVIEW_MESSAGE_TYPES = new Set<WebviewMessage['type']>([
  'ready',
  'rendered',
  'runtimeError',
  'console',
  'openSource',
  'selectVariant',
  'reload',
  'showOutput',
  'setPlatform',
  'toggleLock',
  '__test_snapshot_result',
]);

/** Narrows an untrusted `postMessage` payload from the webview. */
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    WEBVIEW_MESSAGE_TYPES.has((value as { type?: unknown }).type as WebviewMessage['type'])
  );
}

/** Narrows persisted webview state to a panel target (state may come from an older version). */
export function isPanelTarget(value: unknown): value is PanelTarget {
  const t = value as Partial<PanelTarget> | null;
  return (
    !!t &&
    typeof t.file === 'string' &&
    typeof t.exportName === 'string' &&
    typeof t.label === 'string' &&
    (t.variant === null || typeof t.variant === 'string') &&
    (t.kind === undefined || t.kind === 'component' || t.kind === 'app') &&
    (t.platform === undefined ||
      t.platform === 'ios' ||
      t.platform === 'android' ||
      t.platform === 'web')
  );
}
