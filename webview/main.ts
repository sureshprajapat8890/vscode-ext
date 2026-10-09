import './styles.css';
import type {
  HostMessage,
  PanelTarget,
  ProtocolFrame,
  SimulatedOS,
  WebviewMessage,
} from '../src/preview/protocol';
import { installConsoleBridge } from './consoleBridge';
import { customDevice, DEFAULT_DEVICE_ID, findDevice, orient, type DevicePreset } from './devices';
import { Host } from './host';
import { ErrorOverlay, framesFromBuildErrors, framesFromStack, type OverlayFrame } from './overlay';
import type { PreviewEnv } from './runtime/host';
import { Toolbar, ZOOMS, type Zoom } from './toolbar';

const vscode = acquireVsCodeApi<WebviewMessage>();
const post = (message: WebviewMessage): void => vscode.postMessage(message);
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';

// ---- Persisted toolbar state -----------------------------------------------------------------

interface ShellState {
  /** Empty until the extension tells us the default device. */
  deviceId: string;
  custom: { width: number; height: number };
  landscape: boolean;
  zoom: Zoom;
  scheme: 'light' | 'dark';
  /** Read back by the extension's panel serializer after a restart. */
  target?: PanelTarget;
}

const saved = (vscode.getState() ?? {}) as Partial<ShellState>;
const state: ShellState = {
  deviceId: typeof saved.deviceId === 'string' ? saved.deviceId : '',
  custom: saved.custom ?? { width: 390, height: 844 },
  landscape: saved.landscape === true,
  zoom: ZOOMS.includes(saved.zoom as Zoom) ? (saved.zoom as Zoom) : 'fit',
  scheme: saved.scheme === 'dark' ? 'dark' : 'light',
  target: saved.target,
};
const persist = (): void => vscode.setState(state);

let platform: SimulatedOS = 'ios';

function currentDevice(): DevicePreset {
  if (state.deviceId === 'custom') return customDevice(state.custom.width, state.custom.height);
  return findDevice(state.deviceId) ?? (findDevice(DEFAULT_DEVICE_ID) as DevicePreset);
}

function envFor(): PreviewEnv {
  const d = currentDevice();
  const o = orient(d, state.landscape);
  return {
    device: {
      id: d.id,
      name: d.name,
      isTablet: d.isTablet,
      hasNotch: d.cutout !== 'none',
      hasDynamicIsland: d.cutout === 'dynamicIsland',
    },
    window: { width: o.width, height: o.height, scale: d.scale, fontScale: 1, insets: o.insets },
    colorScheme: state.scheme,
    platform,
  };
}

// ---- Shell DOM -------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const toolbar = new Toolbar({
  onDevice(id) {
    state.deviceId = id;
    applyDevice();
  },
  onCustomSize(width, height) {
    state.custom = { width, height };
    applyDevice();
  },
  onRotate() {
    state.landscape = !state.landscape;
    applyDevice();
  },
  onZoom(zoom) {
    state.zoom = zoom;
    persist();
    fit();
  },
  onToggleScheme() {
    state.scheme = state.scheme === 'dark' ? 'light' : 'dark';
    applyDevice();
  },
  onVariant(name) {
    post({ type: 'selectVariant', name });
  },
  onReload() {
    post({ type: 'reload' });
  },
  onShowOutput() {
    post({ type: 'showOutput' });
  },
});

const stage = el('main', 'stage');
const holder = el('div', 'frame-holder');
const frame = el('div', 'frame');
const screen = el('div', 'screen');
const rnRoot = el('div');
rnRoot.id = 'rn-root';
const statusBar = el('div', 'status-bar');
const clock = el('span', 'clock');
statusBar.append(clock, el('span', 'icons', '▂▄▆ ▮'));
const cutout = el('div', 'cutout');
const homeIndicator = el('div', 'home-indicator');
screen.append(rnRoot, statusBar, cutout, homeIndicator);
frame.append(screen);
holder.append(frame);

const overlay = new ErrorOverlay((f: OverlayFrame) => {
  if (f.file && f.line !== undefined) {
    post({ type: 'openSource', file: f.file, line: f.line, column: f.column ?? 1 });
  }
});
stage.append(holder, overlay.element);

const app = document.getElementById('app') as HTMLElement;
app.append(
  toolbar.element,
  stage,
  el('footer', 'disclaimer', 'web-rendered preview · native fidelity may differ'),
);

const BEZEL = 12;

function applyDevice(): void {
  const d = currentDevice();
  const o = orient(d, state.landscape);
  frame.style.setProperty('--device-w', `${o.width}px`);
  frame.style.setProperty('--device-h', `${o.height}px`);
  frame.style.setProperty('--radius', `${d.cornerRadius}px`);
  frame.style.setProperty('--status-h', `${d.statusBarHeight}px`);
  frame.dataset.platform = d.platform;
  frame.dataset.orientation = state.landscape ? 'landscape' : 'portrait';
  screen.dataset.scheme = state.scheme;
  cutout.className = `cutout ${d.cutout}`;
  cutout.hidden = d.cutout === 'none' || state.landscape;
  statusBar.hidden = !o.showStatusBar;
  clock.textContent = d.platform === 'ios' ? '9:41' : '12:00';
  homeIndicator.hidden = !d.homeIndicator;
  toolbar.setDevice(state.deviceId || d.id, state.custom);
  toolbar.setScheme(state.scheme);
  toolbar.setZoom(state.zoom);
  host.update(envFor());
  persist();
  fit();
}

