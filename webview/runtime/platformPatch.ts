/**
 * Makes react-native-web's Dimensions and Appearance report the simulated device instead of the
 * webview window. These are patched in place (rather than overridden in the react-native wrapper)
 * so react-native-web's own hooks — useWindowDimensions, useColorScheme, PixelRatio — agree.
 */
import { Appearance, Dimensions } from 'react-native-web';
import { getHost, type ColorScheme, type PreviewEnv } from './host';

type DisplayMetrics = { width: number; height: number; scale: number; fontScale: number };
type DimensionsChange = { window: DisplayMetrics; screen: DisplayMetrics };
type DimensionsHandler = (change: DimensionsChange) => void;
type AppearanceListener = (preferences: { colorScheme: ColorScheme }) => void;

const PATCHED = Symbol.for('rnlens.platformPatched');

function metrics(env: PreviewEnv): DimensionsChange {
  const { width, height, scale, fontScale } = env.window;
  const window = { width, height, scale, fontScale };
  return { window, screen: { ...window } };
}

export function installPlatformPatch(): void {
  const patched = Dimensions as unknown as Record<symbol, boolean>;
  if (patched[PATCHED]) return;
  patched[PATCHED] = true;

  const host = getHost();
  let current = metrics(host.env);
  let scheme = host.env.colorScheme;
  const dimensionListeners = new Set<DimensionsHandler>();
  const appearanceListeners = new Set<AppearanceListener>();

  Object.assign(Dimensions, {
    get(dimension: string): DisplayMetrics {
      if (dimension !== 'window' && dimension !== 'screen') {
        throw new Error(`No dimension set for key ${dimension}`);
      }
      return current[dimension];
    },
    addEventListener(type: string, handler: DimensionsHandler) {
      if (type === 'change') dimensionListeners.add(handler);
      return { remove: () => dimensionListeners.delete(handler) };
    },
    removeEventListener(_type: string, handler: DimensionsHandler) {
      dimensionListeners.delete(handler);
    },
  });

  Object.assign(Appearance, {
    getColorScheme: (): ColorScheme => scheme,
    addChangeListener(listener: AppearanceListener) {
      appearanceListeners.add(listener);
      return { remove: () => appearanceListeners.delete(listener) };
    },
  });

  host.subscribe((env) => {
    const next = metrics(env);
    if (
      next.window.width !== current.window.width ||
      next.window.height !== current.window.height ||
      next.window.scale !== current.window.scale
    ) {
      current = next;
      for (const handler of [...dimensionListeners]) handler(current);
    }
    if (env.colorScheme !== scheme) {
      scheme = env.colorScheme;
      for (const listener of [...appearanceListeners]) listener({ colorScheme: scheme });
    }
  });
}

installPlatformPatch();
