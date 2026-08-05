# Template drift — observed defects and the monorepo reconciliation list

Non-RTL drift between `templates/` and what the `monday-apps` monorepo actually
ships. RTL traps live in `rtl-css-checklist.md`; this page is for everything else.

Every entry is something a real scaffold run hit. Fix the template, then record here.

---

## FIXED 2026-07-29 — `logger.error()` dropped its `context` argument

**Observed** while scaffolding `apps/docs-export` (board_view).

`templates/shared/utils/logger.js.template` declared:

```js
error: (module, message, error = null) => { … }   // 3 params
```

but `templates/shared/components/ErrorBoundary/AppErrorBoundary.jsx.template`
calls it with **four**:

```js
logger.error(`ErrorBoundary:${scope}`, 'render_error', error, {
  componentStack: info?.componentStack,
});
```

**Why it mattered:** the 4th argument was silently discarded, so `record.context`
was never set. `@mapps/error-kit`'s browser Axiom sink reads the React component
tree from **`record.context.componentStack` and nowhere else** — so every render
crash shipped from a freshly scaffolded app arrived in Axiom with no component
tree. Nothing threw, nothing logged a warning, and the local console still looked
correct (the boundary's fallback screen rendered fine), which is why this survived
into at least one live app before being noticed.

It is also invisible to `scripts/error-wiring-audit.mjs`: that gate checks the
`setupGlobalErrorHandlers(` / `attachAxiomSink(` call forms and boundary presence,
not the arity of a logger method.

**Resolution:** the template's `error()` now takes `(module, message, error, context)`
and forwards `context: context || undefined` into `emit`, matching the live logger in
`apps/team-people-column/src/utils/logger.js:549`. The doc comment on the parameter
names the boundary as the required consumer so the argument is not "simplified" away
again.

**Regression check for a new scaffold:**

```bash
grep -n "error: (module, message, error = null, context = null)" src/utils/logger.js
```

No hit ⇒ the app has the pre-fix template; patch it before shipping.

---

## TRAP 2026-07-29 — `package.json` `eslintConfig` goes INERT on ESLint 9

**Observed** while onboarding `apps/docs-export`.

`templates/shared/package.json.template` carries the error-guard rule kit as a
`"eslintConfig"` block and pins `eslint ^8.57.1`. That combination works. But the
monorepo's standard is **ESLint 9** (the root `package.json` pins `eslint 9.39.4`), and
**ESLint 9 removed support for the `package.json` `eslintConfig` key entirely.**

Bumping the app to eslint 9 while keeping the block does not degrade gracefully:

```
$ pnpm --filter ./apps/<name> lint
ESLint couldn't find an eslint.config.js file.
$ echo $?
2
```

Two consequences, both silent until something else surfaces them:

1. **The app can never pass CI.** `.github/workflows/ci.yml` runs
   `pnpm -r --if-present run lint` as a **blocking** step, and this app exits 2.
2. **The whole error-guard rule kit is inert.** The `no-restricted-syntax`
   silent-catch selector and `no-console` never execute on a single line. The app
   *looks* protected — the rules are right there in `package.json` — while nothing
   enforces them.

**Resolution when targeting eslint 9:** translate the block into a flat
`eslint.config.js` at the app root (same rules, same override groups), delete the now-dead
`eslintConfig` block so there is one source of truth, and change the script to
`"lint": "eslint ."` — `--ext` was also removed in ESLint 9. In-repo precedents to copy:
`apps/telemetry-dashboard`, `apps/axis/planner`, `apps/axis/day-off`, `apps/deadline-confirm`.
`apps/team-people-column` still uses the `package.json` block **legitimately**, because it
pins eslint 8.

**Do not trust a green `lint` as proof the rules ran.** Verify with a deliberate fixture:

```bash
# a file with a silent catch AND a console.log must produce exactly two errors
printf 'try { JSON.parse("x"); } catch (e) { }\nconsole.log(1);\n' > /tmp/_eg_probe.js
cp /tmp/_eg_probe.js src/_eg_probe.js && pnpm lint; rm -f src/_eg_probe.js
```

Exit 0 with no findings means the config is not loading.

**Flat-config side effect:** `reportUnusedDisableDirectives` is on by default, so
`eslint-disable` comments in files whose override already disables that rule become
warnings. Leave them — several sit in `src/utils/logger.js`, which must stay
byte-identical to this skill's template.

---

## KNOWN GAP — the templates lag the monorepo's client stack

The scaffold generates a **standalone** app. Onboarding it into `monday-apps`
(`monday-cicd` Mode 3 → Mode 2) requires a reconciliation pass. As of 2026-07-29,
measured against `apps/team-people-column` and `apps/discussions`:

| Template ships | Monorepo standard | Why it matters |
|---|---|---|
| React 18, `@vibe/core` `^3.81.1`, `@vibe/icons` `^1.16` | React 19, `@vibe/core` **`4.2.5` exact**, `@vibe/icons` `^4.1` | Vibe v4 takes string literals and changed `Modal`/`TextField` APIs; a v3 pin against v4 call sites fails at runtime, not at build |
| `vite ^6`, `vitest ^2` | `vite ^8`, `vitest ^3` | Vite 8/rolldown **rejects the object form of `manualChunks`** — it must be a function |
| `build.sourcemap: false` | `sourcemap: 'hidden'` | the deploy workflows archive `dist/**/*.map` as a 90-day artifact then hard-fail if any `.map` survives into the push; with `false` there is nothing to symbolicate with |
| `define` only `__APP_VERSION__` | also `__BUILD_SHA__`, `__IS_RELEASE__` | `utils/versionLabel.js` reads all three; CI injects `VITE_BUILD_SHA` / `VITE_IS_RELEASE` |
| local `utils/axiomErrorSink.js` + `utils/axiomBrowserTransport.js` + `utils/globalErrorHandler.js`, called with **no arguments** | `import { setupGlobalErrorHandlers, attachAxiomSink } from '@mapps/error-kit/browser'`, logger passed explicitly, plus a `domainKind→kind` adapter (`utils/axiomLogger.js`) | a pure CDN client in the monorepo must import the shared package — vendored copies are only for server apps and embedded SPAs, and those owe a `packages/error-kit/test/drift.test.ts` entry |
| `pnpm-workspace.yaml` at the app root | **must be deleted** | a nested `pnpm-workspace.yaml` inside `apps/<name>/` declares a second workspace root and breaks the root `pnpm install` graph |
| `deploy` / `deploy:push` / `logs` / `status` scripts | **must be deleted** | `.claude/hooks/deploy-guard.sh` blocks local `mapps code:push`; deploys happen only on GitHub Actions. `code:logs`/`code:status` are server-app commands and do not apply to a CDN client |
| `@mondaycom/apps-cli` as a devDependency | not installed per app | its `patch-package` postinstall is incompatible with pnpm's isolated layout (this skill already blocks its lifecycle scripts); CI installs the CLI globally instead |
| `eslint ^8` + the `eslintConfig` block in `package.json` | `eslint 9` + a flat `eslint.config.js` | **the pairing is load-bearing** — see the ESLint 9 trap above. Bumping the pin without porting the config silently disables every error-guard rule AND makes the blocking CI lint step exit 2 |

Tailwind is shipped by the template but barely used by the live apps
(`discussions` is pure CSS Modules; `team-people-column` keeps the directives and
almost no utility classes). Dropping Tailwind + `postcss`/`autoprefixer` for a
CSS-Modules app is a supported choice, not a defect — just delete
`tailwind.config.js`, `postcss.config.js`, and the `@tailwind` directives in
`index.css` together, or the build fails on unknown at-rules.
