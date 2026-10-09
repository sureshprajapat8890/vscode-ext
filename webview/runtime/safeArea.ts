import { useSyncExternalStore } from 'react';
import { getHost, type EdgeInsets, type PreviewEnv } from './host';

const host = getHost();
let env: PreviewEnv = host.env;
const listeners = new Set<() => void>();
host.subscribe((next) => {
  env = next;
  for (const l of [...listeners]) l();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current safe-area insets of the simulated device (portrait or landscape). */
export function getInsets(): EdgeInsets {
  return env.window.insets;
}

export function getFrame(): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: env.window.width, height: env.window.height };
}

/** Re-renders when the simulated device or orientation changes. */
export function useDeviceInsets(): EdgeInsets {
  return useSyncExternalStore(subscribe, getInsets);
}

export function useDeviceFrame(): { x: number; y: number; width: number; height: number } {
  const win = useSyncExternalStore(subscribe, () => env.window);
  return { x: 0, y: 0, width: win.width, height: win.height };
}
