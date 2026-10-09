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

/** Extension → webview. */
export type HostMessage =
  | { type: 'bundle'; id: number; code: string; css: string; buildMs: number }
  | { type: 'buildError'; id: number; errors: ProtocolBuildMessage[] }
  | { type: 'building'; title: string }
  | { type: '__test_snapshot'; requestId: number };

/** Webview → extension. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'rendered'; id: number }
  | { type: 'runtimeError'; id: number | undefined; message: string; stack: string | undefined }
  | {
      type: '__test_snapshot_result';
      requestId: number;
      text: string;
      renderedId: number | undefined;
    };

const WEBVIEW_MESSAGE_TYPES = new Set<WebviewMessage['type']>([
  'ready',
  'rendered',
  'runtimeError',
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
