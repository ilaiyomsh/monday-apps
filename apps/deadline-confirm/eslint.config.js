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
  // Admin SPA (TypeScript + React)
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
  // Tests (vitest, Node)
  {
    files: ['tests/**/*.js', 'tests/**/*.ts'],
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
      // supertest's dynamic-verb dispatch (`request(app)\n[method](path)`) is
      // deliberate bracket access, not an ASI hazard.
      'no-unexpected-multiline': 'off',
    },
  },
];
