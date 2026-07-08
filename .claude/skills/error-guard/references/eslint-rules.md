# ESLint Enforcement Kit

The permanent, per-app anchor of error-guard (layer 3 of the three enforcement
layers — see SKILL.md). These rules run on every `lint`/CI pass and block the
build on any violation. The same rules are what the PostToolUse hook and the
ship gate invoke on edited/changed files, so a rule message is not just a
prohibition — **it is the remediation instruction the AI agent reads and
follows verbatim.** Write every custom message as "do X", not "X is forbidden".

This kit is proven in the Tracker reference app (`Axis/tracker/package.json`
`eslintConfig`). It grows that 3-rule set to 4 by adding
`promise/catch-or-return`, and adds one TypeScript-only rule.

---

## The 4 rules

### 1. `no-console` — `"error"`, no allow list

```json
"no-console": "error"
```

No `{ allow: [...] }`. Every diagnostic goes through the logger, never the raw
console. The logger file itself is the only place `console.*` is legitimate, and
that is handled by the override (below), not by an allow list — an allow list
would leak console calls into every file.

### 2. `no-empty` — forbid empty blocks including empty catch

```json
"no-empty": ["error", { "allowEmptyCatch": false }]
```

`allowEmptyCatch: false` is the load-bearing option. The rule's default
(`allowEmptyCatch: false` is the default, but state it explicitly so it survives
config merges) makes `catch (e) {}` an error. An empty catch is the canonical
silent swallow: an error was caught and then discarded. Every catch must do
something observable — rule 3 says exactly what.

### 3. `catch-must-log` — every catch logs, throws, or displays (`no-restricted-syntax`)

The exact selector proven in Tracker. Do not rewrite the selector — copy it
byte-for-byte:

```json
"no-restricted-syntax": [
  "error",
  {
    "selector": "CatchClause > BlockStatement:not(:has(CallExpression[callee.object.name='logger'])):not(:has(ThrowStatement)):not(:has(CallExpression[callee.name='showErrorWithDetails']))",
    "message": "This catch block swallows the error silently. Do exactly one of: (1) call logger.error/logger.apiError(...) to record it, (2) re-throw it with `throw` so a boundary or an upstream catch handles it, or (3) call showErrorWithDetails(error, { functionName }) to record AND display it to the user. The only allowed silent path is an intentional AbortController cancel: `if (e.name === 'AbortError') return;`."
  }
]
```

**How the selector works:** it matches a `CatchClause`'s block that contains
*none* of three things: a call whose callee object is named `logger`
(`logger.error(...)`, `logger.apiError(...)`, …), a `throw` statement, or a call
to `showErrorWithDetails`. A matching block is therefore a catch that neither
logs, re-throws, nor displays — a silent swallow — and is flagged.

**Message = remediation instruction.** The message above is written as three
numbered actions the agent can execute directly, plus the single sanctioned
escape hatch. This is the whole point of `no-restricted-syntax`: it accepts a
custom message per selector, and that message is the fix instruction the agent
sees in the hook, in CI, and in the ship gate.

**Per-project extension of the display/log helper names.** If an app's display
facade is not called `showErrorWithDetails`, or its logger object is not named
`logger`, adjust the three `:not(:has(...))` clauses to match the real names
(e.g. `callee.name='showError'`). Keep the shape identical; only swap the
identifiers. The Tracker names (`logger`, `showErrorWithDetails`) are the names
the kit assumes: `logger` is defined by `templates/logger.js`, but no template
defines `showErrorWithDetails` — the display facade itself is adapted per app
from Tracker's reference implementation (`Axis/tracker/src/utils/errorHandler.js`).
An app installed purely from the templates should either add such a facade or
drop the third `:not(:has(...))` clause until it exists.

### 4. `promise/catch-or-return` — no floating `.then()` chains (new dependency)

```json
"promise/catch-or-return": "error"
```

From **`eslint-plugin-promise`** (a new devDependency — see install below).
Works **without type information**, so it fits plain-JS monday apps where
`@typescript-eslint/no-floating-promises` cannot run. Every `.then()` chain must
either terminate in a `.catch()` or be `return`ed (handing rejection
responsibility to the caller).

**Keep `allowThen` OFF (the default).** Do not enable it. With `allowThen: true`
the two-argument form `then(onFulfilled, onRejected)` counts as "handled" — but
that rejection handler only catches rejections of the *previous* promise; it
does **not** catch a throw from `onFulfilled` itself. That throw becomes an
unhandled rejection. Leaving `allowThen` off forces a trailing `.catch()`, which
does catch throws from the fulfillment callback. This is why the default is
correct and must not be relaxed.

Default `catch-or-return` also flags the two-arg `then(ok, err)` form for the
same reason — that is intended; rewrite it as `.then(ok).catch(err)`.

---

## TypeScript-only addition — `@typescript-eslint/no-floating-promises`

For TypeScript projects only (requires type-aware linting — a `parserOptions`
project/type-checked config):

```json
"@typescript-eslint/no-floating-promises": ["error", { "ignoreVoid": false }]
```

This rule targets the floating-promise class directly and, because it has type
information, catches the **bare async call** that `catch-or-return` cannot see
(a call with no `.then` and no `await`). It accepts five handlings by default:
`.catch()`, `.then(_, onRejected)`, `await`, `return`, or `void` — but with the
mandatory `ignoreVoid: false` above, `void` no longer counts, leaving four.

