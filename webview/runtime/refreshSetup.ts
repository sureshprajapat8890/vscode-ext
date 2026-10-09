/**
 * First module of every vendor bundle: installs React Refresh's hook (before react-dom loads, so the
 * renderer registers with it) and exposes the small API project modules call after re-running.
 */
import RefreshRuntime from 'react-refresh/runtime';

RefreshRuntime.injectIntoGlobalHook(globalThis);

export interface RNLensRefresh {
  register(type: unknown, id: string): void;
  sign(type: unknown, signature: string): void;
  perform(): void;
}

const refresh: RNLensRefresh = {
  register(type, id) {
    RefreshRuntime.register(type, id);
  },
  sign(type, signature) {
    RefreshRuntime.setSignature(type, signature);
  },
  perform() {
    RefreshRuntime.performReactRefresh();
  },
};

(globalThis as { __RNLENS_REFRESH__?: RNLensRefresh }).__RNLENS_REFRESH__ = refresh;
