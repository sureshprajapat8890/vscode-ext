import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'coverage/**',
      'vendor/**',
      '.vscode-test/**',
      'test/fixtures/**',
      'test/unit/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Mocks mirror real APIs, so some parameters are deliberately unused (prefixed with _).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['webview/**/*.ts', 'webview/**/*.tsx', 'src/mocks/**/*.ts', 'src/mocks/**/*.tsx'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
