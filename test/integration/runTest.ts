import path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Bundled to out/test/integration/runTest.js, so the repo root is three levels up.
  const repoRoot = path.resolve(__dirname, '../../..');
  const fixture = path.join(repoRoot, 'test', 'fixtures', 'expo-app');
  // When launched from a VS Code terminal this variable leaks in and makes the test instance
  // start as plain Node instead of the editor.
  delete process.env.ELECTRON_RUN_AS_NODE;
  try {
    await runTests({
      version: process.env.VSCODE_TEST_VERSION ?? 'stable',
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath: path.join(__dirname, 'suite', 'index.js'),
      launchArgs: [fixture, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  }
}

void main();
