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
  onPlatform(os) {
    post({ type: 'setPlatform', platform: os });
  },
  onToggleLock() {
    post({ type: 'toggleLock' });
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
  post({
    type: 'runtimeError',
    errorId,
    id: runningId,
    message,
    stack,
    componentStack,
    bundleUrls: { app: appUrl, vendor: vendorUrl },
  });
}

window.addEventListener('error', (event) => reportRuntimeError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportRuntimeError(event.reason));

/**
 * Module cache for hot updates. Project modules in the app bundle call `reuse` first: during a hot
 * update, modules the extension didn't mark for re-execution get their previous exports back, so
 * unchanged modules (and the React tree's state) survive. `store` records exports after a run.
 */
const hot = {
  updating: false,
  reexecute: new Set<string>(),
  modules: new Map<string, unknown>(),
  reuse(module: { exports: unknown }, id: string): boolean {
    if (!this.updating || this.reexecute.has(id) || !this.modules.has(id)) return false;
    module.exports = this.modules.get(id);
    return true;
  },
  store(module: { exports: unknown }, id: string): void {
    this.modules.set(id, module.exports);
  },
};
(globalThis as { __RNLENS_HOT__?: typeof hot }).__RNLENS_HOT__ = hot;

let vendorVersion: string | undefined;
let vendorUrl: string | undefined;
let appUrl: string | undefined;
/** A full run has rendered since the vendor bundle loaded, so hot updates have a tree to patch. */
let mounted = false;
const vendorStyle = document.head.appendChild(el('style'));
const appStyle = document.head.appendChild(el('style'));

/** Runs code as a nonce'd script from a Blob URL; resolves with the URL once it has executed. */
function runScript(code: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  return new Promise((resolve) => {
    const script = el('script');
    script.nonce = nonce;
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      script.remove();
      resolve(url);
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      script.remove();
      reportRuntimeError(new Error('The preview bundle could not be loaded.'));
      resolve(url);
    };
    document.body.append(script);
  });
}

type BundleMessage = Extract<HostMessage, { type: 'bundle' }>;

async function runBundle(message: BundleMessage): Promise<void> {
  const needVendor = message.vendor.version !== vendorVersion;
  if (needVendor && message.vendor.code === undefined) {
    post({ type: 'requestFullBundle' });
    return;
  }
  // Hot updates need a healthy mounted tree; anything else re-mounts from scratch.
  const full = needVendor || message.plan.kind === 'full' || runFailed || !mounted;
  overlay.hide();
  shownErrorId = undefined;
  counts.total = counts.warnings = counts.errors = 0;
  toolbar.setConsoleCounts(0, 0, 0);
  runningId = message.id;
  runFailed = false;

  if (full) {
    try {
      globalThis.__RNLENS_UNMOUNT__?.();
    } catch (err) {
      // The previous tree is discarded with its DOM below; a failing unmount must not block the new one.
      console.warn('RN Lens: previous preview failed to unmount', err);
    }
    hot.modules.clear();
    mounted = false;
    const mount = el('div', 'rn-mount');
    // Expo's registerRootComponent (and index.web.js entries) render into #root.
    mount.id = 'root';
    rnRoot.replaceChildren(mount);
    globalThis.__RNLENS_ROOT__ = mount;
  }

  host.update(envFor());
  if (needVendor) {
    // A new vendor bundle brings a new React and react-native-web: drop the old one's listeners
    // and stylesheet before it runs.
    host.resetListeners();
    globalThis.__RNLENS_UNMOUNT__ = undefined;
    document.querySelectorAll('style#react-native-stylesheet').forEach((s) => s.remove());
    vendorStyle.textContent = message.vendor.css;
    vendorUrl = await runScript(message.vendor.code as string);
    vendorVersion = message.vendor.version;
  }

  appStyle.textContent = message.app.css;
  hot.updating = !full;
  hot.reexecute = new Set(message.plan.kind === 'hot' ? message.plan.reexecute : []);
  // The app bundle is CommonJS: give it the vendor registry as `require`. The wrapper starts on
  // the bundle's first line, so source map line numbers stay valid.
  appUrl = await runScript(
    `(function (require, module, exports) {${message.app.code}
})(globalThis.__RNLENS_REQUIRE__, { exports: {} }, {});`,
  );
  hot.updating = false;

  requestAnimationFrame(() => {
    if (runFailed || runningId !== message.id) return;
    mounted = true;
    renderedId = message.id;
    toolbar.setStatus(`${full ? '✓' : '⚡'} ${message.buildMs} ms`);
    post({ type: 'rendered', id: message.id });
  });
}

/** Bundles are applied strictly in order (each may wait for scripts to load). */
let bundleQueue = Promise.resolve();

/**
 * Test hook: clicks the innermost element whose own text is exactly `text`. react-native-web
 * Pressables handle `click`, which bubbles up from the text to the pressable.
 */
function pressByText(text: string): void {
  const candidates = [...rnRoot.querySelectorAll<HTMLElement>('*')].filter(
    (node) => node.innerText?.trim() === text,
  );
  const target = candidates.at(-1);
  target?.click();
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
      platform = message.platform;
      toolbar.setPlatform(platform);
      toolbar.setLocked(message.locked);
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
      bundleQueue = bundleQueue.then(() => runBundle(message));
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
    case '__test_press':
      pressByText(message.text);
      break;
    case '__test_set_env':
      if (message.deviceId !== undefined) state.deviceId = message.deviceId;
      if (message.scheme !== undefined) state.scheme = message.scheme;
      if (message.landscape !== undefined) state.landscape = message.landscape;
      applyDevice();
      break;
  }
});

// Apps that route by URL (expo-router, React Navigation linking on web) start at "/", not at the
// webview's own document path. The query string must stay: VS Code's webview service worker uses
// it to identify the webview when serving resources (images, fonts) to the page.
try {
  history.replaceState(history.state, '', `/${location.search}${location.hash}`);
} catch {
  // Not allowed in this environment; routers then fall back to their not-found screen.
}

applyDevice();
post({ type: 'ready' });
