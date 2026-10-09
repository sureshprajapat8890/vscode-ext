import { readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { evaluate, formatTable, type BenchResults } from './report';

/** Launches VS Code on the Expo fixture, runs the bench suite in it, and prints the NFR table. */
async function main(): Promise<void> {
  // Bundled to out/test/bench/runBench.js, so the repo root is three levels up.
  const repoRoot = path.resolve(__dirname, '../../..');
  const fixture = path.join(repoRoot, 'test', 'fixtures', 'expo-app');
  const resultsFile = path.join(os.tmpdir(), `rnlens-bench-${process.pid}.json`);
  // When launched from a VS Code terminal this variable leaks in and makes the editor start as Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.env.RNLENS_BENCH_OUT = resultsFile;
  try {
    await runTests({
      version: process.env.VSCODE_TEST_VERSION ?? 'stable',
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      launchArgs: [fixture, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (err) {
    console.error('The benchmark run failed:', err);
    process.exit(1);
  }
  const results = JSON.parse(readFileSync(resultsFile, 'utf8')) as BenchResults;
  rmSync(resultsFile, { force: true });
  const rows = evaluate(results);
  console.log(`\nRN Lens NFR benchmark (${results.environment})\n`);
  console.log(formatTable(rows));
  console.log('');
  for (const note of results.notes) console.log(`- ${note}`);
  const failed = rows.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} target(s) missed: ${failed.map((r) => r.metric).join(', ')}`);
    process.exit(1);
  }
}

void main();
