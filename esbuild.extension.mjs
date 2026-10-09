// Builds the extension host and webview bundles (or, with --tests / --bench, the integration test
// or benchmark bundles).
import * as esbuild from 'esbuild';
import { cpSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const watch = args.has('--watch');
const tests = args.has('--tests');
const bench = args.has('--bench');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // Loaded lazily at runtime from node_modules: esbuild ships native binaries, and
  // flow-remove-types pulls in a multi-megabyte parser only needed for Flow-typed packages.
  external: ['vscode', 'esbuild', 'flow-remove-types'],
  // Marks when VS Code starts evaluating the bundle, so activation time includes module loading.
  banner: { js: 'globalThis.__RNLENS_LOAD_START__ = performance.now();' },
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

/** @type {import('esbuild').BuildOptions} */
const benchOptions = {
  ...testOptions,
  entryPoints: ['test/bench/runBench.ts', 'test/bench/suite.ts'],
  outdir: 'out/test/bench',
  outbase: 'test/bench',
};

const builds = tests ? [testOptions] : bench ? [benchOptions] : [extensionOptions, webviewOptions];

/**
 * Preview runtime and built-in mocks are bundled into each preview by the user's esbuild context,
 * so they ship as source next to the extension bundle.
 */
function copyPreviewSources() {
  cpSync('webview/runtime', 'dist/runtime', { recursive: true });
  cpSync('src/mocks', 'dist/mocks', {
    recursive: true,
    filter: (src) =>
      path.basename(src) !== 'index.ts' || path.dirname(src) !== path.normalize('src/mocks'),
  });
}

if (!tests && !bench) {
  // Start from an empty dist/ so nothing stale (e.g. a dev build's source map) gets packaged.
  rmSync('dist', { recursive: true, force: true });
  copyPreviewSources();
}

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
