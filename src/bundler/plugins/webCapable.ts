import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { isRedirected, redirect, resolveRaw } from './redirect';

const ENTRY_FIELDS = ['browser', 'module', 'main'] as const;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * For packages whose `react-native` entry is native-only but which ship a web build, resolves the
 * bare package import through `browser` → `module` → `main` instead of the global main fields.
 * Sub-path imports are left to esbuild.
 */
export function webCapablePlugin(packages: readonly string[]): Plugin {
  return {
    name: 'rnlens-web-capable',
    setup(build) {
      if (packages.length === 0) return;
      const filter = new RegExp(`^(?:${packages.map(escapeRegExp).join('|')})$`);
      build.onResolve({ filter }, async (args) => {
        if (isRedirected(args)) return undefined;
        const pkgJson = await resolveRaw(
          build,
          `${args.path}/package.json`,
          args.resolveDir,
          args.kind,
        );
        if (pkgJson.errors.length > 0) return undefined;
        let manifest: Record<string, unknown>;
        try {
          manifest = JSON.parse(await readFile(pkgJson.path, 'utf8')) as Record<string, unknown>;
        } catch {
          return undefined;
        }
        const entry = ENTRY_FIELDS.map((f) => manifest[f]).find(
          (v): v is string => typeof v === 'string',
        );
        if (!entry) return undefined;
        const target = entry.startsWith('.') ? entry : `./${entry}`;
        return redirect(build, args, target, path.dirname(pkgJson.path));
      });
    },
  };
}
