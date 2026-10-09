import type { SimulatedPlatform } from '../types';

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const PLAIN_EXTENSIONS = [...SOURCE_EXTENSIONS, '.mjs', '.cjs', '.json'];

/**
 * esbuild `resolveExtensions` for a simulated platform, most specific first:
 * `.web.*` (the preview really runs on web), then `.<platform>.*`, then `.native.*`, then plain.
 * When simulating `web`, native-specific files are never picked.
 */
export function resolveExtensionsFor(platform: SimulatedPlatform): string[] {
  const suffixes = platform === 'web' ? ['web'] : ['web', platform, 'native'];
  return [
    ...suffixes.flatMap((s) => SOURCE_EXTENSIONS.map((ext) => `.${s}${ext}`)),
    ...PLAIN_EXTENSIONS,
  ];
}
