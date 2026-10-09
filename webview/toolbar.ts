import type { ProtocolMock, SimulatedOS } from '../src/preview/protocol';
import { DEVICES } from './devices';

export type Zoom = 'fit' | 50 | 75 | 100 | 125 | 150 | 200;
export const ZOOMS: readonly Zoom[] = ['fit', 50, 75, 100, 125, 150, 200];

export interface ToolbarHandlers {
  onDevice(id: string): void;
  onCustomSize(width: number, height: number): void;
  onRotate(): void;
  onZoom(zoom: Zoom): void;
  onToggleScheme(): void;
  onVariant(name: string | null): void;
  onReload(): void;
  onShowOutput(): void;
}

const OS_LABEL: Record<SimulatedOS, string> = { ios: 'iOS', android: 'Android', web: 'Web' };
const DEFAULT_VARIANT = '';

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tb-button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function select(title: string, onChange: (value: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'tb-select';
  s.title = title;
  s.setAttribute('aria-label', title);
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function numberInput(title: string, onCommit: () => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '200';
  input.max = '3000';
  input.className = 'tb-number';
  input.title = title;
  input.setAttribute('aria-label', title);
  input.addEventListener('change', onCommit);
  return input;
}

/** The preview toolbar. Built from native controls so it's keyboard- and screen-reader friendly. */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly device: HTMLSelectElement;
  private readonly customGroup: HTMLElement;
  private readonly customWidth: HTMLInputElement;
  private readonly customHeight: HTMLInputElement;
  private readonly platform: HTMLElement;
  private readonly scheme: HTMLButtonElement;
  private readonly variant: HTMLSelectElement;
  private readonly zoom: HTMLSelectElement;
  private readonly mocks: HTMLButtonElement;
  private readonly consoleBadge: HTMLButtonElement;
  private readonly status: HTMLElement;

  constructor(h: ToolbarHandlers) {
    const bar = document.createElement('header');
    bar.className = 'toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Preview controls');

    this.device = select('Device', (v) => h.onDevice(v));
    for (const d of DEVICES) this.device.append(option(d.id, d.name));
    this.device.append(option('custom', 'Custom…'));

    const commitCustom = (): void => {
      const w = Number(this.customWidth.value);
      const hgt = Number(this.customHeight.value);
      if (w >= 200 && hgt >= 200 && w <= 3000 && hgt <= 3000)
        h.onCustomSize(Math.round(w), Math.round(hgt));
    };
    this.customWidth = numberInput('Custom width (dp)', commitCustom);
    this.customHeight = numberInput('Custom height (dp)', commitCustom);
    this.customGroup = document.createElement('span');
    this.customGroup.className = 'tb-custom';
    const times = document.createElement('span');
    times.textContent = '×';
    times.setAttribute('aria-hidden', 'true');
    this.customGroup.append(this.customWidth, times, this.customHeight);
    this.customGroup.hidden = true;

    const rotate = button('⟳', 'Rotate', () => h.onRotate());
    rotate.classList.add('tb-rotate');

    this.platform = document.createElement('span');
    this.platform.className = 'tb-platform';
    this.platform.title = 'Simulated platform (setting: rnLens.simulatedPlatform)';

    this.scheme = button('☀', 'Toggle light/dark color scheme', () => h.onToggleScheme());
    this.scheme.setAttribute('aria-pressed', 'false');

    this.variant = select('Variant', (v) => h.onVariant(v === DEFAULT_VARIANT ? null : v));
    this.variant.hidden = true;

    this.zoom = select('Zoom', (v) => h.onZoom(v === 'fit' ? 'fit' : (Number(v) as Zoom)));
    for (const z of ZOOMS) this.zoom.append(option(String(z), z === 'fit' ? 'Fit' : `${z}%`));

    const reload = button('↻', 'Reload preview', () => h.onReload());

    this.mocks = button('', 'Mocked native modules', () => h.onShowOutput());
    this.mocks.classList.add('tb-badge', 'tb-mocks');
    this.mocks.hidden = true;

    this.consoleBadge = button('', 'Console messages (open the RN Lens output)', () =>
      h.onShowOutput(),
    );
    this.consoleBadge.classList.add('tb-badge');
    this.setConsoleCounts(0, 0, 0);

    this.status = document.createElement('span');
    this.status.className = 'tb-status';
    this.status.setAttribute('role', 'status');

    bar.append(
      this.device,
      this.customGroup,
      rotate,
      this.platform,
      this.scheme,
      this.variant,
      this.zoom,
      reload,
      this.mocks,
      this.consoleBadge,
      this.status,
    );
    this.element = bar;
  }

  setDevice(id: string, custom: { width: number; height: number }): void {
    this.device.value = id;
    this.customGroup.hidden = id !== 'custom';
    this.customWidth.value = String(custom.width);
    this.customHeight.value = String(custom.height);
  }

  setZoom(zoom: Zoom): void {
    this.zoom.value = String(zoom);
  }

  setScheme(scheme: 'light' | 'dark'): void {
    this.scheme.textContent = scheme === 'dark' ? '🌙' : '☀';
    this.scheme.setAttribute('aria-pressed', String(scheme === 'dark'));
  }

  setPlatform(os: SimulatedOS): void {
    this.platform.textContent = OS_LABEL[os];
  }

  setVariants(names: readonly string[], selected: string | null): void {
    this.variant.replaceChildren(
      option(DEFAULT_VARIANT, 'Variant: Default'),
      ...names.map((n) => option(n, `Variant: ${n}`)),
    );
    this.variant.value = selected ?? DEFAULT_VARIANT;
    this.variant.hidden = names.length === 0;
  }

  setMocked(mocked: readonly ProtocolMock[]): void {
    this.mocks.hidden = mocked.length === 0;
    this.mocks.textContent = `⚠ ${mocked.length} mocked`;
    this.mocks.title = `Replaced with mocks (native code can't run on web): ${mocked.map((m) => m.specifier).join(', ')}`;
  }

  setConsoleCounts(total: number, warnings: number, errors: number): void {
    this.consoleBadge.textContent = `▤ ${total}`;
    this.consoleBadge.classList.toggle('has-warnings', warnings > 0 && errors === 0);
    this.consoleBadge.classList.toggle('has-errors', errors > 0);
    this.consoleBadge.title = `${total} console message(s): ${warnings} warning(s), ${errors} error(s). Click to open the RN Lens output.`;
  }

  setStatus(text: string, isError = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', isError);
  }
}
