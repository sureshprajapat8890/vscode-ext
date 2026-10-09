import './styles.css';
import type { HostMessage, ProtocolBuildMessage, WebviewMessage } from '../src/preview/protocol';
import { DEFAULT_DEVICE, type DevicePreset } from './devices';

const vscode = acquireVsCodeApi<WebviewMessage>();
const post = (message: WebviewMessage): void => vscode.postMessage(message);
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- Shell: toolbar, device frame, overlay -------------------------------------------------

const app = document.getElementById('app') as HTMLElement;
const toolbar = el('header', 'toolbar');
const deviceName = el('span', 'device-name');
const status = el('span', 'status');
status.setAttribute('role', 'status');
toolbar.append(deviceName, status);

const stage = el('main', 'stage');
const holder = el('div', 'frame-holder');
const frame = el('div', 'frame');
const screen = el('div', 'screen');
const rnRoot = el('div');
rnRoot.id = 'rn-root';
const statusBar = el('div', 'status-bar');
statusBar.append(el('span', undefined, '9:41'), el('span', 'icons', '▂▄▆ ▮'));
const island = el('div', 'island');
const homeIndicator = el('div', 'home-indicator');
screen.append(rnRoot, statusBar, island, homeIndicator);
frame.append(screen);
holder.append(frame);
stage.append(holder);

const overlay = el('section', 'overlay');
overlay.hidden = true;
overlay.setAttribute('role', 'alert');
const overlayHeader = el('div', 'overlay-header');
const overlayTitle = el('h2', 'overlay-title');
const dismiss = el('button', 'overlay-dismiss', 'Dismiss');
dismiss.type = 'button';
dismiss.addEventListener('click', () => {
  overlay.hidden = true;
});
overlayHeader.append(overlayTitle, dismiss);
const overlayBody = el('pre', 'overlay-body');
overlay.append(overlayHeader, overlayBody);
stage.append(overlay);

const disclaimer = el('footer', 'disclaimer', 'web-rendered preview · native fidelity may differ');
app.append(toolbar, stage, disclaimer);

let device = DEFAULT_DEVICE;

function applyDevice(preset: DevicePreset): void {
  device = preset;
  deviceName.textContent = device.name;
  frame.style.setProperty('--device-w', `${device.width}px`);
  frame.style.setProperty('--device-h', `${device.height}px`);
  frame.style.setProperty('--radius', `${device.cornerRadius}px`);
  frame.style.setProperty('--status-h', `${device.statusBarHeight}px`);
  island.hidden = device.cutout !== 'dynamicIsland';
  homeIndicator.hidden = !device.homeIndicator;
  fit();
}

/** Scales the frame down (never up) to fit the stage; the device's logical size never changes. */
function fit(): void {
  const bezel = 12;
  const w = device.width + bezel * 2;
  const h = device.height + bezel * 2;
  const style = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH =
    stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const scale = Math.max(0.1, Math.min(1, availW / w, availH / h));
  frame.style.transform = `scale(${scale})`;
  holder.style.width = `${w * scale}px`;
  holder.style.height = `${h * scale}px`;
}

new ResizeObserver(fit).observe(stage);
applyDevice(DEFAULT_DEVICE);

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function showOverlay(title: string, body: string): void {
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  overlay.hidden = false;
}

function formatBuildError(e: ProtocolBuildMessage): string {
  const where = e.file ? `${e.file}:${e.line ?? 0}:${(e.column ?? 0) + 1}\n` : '';
  const code = e.lineText ? `\n    ${e.lineText.trim()}` : '';
  return `${where}${e.text}${code}`;
}

// ---- Runtime: run bundles, capture errors ---------------------------------------------------

let runningId: number | undefined;
let renderedId: number | undefined;
let runFailed = false;

function reportRuntimeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  runFailed = true;
  setStatus('✗ runtime error', true);
  showOverlay('Runtime error', stack ?? message);
  post({ type: 'runtimeError', id: runningId, message, stack });
}

window.addEventListener('error', (event) => reportRuntimeError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportRuntimeError(event.reason));

let bundleStyle: HTMLStyleElement | undefined;

function runBundle(id: number, code: string, css: string, buildMs: number): void {
  overlay.hidden = true;
  try {
    globalThis.__RNLENS_UNMOUNT__?.();
  } catch (err) {
    // The previous tree is discarded with its DOM below; a failing unmount must not block the new one.
    console.warn('RN Lens: previous preview failed to unmount', err);
  }
  globalThis.__RNLENS_UNMOUNT__ = undefined;
  // Each bundle carries its own react-native-web instance, which creates its own stylesheet.
  document.querySelectorAll('style#react-native-stylesheet').forEach((s) => s.remove());

  const mount = el('div', 'rn-mount');
  rnRoot.replaceChildren(mount);
  globalThis.__RNLENS_ROOT__ = mount;

  bundleStyle ??= document.head.appendChild(el('style'));
  bundleStyle.textContent = css;

  runningId = id;
  runFailed = false;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const script = el('script');
  script.nonce = nonce;
  script.src = url;
  script.onload = () => {
    URL.revokeObjectURL(url);
    script.remove();
    requestAnimationFrame(() => {
      if (runFailed || runningId !== id) return;
      renderedId = id;
      setStatus(`✓ ${buildMs} ms`);
      post({ type: 'rendered', id });
    });
  };
  script.onerror = () => {
    URL.revokeObjectURL(url);
    script.remove();
    reportRuntimeError(new Error('The preview bundle could not be loaded.'));
  };
  document.body.append(script);
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'building':
      setStatus('Building…');
      break;
    case 'bundle':
      runBundle(message.id, message.code, message.css, message.buildMs);
      break;
    case 'buildError':
      // The last successful render stays mounted underneath the overlay.
      setStatus('✗ build error', true);
      showOverlay(
        message.errors.length === 1 ? 'Build error' : `${message.errors.length} build errors`,
        message.errors.map(formatBuildError).join('\n\n'),
      );
      break;
    case '__test_snapshot':
      post({
        type: '__test_snapshot_result',
        requestId: message.requestId,
        text: rnRoot.innerText,
        renderedId,
      });
      break;
  }
});

post({ type: 'ready' });