**Why `ignoreVoid: false` is mandatory.** The default `ignoreVoid: true` lets
`void somePromise()` silence the rule *without actually handling the
rejection* — the promise still floats, `void` just discards the returned value.
An AI agent optimizing to make the linter pass **will** discover this and prefix
floating calls with `void`. Setting `ignoreVoid: false` closes that loophole:
`void` no longer counts as handling, so the agent must add a real `.catch()`,
`await` in a try/catch, or `return`. Only turn this rule on where type info is
available; it errors out on plain-JS configs.

---

## Documented residual hole (plain JS)

In a plain-JS project there is **no static rule that catches a bare async
call** — `doAsyncThing()` as its own statement, with no `.then` and no `await`.
`promise/catch-or-return` only sees `.then()` chains; closing this class needs
type information, which only `no-floating-promises` (TypeScript) has.

The net for this hole is **runtime, not static**: the global
`unhandledrejection` handler installed by `templates/globalErrorHandler.js`
catches the rejection when it floats. This is why that handler is
non-negotiable. Because static analysis cannot cover it, **the bare async call
is checked manually in audits** (`audit.sh` counts likely call sites; a human
confirms). A per-project heuristic `no-restricted-syntax` selector for known
async surfaces (e.g. a bare `ExpressionStatement` calling `safeApi` or a storage
helper) can be added where the async surface is small and named, but that is
opt-in per app, not part of the standard kit.

---

## Standard overrides (rules turned OFF where they are wrong)

Three categories of file are exempt. These mirror the Tracker overrides exactly;
only the paths are generalized.

1. **The logger file itself** — the one place raw `console.*` is legitimate (it
   is the sink of last resort), and it re-throws/handles in ways the catch rule
   would flag. Turn off `no-console` and `no-restricted-syntax` there.

2. **Test files and test directories** — tests deliberately `console.log`,
   deliberately write empty or throwing catches to exercise error paths, and
   assert on them. Turn off `no-console` and `no-restricted-syntax`. Cover
   `**/__tests__/**`, `**/*.test.{js,jsx,ts,tsx}`, a shared `test-utils`
   directory, and the test setup file.

3. **Sink files** — a remote/observability sink (Tracker's `axiomSink.js`) and
   build config (`vite.config.js`) legitimately use `console` as their transport
   of last resort and do not follow the catch contract. Turn off `no-console`
   and `no-restricted-syntax` for the named sink file(s) and build config.

Note: `no-empty` and `promise/catch-or-return` are **not** turned off in the
overrides — an empty block or a floating promise is a bug even in these files.
Only the two console/catch rules are relaxed.

---

## Install — package.json `eslintConfig` style (like Tracker)

1. Add the devDependency:

   ```bash
   pnpm add -D eslint-plugin-promise
   ```

2. Merge `templates/eslint-error-rules.json` into the app's
   `package.json` `"eslintConfig"` block: its `rules` into `eslintConfig.rules`,
   its `overrides` into `eslintConfig.overrides`, and add `"promise"` to
   `eslintConfig.plugins`. Tracker's block (`extends: "react-app"`) is the
   working reference. Generalize the override paths to the app's real logger and
   sink file locations.

3. Verify the lint script actually covers the tree — two silent-coverage traps
   (both hit live while validating the scaffold integration):
   - `eslint .` (eslintrc style, ESLint 8) lints **only `.js` files** by
     default — every `.jsx` file is silently skipped and the kit never runs on
     components. Use `eslint . --ext .js,.jsx` (add `,.ts,.tsx` for TS apps).
   - Without an ignore entry, `eslint .` also lints `dist/`/`build/` bundles
     after the first build, producing false catch-must-log/no-console hits.
     Add `"ignorePatterns": ["dist", "build", "coverage"]` to `eslintConfig`
     (or an `.eslintignore`).
   Prove coverage the test-guard way: drop a temporary swallowing catch in a
   `.jsx` component, see the lint go red, revert.

4. For a TypeScript app, also add
   `@typescript-eslint/no-floating-promises` (see above) to `rules` — it
   requires the type-checked parser config, which `react-app` alone does not
   provide.

## Install — flat config (`eslint.config.js`) style

Flat config (ESLint 9 default) uses an array of config objects and imports
plugins as modules — there is no string `"plugins": ["promise"]`; you import the
plugin and register it under a namespace.

```js
// eslint.config.js
import promise from 'eslint-plugin-promise';

export default [
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { promise },
    rules: {
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
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
  // Override 1 — logger file
  {
    files: ['src/utils/logger.js'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
  // Override 2 — tests
  {
    files: [
      '**/__tests__/**',
      '**/*.test.{js,jsx,ts,tsx}',
      'src/test-utils/**',
      'src/setupTests.js',
    ],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
  // Override 3 — sink files + build config
  {
    files: ['src/utils/*Sink.js', 'vite.config.js'],
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
];
```

For a TypeScript flat config, add `typescript-eslint`'s type-checked config and
a rules entry `'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }]`.

---

## Cross-references

- Runtime net for the residual hole and the `unhandledrejection` handler:
  `templates/globalErrorHandler.js`.
- The one-error-one-toast display contract the `showErrorWithDetails` clause
  depends on: `templates/useUiErrorSink.js` and `references/standard.md`.
- monday API soft-error-in-200 → throw conversion (why the catch rule has real
  errors to catch): `monday-api` skill and `references/catch-patterns.md`.