/** Scales the frame (never the device's logical size) to the chosen zoom, or to fit the stage. */
function fit(): void {
  const o = orient(currentDevice(), state.landscape);
  const w = o.width + BEZEL * 2;
  const h = o.height + BEZEL * 2;
  let scale: number;
  if (state.zoom === 'fit') {
    const style = getComputedStyle(stage);
    const availW =
      stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availH =
      stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    scale = Math.max(0.1, Math.min(1, availW / w, availH / h));
  } else {
    scale = state.zoom / 100;
  }
  stage.classList.toggle('scrollable', state.zoom !== 'fit');
  frame.style.transform = `scale(${scale})`;
  holder.style.width = `${w * scale}px`;
  holder.style.height = `${h * scale}px`;
}

new ResizeObserver(fit).observe(stage);

// ---- Runtime: run bundles, capture errors and console ---------------------------------------

let runningId: number | undefined;
let renderedId: number | undefined;
let runFailed = false;
let errorSeq = 0;
/** The runtime error shown in the overlay for the current run (later ones are only logged). */
let shownErrorId: number | undefined;
const counts = { total: 0, warnings: 0, errors: 0 };

const host = new Host(envFor(), (error, componentStack) =>
  reportRuntimeError(error, componentStack ?? undefined),
);
(globalThis as { __RNLENS_HOST__?: Host }).__RNLENS_HOST__ = host;

installConsoleBridge((level, text) => {
  counts.total++;
  if (level === 'warn') counts.warnings++;
  if (level === 'error') counts.errors++;
  toolbar.setConsoleCounts(counts.total, counts.warnings, counts.errors);
  post({ type: 'console', level, text });
});

function stackLines(stack: string | undefined): OverlayFrame[] {
  return (stack ?? '')
    .split('\n')
    .filter((l) => /^\s*at /.test(l))
    .map((l) => ({
      label: l.trim(),
      file: undefined,
      line: undefined,
      column: undefined,
      primary: false,
    }));
}

function reportRuntimeError(error: unknown, componentStack?: string): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const errorId = ++errorSeq;
  runFailed = true;
  toolbar.setStatus('✗ runtime error', true);
  if (shownErrorId === undefined) {
    shownErrorId = errorId;
    overlay.show('Runtime error', message, stackLines(stack));
  }
  post({ type: 'runtimeError', errorId, id: runningId, message, stack, componentStack });
}

window.addEventListener('error', (event) => reportRuntimeError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportRuntimeError(event.reason));

let bundleStyle: HTMLStyleElement | undefined;

function runBundle(id: number, code: string, css: string, buildMs: number): void {
  overlay.hide();
  shownErrorId = undefined;
  counts.total = counts.warnings = counts.errors = 0;
  toolbar.setConsoleCounts(0, 0, 0);
  try {
    globalThis.__RNLENS_UNMOUNT__?.();
  } catch (err) {
    // The previous tree is discarded with its DOM below; a failing unmount must not block the new one.
    console.warn('RN Lens: previous preview failed to unmount', err);
  }
  globalThis.__RNLENS_UNMOUNT__ = undefined;
  host.resetListeners();
  host.update(envFor());
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
      toolbar.setStatus(`✓ ${buildMs} ms`);
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

function resolvedFrames(frames: ProtocolFrame[], componentFrames: ProtocolFrame[]): OverlayFrame[] {
  const errorFrames = framesFromStack(frames);
  const components = framesFromStack(componentFrames.filter((f) => f.file));
  return [...errorFrames, ...components];
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      state.target = message.target;
      if (!state.deviceId) {
        state.deviceId = findDevice(message.defaultDevice)
          ? message.defaultDevice
          : DEFAULT_DEVICE_ID;
      }
      (globalThis as { __RNLENS_ASSET_BASE__?: string }).__RNLENS_ASSET_BASE__ = message.assetBase;
      applyDevice();
      break;
    }
    case 'building':
      toolbar.setStatus('Building…');
      break;
    case 'bundle':
      platform = message.platform;
      toolbar.setPlatform(platform);
      toolbar.setMocked(message.mocked);
      runBundle(message.id, message.code, message.css, message.buildMs);
      break;
    case 'buildError':
      // The last successful render stays mounted underneath the overlay.
      toolbar.setStatus('✗ build error', true);
      overlay.show(
        message.errors.length === 1 ? 'Build error' : `${message.errors.length} build errors`,
        message.errors
          .map((e) => (e.lineText ? `${e.text}\n    ${e.lineText.trim()}` : e.text))
          .join('\n\n'),
        framesFromBuildErrors(message.errors),
      );
      break;
    case 'variants':
      toolbar.setVariants(message.names, message.selected);
      break;
    case 'runtimeErrorResolved':
      if (message.errorId === shownErrorId) {
        overlay.show(
          'Runtime error',
          message.message,
          resolvedFrames(message.frames, message.componentFrames),
        );
      }
      break;
    case '__test_snapshot': {
      const o = orient(currentDevice(), state.landscape);
      post({
        type: '__test_snapshot_result',
        requestId: message.requestId,
        text: rnRoot.innerText,
        renderedId,
        overlay: overlay.snapshot(),
        env: {
          deviceId: currentDevice().id,
          width: o.width,
          height: o.height,
          scheme: state.scheme,
        },
      });
      break;
    }
    case '__test_click_frame':
      overlay.clickLinked(message.index);
      break;
    case '__test_set_env':
      if (message.deviceId !== undefined) state.deviceId = message.deviceId;
      if (message.scheme !== undefined) state.scheme = message.scheme;
      if (message.landscape !== undefined) state.landscape = message.landscape;
      applyDevice();
      break;
  }
});

applyDevice();
post({ type: 'ready' });
