import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/unit/vscodeMock.ts', import.meta.url)),
      // The webview runtime's React (tests render runtime helpers with react-dom/server).
      react: fileURLToPath(new URL('./vendor/node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./vendor/node_modules/react-dom', import.meta.url)),
    },
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
