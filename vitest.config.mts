import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL('./test/unit/vscodeMock.ts', import.meta.url)) },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        'src/project/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
        'src/bundler/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
