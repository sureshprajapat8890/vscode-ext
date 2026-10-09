// Builds the extension host and webview bundles (or, with --tests, the integration test bundles).
import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const tests = args.has('--tests');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // esbuild is loaded lazily at runtime from node_modules (it ships native binaries).
  external: ['vscode', 'esbuild'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: { webview: 'webview/main.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const testOptions = {
  entryPoints: [
    'test/integration/runTest.ts',
    'test/integration/suite/index.ts',
    ...readdirSync('test/integration/suite')
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => path.posix.join('test/integration/suite', f)),
  ],
  outdir: 'out/test/integration',
  outbase: 'test/integration',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode', 'mocha', '@vscode/test-electron'],
  sourcemap: true,
  logLevel: 'info',
};

const builds = tests ? [testOptions] : [extensionOptions, webviewOptions];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
