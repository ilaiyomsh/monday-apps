// ESLint FLAT config — the single source of truth for this app's lint rules.
//
// WHY THIS FILE EXISTS (foundation bug, found 2026-07-29 while retrofitting tests):
// this app pins eslint ^9, and ESLint 9 no longer reads the legacy `eslintConfig`
// block from package.json. The block was there, looked authoritative, and was
// entirely INERT — `pnpm lint` did not merely skip the rules, it exited 2 with
// "ESLint couldn't find an eslint.config.js file", so the app could never pass the
// repo's blocking CI lint step, and the error-guard rule (`no-restricted-syntax`
// on silent catch blocks) plus `no-console` were never enforced on a single line
// of this app's code. Sibling apps that still use the package.json block pin
// eslint 8 (apps/twyst-your-status); apps/telemetry-dashboard already uses a flat
// config like this one. The rules below are a faithful translation of the block
// that used to live in package.json — do not re-add it there.
//
// Note the CLI change that comes with flat config: `--ext` was removed in ESLint 9,
// so the `lint` script is plain `eslint .` and the `files` globs below are what
// bring .jsx into scope.
//
// Flat config also turns `reportUnusedDisableDirectives` on by default, which is why
// `pnpm lint` prints 4 warnings (0 errors, exit 0) for eslint-disable comments that
// sit in files where the disabled rule is switched off by an override below. Two of
// them are inside src/utils/logger.js, which is a VERBATIM copy of
// .claude/skills/monday-scaffold/templates/shared/utils/logger.js.template and must
// not be edited here — the directives are correct in apps that do not override the
// rule. Left as warnings on purpose: the audit is worth more than a clean screen.
import promise from 'eslint-plugin-promise';

// Browser + ES2022 globals actually referenced by this app. Kept explicit because
// the `globals` package is not a dependency here; the rule set below does not
// include `no-undef` (it comes from eslint:recommended, which this app never
// extended), so this list is documentation more than enforcement.
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  queueMicrotask: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  matchMedia: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  process: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: browserGlobals,
    },
    plugins: { promise },
    rules: {
      'no-console': ['error', { allow: ['info'] }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      // error-guard: a catch block must log through the logger, rethrow, or
      // display via showErrorWithDetails. The only sanctioned silent path is an
      // intentional AbortController cancel.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='showErrorWithDetails']))",
          message:
            'This catch block swallows the error silently. Do exactly one of: (1) call logger.error/logger.apiError(...) to record it, (2) re-throw it with `throw` so a boundary or an upstream catch handles it, or (3) call showErrorWithDetails(error, { functionName }) to record AND display it to the user. The only allowed silent path is an intentional AbortController cancel: `if (e.name === \'AbortError\') return;`.',
        },
      ],
      'promise/catch-or-return': 'error',
    },
  },
  // logger.js OWNS console rendering and the recursion-safe silent catches inside
  // its own sink/beforeSend plumbing.
  {
    files: ['src/utils/logger.js'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  // Tests, the vitest setup file and the dev harness are not product code.
  {
    files: [
      '**/__tests__/**',
      '**/*.test.js',
      '**/*.test.jsx',
      'src/test-utils/**',
      'src/setupTests.js',
      'src/dev-harness/**',
    ],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'promise/catch-or-return': 'off',
    },
  },
  // useUiErrorSink bridges logger records into the UI (its catch must not re-enter
  // the logger); vite.config.js is build tooling running under node.
  {
    files: ['src/hooks/useUiErrorSink.js', 'vite.config.js'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
