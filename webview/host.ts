import type { PreviewEnv, RNLensHost } from './runtime/host';

/**
 * The shell's side of the runtime contract: holds the current environment, notifies the runtime
 * of changes, and forwards boundary-caught errors. Listeners are cleared before each new bundle
 * runs, so a replaced bundle can't keep reacting to toolbar changes.
 */
export class Host implements RNLensHost {
  private listeners = new Set<(env: PreviewEnv) => void>();

  constructor(
    private current: PreviewEnv,
    private readonly onError: (error: unknown, componentStack?: string | null) => void,
  ) {}

  get env(): PreviewEnv {
    return this.current;
  }

  update(env: PreviewEnv): void {
    this.current = env;
    for (const listener of [...this.listeners]) listener(env);
  }

  subscribe(listener: (env: PreviewEnv) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reportError(error: unknown, componentStack?: string | null): void {
    this.onError(error, componentStack);
  }

  resetListeners(): void {
    this.listeners = new Set();
  }
}
