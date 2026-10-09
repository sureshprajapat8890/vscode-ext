import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  createNonce,
  renderPreviewHtml,
  sanitizeAllowList,
} from '../../../src/preview/html';
import { isWebviewMessage } from '../../../src/preview/protocol';

const base = {
  cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
  nonce: 'abc123==',
  scriptUri: 'https://x/dist/webview.js',
  styleUri: 'https://x/dist/webview.css',
};

describe('contentSecurityPolicy', () => {
  it('locks everything down by default', () => {
    expect(contentSecurityPolicy({ ...base, connectSrc: [] })).toBe(
      [
        `default-src 'none'`,
        `img-src ${base.cspSource} data: blob:`,
        `font-src ${base.cspSource} data:`,
        `style-src ${base.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-abc123==' blob:`,
        `connect-src 'none'`,
      ].join('; '),
    );
  });

  it('allows only the listed origins for fetch', () => {
    expect(
      contentSecurityPolicy({ ...base, connectSrc: ['http://localhost:4000', 'https://api.dev'] }),
    ).toContain('connect-src http://localhost:4000 https://api.dev');
  });
});

describe('sanitizeAllowList', () => {
  it('accepts origins, normalises a trailing slash and dedupes', () => {
    expect(
      sanitizeAllowList([
        'http://localhost:4000/',
        'https://api.example.com',
        'ws://127.0.0.1:8081',
        'http://localhost:4000',
      ]),
    ).toEqual({
      origins: ['http://localhost:4000', 'https://api.example.com', 'ws://127.0.0.1:8081'],
      rejected: [],
    });
  });

  it('rejects anything that could inject CSP or is not an origin', () => {
    const { origins, rejected } = sanitizeAllowList([
      "http://a.com; script-src 'unsafe-eval'",
      'http://a.com/path',
      '*',
      'localhost:4000',
      'ftp://a.com',
      42,
    ]);
    expect(origins).toEqual([]);
    expect(rejected).toHaveLength(6);
  });
});

describe('renderPreviewHtml', () => {
  it('embeds the CSP, nonce-tagged script and stylesheet', () => {
    const html = renderPreviewHtml({ ...base, connectSrc: [] });
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none';`,
    );
    expect(html).toContain('<script nonce="abc123==" src="https://x/dist/webview.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="https://x/dist/webview.css">');
    expect(html).toContain('<div id="app"></div>');
  });

  it('escapes attribute values', () => {
    const html = renderPreviewHtml({ ...base, scriptUri: 'https://x/"><script>', connectSrc: [] });
    expect(html).toContain('src="https://x/&quot;>&lt;script>"');
  });
});

describe('createNonce', () => {
  it('returns distinct base64 values with 128 bits of entropy', () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe('isWebviewMessage', () => {
  it('accepts known message types only', () => {
    expect(isWebviewMessage({ type: 'ready' })).toBe(true);
    expect(isWebviewMessage({ type: 'rendered', id: 1 })).toBe(true);
    expect(isWebviewMessage({ type: 'bundle' })).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage('ready')).toBe(false);
  });
});
