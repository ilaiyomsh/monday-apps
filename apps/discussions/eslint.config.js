// ESLint FLAT config (ESLint 9) — round337, audit finding #4.
//
// Until this round `pnpm lint` here was `echo no-lint-configured`: a stub that
// reported success while checking nothing, unregistered in any debt ledger. This
// config replaces it with a DELIBERATELY CURATED first rule set, not
// eslint:recommended wholesale — the goal is a gate that catches the bug classes
// this codebase has actually produced (dead identifiers, stray console calls,
// undefined globals) without flooding 74k existing lines with style noise.
//
// Rules NOT enabled, on purpose:
//  - `no-empty` / a silent-catch restriction: this app's sanctioned fail-soft
//    pattern is a catch whose body is ONLY a rationale comment (storage
//    unavailable → defaults). Comments are invisible to the AST, so those
//    documented catches would all flag as "empty". The error-guard HOOK (not
//    eslint) is what audits catch bodies here, and it reads comments.
//  - stylistic rules (quotes, semi, ordering): prettier-territory, zero bug value.
// Tightening beyond this set is welcome — do it rule by rule, with the whole
// suite green after each.

import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Browser globals this app actually references (espree has no `globals` dep
// here; mirrors the docs-export approach of an explicit, auditable list).
const browserGlobals = Object.fromEntries(
  [
    'window', 'document', 'navigator', 'console', 'fetch', 'localStorage',
    'sessionStorage', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'queueMicrotask', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver',
    'matchMedia', 'getComputedStyle', 'Blob', 'File', 'FileReader', 'FormData',
    'URL', 'URLSearchParams', 'AbortController', 'CustomEvent', 'Event',
    'Image', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'HTMLElement',
    'crypto', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'performance',
    'structuredClone', 'alert', 'globalThis', 'HTMLCanvasElement', 'OffscreenCanvas',
  ].map((g) => [g, 'readonly'])
);

export default [
  {
    ignores: ['build/**', 'dist/**', 'node_modules/**', 'public/**'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...browserGlobals,
        // Vite compile-time defines (vite.config.js `define:` block).
        __APP_VERSION__: 'readonly',
        __BUILD_SHA__: 'readonly',
        __IS_RELEASE__: 'readonly',
        // `process.env.NODE_ENV` survives in a few guards; Vite shims it.
        process: 'readonly',
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      // A conditional/looped hook call is a crash waiting for a render-order
      // change — the single highest-value React rule there is.
      'react-hooks/rules-of-hooks': 'error',
      // warn, not error: the codebase carries ~31 deliberate, commented
      // eslint-disable directives for this rule (dependency arrays trimmed on
      // purpose). Enabling the plugin is what makes those directives MEAN
      // something again — until now they referenced a rule that did not exist.
      'react-hooks/exhaustive-deps': 'warn',
      // Usage-linking only, NOT the plugin's style opinions: with plain espree a
      // `<DiscussionList />` does not count as a USE of the DiscussionList
      // import, so no-unused-vars flagged ~870 phantom "unused" imports. These
      // two rules teach the linter that JSX identifiers (and, under the classic
      // runtime this repo compiles with, the React import itself) are uses.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // The repo rule: never console.* in app code — everything goes through
      // logger.* or it skips the toast funnel and dedup. The single sanctioned
      // exception (the index.jsx version banner) carries an inline disable
      // with its rationale.
      'no-console': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // catch (err) kept for the logger call being the point of the catch —
        // an unused binding there is documentation, not debt.
        caughtErrors: 'none',
        // `const { dropMe, ...rest } = obj` — the omit idiom: the named binding
        // exists exactly to be excluded from `rest`.
        ignoreRestSiblings: true,
      }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
      'no-fallthrough': 'error',
      'no-unsafe-negation': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-var': 'error',
    },
  },
  {
    // logger.js IS the console transport — the one module whose console.* calls
    // are the sanctioned funnel endpoint everything else is told to use instead.
    files: ['src/utils/logger.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests get the vitest/jsdom extras; the no-console rule stays (tests log
    // through expect failures, not prints).
    files: ['src/**/__tests__/**', 'src/**/*.test.{js,jsx}', 'src/setupTests.js'],
    languageOptions: {
      globals: {
        global: 'writable',
        vi: 'readonly',
        ErrorEvent: 'readonly',
        PromiseRejectionEvent: 'readonly',
      },
    },
  },
  {
    // The dev harness and config files run under Node.
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly' },
    },
  },
];
