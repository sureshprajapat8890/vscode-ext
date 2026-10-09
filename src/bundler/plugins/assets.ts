import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { imageSize } from '../imageSize';

export const INLINE_LIMIT_BYTES = 100 * 1024;

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const FONT_EXT = /\.(?:ttf|otf|woff2?)$/i;
const SCALE_SUFFIX = /@(\d+(?:\.\d+)?)x(\.[^.]+)$/;
const DENSITIES = [4, 3, 2, 1.5, 1];

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * For `./img.png`, the highest-density variant that exists (`img@3x.png`, `img@2x.png`, … then
 * `img.png`). Explicit `@Nx` paths and missing files are returned unchanged.
 */
export function pickDensity(file: string, exists: (f: string) => boolean = existsSync): string {
  if (SCALE_SUFFIX.test(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  for (const d of DENSITIES) {
    const candidate = d === 1 ? file : `${base}@${d}x${ext}`;
    if (exists(candidate)) return candidate;
  }
  return file;
}

export function scaleOf(file: string): number {
  const m = SCALE_SUFFIX.exec(file);
  return m ? Number(m[1]) : 1;
}

export interface AssetsOptions {
  /** Where assets over the inline limit are copied; served to the webview from there. */
  cacheDir: string;
}

/**
 * Images become React Native asset objects `{ uri, width, height }` (logical size, i.e. pixels
 * divided by the `@Nx` density); fonts become a URL string, which is what expo-font accepts on web.
 * Files up to 100 KB are inlined as data URLs; larger ones are copied to the cache directory and
 * addressed relative to `globalThis.__RNLENS_ASSET_BASE__`, set by the webview.
 */
export function assetsPlugin(options: AssetsOptions): Plugin {
  return {
    name: 'rnlens-assets',
    setup(build) {
      build.onResolve({ filter: IMAGE_EXT }, (args) => {
        if (
          args.namespace !== 'file' ||
          !(args.path.startsWith('.') || path.isAbsolute(args.path))
        ) {
          return undefined;
        }
        const requested = path.resolve(args.resolveDir, args.path);
        const chosen = pickDensity(requested);
        return chosen === requested && !existsSync(requested) ? undefined : { path: chosen };
      });

      build.onLoad({ filter: IMAGE_EXT }, async (args) => {
        const bytes = await readFile(args.path);
        const size = imageSize(bytes);
        const scale = scaleOf(args.path);
        const uri = await assetUri(args.path, bytes, options.cacheDir);
        const width = size ? Math.round((size.width / scale) * 100) / 100 : undefined;
        const height = size ? Math.round((size.height / scale) * 100) / 100 : undefined;
        return {
          contents: `module.exports = { uri: ${uri}, width: ${JSON.stringify(width)}, height: ${JSON.stringify(height)}, scale: ${scale} };`,
          loader: 'js',
          watchFiles: [args.path],
        };
      });

      build.onLoad({ filter: FONT_EXT }, async (args) => {
        const bytes = await readFile(args.path);
        const uri = await assetUri(args.path, bytes, options.cacheDir);
        return { contents: `module.exports = ${uri};`, loader: 'js', watchFiles: [args.path] };
      });
    },
  };
}

/** A JS expression evaluating to the asset's URL. */
async function assetUri(file: string, bytes: Buffer, cacheDir: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (bytes.length <= INLINE_LIMIT_BYTES) {
    const mime = MIME[ext] ?? 'application/octet-stream';
    return JSON.stringify(`data:${mime};base64,${bytes.toString('base64')}`);
  }
  const info = await stat(file);
  const name = `${createHash('sha1').update(`${file}\0${info.mtimeMs}\0${info.size}`).digest('hex')}${ext}`;
  const target = path.join(cacheDir, name);
  if (!existsSync(target)) {
    await mkdir(cacheDir, { recursive: true });
    await copyFile(file, target);
  }
  return `globalThis.__RNLENS_ASSET_BASE__ + ${JSON.stringify(`/${name}`)}`;
}
