import { randomBytes } from 'node:crypto';

export interface PreviewHtmlOptions {
  /** `webview.cspSource`. */
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  /** Origins the preview may `fetch` (already validated with `sanitizeAllowList`). */
  connectSrc: readonly string[];
}

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

const ORIGIN = /^(https?|wss?):\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/**
 * Splits `rnLens.networkAllowList` into valid origins and rejected entries. Only bare
 * `scheme://host[:port]` origins are accepted so a setting can never inject CSP directives.
 */
export function sanitizeAllowList(entries: readonly unknown[]): {
  origins: string[];
  rejected: string[];
} {
  const origins: string[] = [];
  const rejected: string[] = [];
  for (const entry of entries) {
    const value = typeof entry === 'string' ? entry.trim().replace(/\/$/, '') : '';
    if (ORIGIN.test(value)) {
      if (!origins.includes(value)) origins.push(value);
    } else {
      rejected.push(String(entry));
    }
  }
  return { origins, rejected };
}

export function contentSecurityPolicy(
  o: Pick<PreviewHtmlOptions, 'cspSource' | 'nonce' | 'connectSrc'>,
): string {
  return [
    `default-src 'none'`,
    `img-src ${o.cspSource} data: blob:`,
    `font-src ${o.cspSource} data:`,
    `style-src ${o.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${o.nonce}' blob:`,
    `connect-src ${o.connectSrc.length > 0 ? o.connectSrc.join(' ') : `'none'`}`,
  ].join('; ');
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The webview document. The shell script builds the toolbar and device frame itself. */
export function renderPreviewHtml(o: PreviewHtmlOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(contentSecurityPolicy(o))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(o.styleUri)}">
<title>RN Lens</title>
</head>
<body>
<div id="app"></div>
<script nonce="${escapeAttr(o.nonce)}" src="${escapeAttr(o.scriptUri)}"></script>
</body>
</html>`;
}
