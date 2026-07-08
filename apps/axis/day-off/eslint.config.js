import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Hebrew literal detection (Unicode block U+0590–U+05FF) — shared core rule (#7/#9):
// user-facing Hebrew must go through t(...), never a raw literal.
const HEBREW = '[\\u0590-\\u05FF]';
const noHebrewLiterals = [
  { selector: `Literal[value=/${HEBREW}/]`, message: 'מחרוזת עברית חייבת לעבור דרך t() — אסור ליטרל ישיר.' },
  { selector: `TemplateElement[value.raw=/${HEBREW}/]`, message: 'מחרוזת עברית חייבת לעבור דרך t() — אסור template ישיר.' },
  { selector: `JSXText[value=/${HEBREW}/]`, message: 'טקסט עברית ב-JSX חייב לעבור דרך t().' },
];
// catch-block rule (#9, from Tracker): every catch must log / throw / surface.
const catchMustHandle = {
  selector:
    "CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='handleError']))",
  message: 'כל catch חייב לקרוא ל-logger, לזרוק מחדש (throw), או להעביר ל-handleError.',
};

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-syntax': ['error', catchMustHandle, ...noHebrewLiterals],
    },
  },
  // logger owns console; i18n bundles & tests are exempt from the rules above.
  {
    files: ['src/utils/logger.ts', 'src/i18n/**', 'src/**/*.test.{ts,tsx}', 'src/setupTests.ts'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
);
