import { readdirSync } from 'node:fs';
import path from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60_000 });
  for (const file of readdirSync(__dirname)) {
    if (file.endsWith('.test.js')) {
      mocha.addFile(path.join(__dirname, file));
    }
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures > 0 ? reject(new Error(`${failures} integration test(s) failed`)) : resolve(),
    );
  });
}
