import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Recurrence guard for Finding 0: every Hebrew UI string in src/hooks/**
  // and src/components/** must go through i18next t(...) instead of being
  // hardcoded. Locale bundles, tests, and test utilities are exempt.
  {
    files: ['src/hooks/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: [
      'src/**/__tests__/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/i18n/locales/**',
      'src/test-utils/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/[\\u0590-\\u05FF]/]",
          message:
            'Hebrew string literals must go through i18next t(...). Add the key under src/i18n/locales/he/translation.json (and en/) and call t(\'…\') instead.',
        },
        {
          selector: "TemplateElement[value.raw=/[\\u0590-\\u05FF]/]",
          message:
            'Hebrew template strings must go through i18next t(...). Add a key with {{interpolation}} under src/i18n/locales/.',
        },
      ],
    },
  },
  // Design-tokens guard: hex color literals must live in src/styles/tokens.css.
  // Exemptions:
  //   - src/utils/colorUtils.ts — reads palette via getComputedStyle and runs
  //     YIQ contrast math; needs literal "#000"/"#fff" math outputs.
  //   - src/utils/Logger.ts     — uses hex for console %c styling (not UI).
  //   - tests, locales, test-utils.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/utils/colorUtils.ts',
      'src/utils/Logger.ts',
      'src/**/__tests__/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/i18n/locales/**',
      'src/test-utils/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/[\\u0590-\\u05FF]/]",
          message:
            'Hebrew string literals must go through i18next t(...). Add the key under src/i18n/locales/he/translation.json (and en/) and call t(\'…\') instead.',
        },
        {
          selector: "TemplateElement[value.raw=/[\\u0590-\\u05FF]/]",
          message:
            'Hebrew template strings must go through i18next t(...). Add a key with {{interpolation}} under src/i18n/locales/.',
        },
        {
          // Catches hex anywhere inside a string literal — including
          // Tailwind arbitrary values like `bg-[#0073ea]`.
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]",
          message:
            'Hex color literals must live in src/styles/tokens.css. Use a CSS variable (var(--color-…)) or the matching Tailwind utility instead.',
        },
        {
          selector: "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]",
          message:
            'Hex color literals must live in src/styles/tokens.css. Use a CSS variable (var(--color-…)) or the matching Tailwind utility instead.',
        },
      ],
    },
  },
])
