// Builds the extension host bundle (and, with --tests, the integration test bundles).
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
  external: ['vscode', 'esbuild'],
  sourcemap: !production,
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

const options = tests ? testOptions : extensionOptions;

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
