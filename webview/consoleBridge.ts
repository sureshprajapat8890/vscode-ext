import type { ConsoleLevel } from '../src/preview/protocol';

const MAX_DEPTH = 4;
const MAX_MESSAGE_CHARS = 10 * 1024;
const LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/** Messages react-native-web prints on every run, which would drown out the user's own logs. */
const NOISE = [/^Running application "RNLensPreview"/];

/**
 * Renders a console argument as text: handles cycles, functions, Errors, DOM nodes and depth
 * limits, and never throws (getters that throw are reported inline).
 */
export function serialize(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return depth === 0 ? value : JSON.stringify(value);
    case 'undefined':
      return 'undefined';
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name || 'anonymous'}]`;
  }
  const obj = value as object;
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  // DOM nodes (duck-typed so this module also runs outside a browser, e.g. in unit tests).
  const maybeNode = obj as { nodeType?: unknown; nodeName?: unknown };
  if (typeof maybeNode.nodeType === 'number' && typeof maybeNode.nodeName === 'string') {
    return `[${maybeNode.nodeName}]`;
  }
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';
  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => serialize(v, depth + 1, seen)).join(', ')}]`;
    }
    if (value instanceof Map) {
      const entries = [...value].map(
        ([k, v]) => `${serialize(k, depth + 1, seen)} => ${serialize(v, depth + 1, seen)}`,
      );
      return `Map(${value.size}) {${entries.join(', ')}}`;
    }
    if (value instanceof Set) {
      return `Set(${value.size}) {${[...value].map((v) => serialize(v, depth + 1, seen)).join(', ')}}`;
    }
    const ctor = (obj.constructor as { name?: string } | undefined)?.name;
    const prefix = ctor && ctor !== 'Object' ? `${ctor} ` : '';
    const parts = Object.keys(obj).map((key) => {
      let rendered: string;
      try {
        rendered = serialize((obj as Record<string, unknown>)[key], depth + 1, seen);
      } catch (err) {
        rendered = `[Thrown: ${err instanceof Error ? err.message : String(err)}]`;
      }
      return `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${rendered}`;
    });
    return `${prefix}{${parts.join(', ')}}`;
  } finally {
    seen.delete(obj);
  }
}

/** Formats console arguments like `console.log` does (no format specifiers), capped at 10 KB. */
export function formatArgs(args: readonly unknown[]): string {
  const text = args.map((a) => serialize(a)).join(' ');
  return text.length > MAX_MESSAGE_CHARS
    ? `${text.slice(0, MAX_MESSAGE_CHARS)}… (truncated)`
    : text;
}

/**
 * Wraps console methods so every call is forwarded (as text) to `send`, while still reaching the
 * original console for the webview's own DevTools.
 */
export function installConsoleBridge(send: (level: ConsoleLevel, text: string) => void): void {
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      let text: string;
      try {
        text = formatArgs(args);
      } catch {
        text = '[unserializable console message]';
      }
      if (!NOISE.some((re) => re.test(text))) send(level, text);
    };
  }
}
