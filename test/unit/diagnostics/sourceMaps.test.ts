import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as esbuild from 'esbuild';
import { BundleSourceMap, parseStack } from '../../../src/diagnostics/sourceMaps';

describe('parseStack', () => {
  it('parses V8 frames with and without function names', () => {
    const stack = [
      'Error: boom',
      '    at Thrower (blob:vscode-webview://abc/1234:10:5)',
      '    at blob:vscode-webview://abc/1234:20:7',
      '    at async load (blob:vscode-webview://abc/1234:30:1)',
      '    at new Widget (https://x/y.js:1:2)',
      'not a frame',
    ].join('\n');
    expect(parseStack(stack)).toEqual([
      {
        functionName: 'Thrower',
        url: 'blob:vscode-webview://abc/1234',
        line: 10,
        column: 5,
        raw: 'at Thrower (blob:vscode-webview://abc/1234:10:5)',
      },
      {
        functionName: undefined,
        url: 'blob:vscode-webview://abc/1234',
        line: 20,
        column: 7,
        raw: 'at blob:vscode-webview://abc/1234:20:7',
      },
      {
        functionName: 'load',
        url: 'blob:vscode-webview://abc/1234',
        line: 30,
        column: 1,
        raw: 'at async load (blob:vscode-webview://abc/1234:30:1)',
      },
      {
        functionName: 'Widget',
        url: 'https://x/y.js',
        line: 1,
        column: 2,
        raw: 'at new Widget (https://x/y.js:1:2)',
      },
    ]);
  });
});

describe('BundleSourceMap', () => {
  const projectRoot = path.resolve('/proj');
  const outDir = path.join(projectRoot, '.rnlens', 'out');

  async function buildMap() {
    const result = await esbuild.build({
      stdin: {
        contents: [
          `import { helper } from './node_modules/lib/index.js';`,
          `export function Thrower() {`,
          `  return helper();`,
          `}`,
          `Thrower();`,
        ].join('\n'),
        sourcefile: path.join(projectRoot, 'src', 'Thrower.ts'),
        resolveDir: projectRoot,
        loader: 'ts',
      },
      plugins: [
        {
          name: 'virtual-lib',
          setup(b) {
            b.onResolve({ filter: /node_modules/ }, () => ({
              path: path.join(projectRoot, 'node_modules', 'lib', 'index.js'),
            }));
            b.onLoad({ filter: /.*/ }, () => ({
              contents: `export function helper() {\n  throw new Error('boom');\n}\n`,
              loader: 'js',
            }));
          },
        },
      ],
      bundle: true,
      write: false,
      format: 'iife',
      sourcemap: 'external',
      outfile: path.join(outDir, 'preview.js'),
      absWorkingDir: projectRoot,
    });
    const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
    const map = result.outputFiles.find((f) => f.path.endsWith('.map'))?.text ?? '';
    return { js, map };
  }

  /** 1-based line/column of `needle` in generated code. */
  function locate(js: string, needle: string): { line: number; column: number } {
    const lines = js.split('\n');
    const line = lines.findIndex((l) => l.includes(needle));
    return { line: line + 1, column: lines[line].indexOf(needle) + 1 };
  }

  it('maps blob frames to original files, marking user code', async () => {
    const { js, map } = await buildMap();
    const sm = new BundleSourceMap(map, outDir, projectRoot);
    const thrown = locate(js, 'throw new Error');
    const call = locate(js, 'return helper()');
    const frames = sm.mapStack(
      [
        'Error: boom',
        `    at helper (blob:vscode-webview://w/id:${thrown.line}:${thrown.column})`,
        `    at Thrower (blob:vscode-webview://w/id:${call.line}:${call.column})`,
        '    at https://other/script.js:1:1',
      ].join('\n'),
    );
    expect(frames[0]).toMatchObject({
      file: path.join(projectRoot, 'node_modules', 'lib', 'index.js'),
      line: 2,
      userCode: false,
    });
    expect(frames[1]).toMatchObject({
      file: path.join(projectRoot, 'src', 'Thrower.ts'),
      line: 3,
      column: 3,
      functionName: 'Thrower',
      userCode: true,
    });
    expect(frames[2]).toMatchObject({
      file: undefined,
      userCode: false,
      raw: 'at https://other/script.js:1:1',
    });
  });

  it('treats internal directories as non-user code and handles missing stacks', async () => {
    const { js, map } = await buildMap();
    const sm = new BundleSourceMap(map, outDir, projectRoot, [path.join(projectRoot, 'src')]);
    const call = locate(js, 'return helper()');
    expect(sm.mapStack(`at Thrower (blob:x:${call.line}:${call.column})`)[0].userCode).toBe(false);
    expect(sm.mapStack(undefined)).toEqual([]);
    expect(sm.mapStack(`at x (blob:x:9999:1)`)[0].file).toBeUndefined();
  });
});
