import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Files Expo loads for development, lowest precedence first. */
const DOTENV_FILES = ['.env', '.env.development', '.env.local', '.env.development.local'];

/**
 * Parses dotenv text: `KEY=value`, optional `export ` prefix, `#` comments, single/double quotes
 * (double-quoted values support \n escapes). Never evaluates anything.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export function readDotenv(projectRoot: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of DOTENV_FILES) {
    const text = readText(path.join(projectRoot, name));
    if (text !== undefined) Object.assign(env, parseDotenv(text));
  }
  return env;
}

/** The `expo` section of app.json, or null (bare apps, app.config.js-only projects, bad JSON). */
export function readExpoConfig(projectRoot: string): Record<string, unknown> | null {
  const text = readText(path.join(projectRoot, 'app.json'));
  if (text === undefined) return null;
  try {
    const json: unknown = JSON.parse(text);
    const expo = (json as { expo?: unknown } | null)?.expo;
    return expo && typeof expo === 'object' && !Array.isArray(expo)
      ? (expo as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Build-time `define`s exposing project config to previewed code and built-in mocks. */
export function projectDefines(projectRoot: string): Record<string, string> {
  const dotenv = readDotenv(projectRoot);
  const defines: Record<string, string> = {
    __RNLENS_EXPO_CONFIG__: JSON.stringify(readExpoConfig(projectRoot)),
    __RNLENS_DOTENV__: JSON.stringify(dotenv),
  };
  for (const [key, value] of Object.entries(dotenv)) {
    if (/^EXPO_PUBLIC_[A-Za-z0-9_]+$/.test(key)) {
      defines[`process.env.${key}`] = JSON.stringify(value);
    }
  }
  return defines;
}
