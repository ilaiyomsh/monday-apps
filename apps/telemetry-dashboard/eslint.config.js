import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: ['public/**', 'node_modules/**', 'coverage/**'],
  },
  // Server (plain ESM JS, Node)
  {
    files: ['src/**/*.js', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  // Client seed/aggregate (plain ESM JS, browser) — shared with the server for
  // shape but authored as browser modules.
  {
    files: ['src/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Dashboard SPA (TypeScript + React)
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ['src/client/**/*.ts', 'src/client/**/*.tsx'],
  })),
  {
    files: ['src/client/**/*.ts', 'src/client/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
