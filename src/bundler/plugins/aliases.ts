import path from 'node:path';
import type { Plugin } from 'esbuild';
import type { SimulatedPlatform } from '../types';
import { findPlatformVariant } from './platformExtensions';
import { isRedirected, redirect } from './redirect';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const inNodeModules = (file: string): boolean => file.split(/[\\/]/).includes('node_modules');

/**
 * Applies module aliases (Babel module-resolver, `rnLens.extraAliases`, rnlens.config.js):
 * `alias` and `alias/rest` map to the target path (absolute) or package. Aliased imports into the
 * project's own code get the same `.ios` / `.android` / `.native` resolution as relative imports.
 * Longer aliases win over shorter prefixes.
 */
export function aliasesPlugin(
  aliases: Readonly<Record<string, string>>,
  projectRoot: string,
  platform: SimulatedPlatform,
): Plugin {
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  return {
    name: 'rnlens-aliases',
    setup(build) {
      if (keys.length === 0) return;
      const filter = new RegExp(`^(?:${keys.map(escapeRegExp).join('|')})(?:/.*)?$`);
      build.onResolve({ filter }, (args) => {
        if (isRedirected(args)) return undefined;
        const key = keys.find((k) => args.path === k || args.path.startsWith(`${k}/`));
        if (!key) return undefined;
        const rest = args.path.slice(key.length);
        const target = aliases[key];
        if (!path.isAbsolute(target)) {
          // Alias to another package, e.g. { "lodash": "lodash-es" }.
          return redirect(build, args, `${target}${rest}`, projectRoot);
        }
        const base = path.join(target, rest);
        if (platform !== 'web' && !inNodeModules(base)) {
          const variant = findPlatformVariant(base, platform);
          if (variant) return { path: variant };
        }
        return redirect(build, args, base, projectRoot);
      });
    },
  };
}
