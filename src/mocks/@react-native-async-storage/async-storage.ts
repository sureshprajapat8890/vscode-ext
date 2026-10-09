/**
 * RN Lens mock: @react-native-async-storage/async-storage backed by the preview's localStorage
 * (falling back to memory when storage is unavailable). Implements the full public API.
 */
type Callback<T = void> = (error?: Error | null, result?: T) => void;
type KeyValuePair = [string, string | null];

const PREFIX = 'rnlens:async-storage:';
const memory = new Map<string, string>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  const s = storage();
  return s ? s.getItem(PREFIX + key) : (memory.get(key) ?? null);
}

function write(key: string, value: string): void {
  const s = storage();
  if (s) s.setItem(PREFIX + key, value);
  else memory.set(key, value);
}

function remove(key: string): void {
  const s = storage();
  if (s) s.removeItem(PREFIX + key);
  else memory.delete(key);
}

function keys(): string[] {
  const s = storage();
  if (!s) return [...memory.keys()];
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
  }
  return out;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (
    !base ||
    !patch ||
    typeof base !== 'object' ||
    typeof patch !== 'object' ||
    Array.isArray(patch)
  ) {
    return patch;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v);
  }
  return out;
}

function merge(key: string, value: string): void {
  const existing = read(key);
  write(
    key,
    existing === null ? value : JSON.stringify(deepMerge(JSON.parse(existing), JSON.parse(value))),
  );
}

async function run<T>(fn: () => T, callback?: Callback<T>): Promise<T> {
  try {
    const result = fn();
    callback?.(null, result);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    callback?.(error);
    throw error;
  }
}

const AsyncStorage = {
  getItem: (key: string, cb?: Callback<string | null>) => run(() => read(key), cb),
  setItem: (key: string, value: string, cb?: Callback) => run(() => write(key, value), cb),
  removeItem: (key: string, cb?: Callback) => run(() => remove(key), cb),
  mergeItem: (key: string, value: string, cb?: Callback) => run(() => merge(key, value), cb),
  clear: (cb?: Callback) => run(() => keys().forEach(remove), cb),
  getAllKeys: (cb?: Callback<readonly string[]>) => run(() => keys(), cb),
  flushGetRequests: (): void => undefined,
  multiGet: (ks: readonly string[], cb?: Callback<readonly KeyValuePair[]>) =>
    run(() => ks.map((k): KeyValuePair => [k, read(k)]), cb),
  multiSet: (pairs: readonly [string, string][], cb?: Callback) =>
    run(() => pairs.forEach(([k, v]) => write(k, v)), cb),
  multiRemove: (ks: readonly string[], cb?: Callback) => run(() => ks.forEach(remove), cb),
  multiMerge: (pairs: readonly [string, string][], cb?: Callback) =>
    run(() => pairs.forEach(([k, v]) => merge(k, v)), cb),
};

export function useAsyncStorage(key: string) {
  return {
    getItem: (cb?: Callback<string | null>) => AsyncStorage.getItem(key, cb),
    setItem: (value: string, cb?: Callback) => AsyncStorage.setItem(key, value, cb),
    mergeItem: (value: string, cb?: Callback) => AsyncStorage.mergeItem(key, value, cb),
    removeItem: (cb?: Callback) => AsyncStorage.removeItem(key, cb),
  };
}

export default AsyncStorage;
