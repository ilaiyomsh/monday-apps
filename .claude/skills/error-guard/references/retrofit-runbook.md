# Retrofit Runbook — Bringing an Existing App up to the error-guard Standard

This is the step-by-step procedure for **mode B (`retrofit [app]`)**: taking an app
that already ships and raising it to the error-guard standard without a big-bang
rewrite. It is the generalization of the phased rollout proven on the Tracker
reference app (`Axis/tracker/error-handling-bundle/docs/error-handling-implementation-plan.md`).

Read `standard.md` (the ruler), `catch-patterns.md` (the canonical catch per
category), and `eslint-rules.md` (the enforcement kit) before starting — this
runbook is the *ordering* and the *gates*; those three are the *content*.

---

## The one principle this runbook exists to protect

**Rules only enter after the tree is already clean, and a rule-commit and a
cleanup-commit never sit on opposite sides of a red-CI boundary.**

Enforcement (the ESLint kit) is added *last*, in step 6, only once the code
already passes it. You never turn on `no-console` while 20 bare `console.*` calls
still exist — that produces an unrunnable tree and forces either a giant mixed
commit or a disabled rule. Every step below leaves the tree green before the next
step begins. The infra install (step 3), the API funnel (step 4), and the catch
sweep (step 5) are all *cleanup*; the ESLint kit (step 6) is the *lock* that
freezes the clean state. Cleanup commits and the lock commit are separated so CI
is green at every commit boundary.

This is why the order is fixed. Do not reorder.

---

## Sizing — one app per session

A retrofit is a **single-app, single-session** unit of work. Do not batch
multiple apps. The steps below assume you hold one app in context from step 0 to
step 8. A large app (many catch sites, React 18 with a hand-rolled boundary) may
still fit one session; if it does not, stop at a green commit boundary and resume
— never leave the tree between step 5 and step 6 across sessions (that is the one
window where the tree is clean but unprotected).

---

## Step 0 — Preconditions

Do not write a line until all three hold:

1. **Git repo required.** The app must be under version control with a clean
   working tree (`git status` clean). A retrofit touches the entry file, the API
   layer, and every catch site; without git there is no safe rollback. If the app
   is not a repo, stop and tell the user — do not `git init` and proceed silently.
2. **Work on a NEW branch only.** Never retrofit on the default branch. Create a
   dedicated branch (e.g. `error-guard-retrofit`). Every commit in this runbook
   lands on that branch; the merge back is the user's call.
3. **Open a change via change-tracker.** Run `/new_change` and describe the
   retrofit. This retrofit is one tracked change from step 0 to step 8; it is
   closed in step 8. (Per the standing autonomy rule, opening a change and
   committing are autonomous; a production deploy at the end is not — that is a
   separate gated question handled by the `mapps` ship procedure.)

---

## Step 1 — Green lint baseline

You cannot add rules to a tree that does not already pass lint. Get the *existing*
lint config to exit 0 first.

- Run the app's current lint (`pnpm exec eslint src/ --ext .js,.jsx …`, or whatever
  the app defines). Record the result.
- If it is **red**, fix the pre-existing failures until it is green — these are
  the app's own debt, unrelated to error-guard (e.g. `no-undef`, `import/first`
  in committed test files, a stale `--max-warnings` threshold). Fix them or move
  the threshold with the user's agreement; do not add error-guard rules on top of
  a red tree.
- If the app has **no lint at all**, install a minimal baseline (`eslint` +
  `eslint-config-react-app` or the app's framework preset) with *no error-guard
  rules yet* and get it green. The error-guard kit is added in step 6, not here.
- **Commit** the green baseline before moving on.

Acceptance: the app's lint command returns exit 0.

---

## Step 2 — Fix live, verified bugs first

Before any infrastructure, close bugs that are *confirmed live* in the current
code — the ones an audit or the app's own lint already proves are broken at
runtime (Tracker's Phase 0 was exactly this: a `ReferenceError` on every
successful load that also showed up as two `no-undef` lint errors).

- Only fix bugs you have **verified** against the live code — a real
  `ReferenceError`, a swallowed write that returns `null`, a false success toast
  on a failed mutation. Do not speculatively refactor.
- These fixes often also clear lint errors from step 1; that is expected.
- Add a regression test where the bug had a clear input→wrong-output shape (route
  new tests through `test-guard` — the test must be seen failing before the fix).
- **Commit** each verified fix.

Acceptance: the known live bugs are fixed and covered; lint still green.

Rationale for ordering it here: the infra you install next (logger, global
handler) will start surfacing errors that were previously invisible. Fixing the
already-known-broken paths first keeps the post-infra signal clean instead of
drowning it in pre-existing noise.

---

## Step 3 — Install the infrastructure (adapted to the app's React version)

Install the four infra pieces from `../templates/`, adapting the entry file to the
app's React major version. This is *installation*, not enforcement — the tree stays
green throughout.

Pieces (all from `templates/`):

- **`logger.js`** — single `emit` choke-point + `addSink`/`removeSink` + log-once
  (dedup by `error.__loggedId`) + ring buffer + a documented suppression point.
  Every error path in the app will route through this.
- **`globalErrorHandler.js`** — `window.onerror` + `unhandledrejection` +
  resource-error handling, all routed to `logger` (includes the silent
  resource-path fix discovered on Tracker; do not reintroduce bare `console.error`
  in the fallback).
- **`error-boundary/`** — a `react-error-boundary`-based boundary whose `onError`
  routes to `logger`, with a Hebrew fallback screen and a chunk-load-vs-render
  distinction. **Mount it above the providers**, so a render throw in a provider
  or an early return cannot whitewash the screen (Tracker's original boundary sat
  *below* the providers — that was a documented coverage gap).
- **`useUiErrorSink.js`** — the "one error = one toast" contract: it turns each
  ERROR-level log record into exactly one toast. Register it once, high in the
  tree.

Entry file, by React version:

- **React 19 → `entry-react19.jsx`**: wire
  `createRoot(container, { onUncaughtError, onCaughtError })` into the logger,
  *alongside* (not replacing) the global `window.onerror`/`unhandledrejection`
  handlers. The root hooks catch render-phase reporting; the global handlers catch
  everything React cannot see.
- **React 18 → `entry-react18.jsx`**: the global-handlers-only variant — no
  `createRoot` error hooks (they do not exist pre-19). The boundary + global
  handlers are the full net.

Adapt, do not blindly paste: match the app's existing toast component, i18n
namespace, and module names. Keep the logger, test files, and sink files out of
the future rule set (they are the standard exemptions — see step 6).

- **Commit** the infra install.

Acceptance: the app builds and boots clean with the infra wired; a deliberately
thrown error produces exactly **one** log record + **one** toast + the correct
fallback screen for its class (render vs chunk-load). If the app has a test suite,
its existing tests still pass (update any global logger mock to expose the new
`emit`/`addSink`/`removeSink`/`flush` surface, or the suite breaks at import time —
this bit Tracker's ~54 unrelated tests).

---

## Step 4 — Route all monday API calls through a single funnel that throws on soft errors

Every monday API call must go through **one** wrapper, and that wrapper (or a
helper called immediately after it) must **throw on GraphQL soft errors** — the
`status 200` responses that carry `res.errors` and would otherwise be treated as
success.

- Identify every SDK call site (`monday.api` / `monday.execute` / raw
  `graphql-request` / `fetch`). Route them all through the single funnel — the
  generalization of Tracker's `safeApi` (`utils/mondayApi/client.js`). Components
  must never call the SDK directly.
- On the **write paths** (create / update / delete), call an
  `assertNoGraphQLErrors(res)`-style helper right after the funnel returns (see
  `Axis/tracker/src/utils/mondayApi/assertGraphQL.js` for the reference). It
  **throws without logging** — the funnel already logged the soft error once as
  the canonical record; the thrown error is logged once more in the caller's catch
  and deduped by log-once. This is the core taxonomy rule from the research:
  *a soft error in a 200 response must be converted into a thrown error*, or
  TanStack-/Apollo-style success handling silently swallows it.
- Fix any call site that currently treats a falsy `createdItem` / missing id as
  success (false success toast) — route it to display + throw instead.
- Route new/changed tests through `test-guard`; a forced soft-error must produce
  exactly one record, not 2–4.

Cross-reference `monday-api` for the exact GraphQL error shape
(`error.data.errors`, `errorCode`) and column-format rules — error-guard owns the
*funnel and throw discipline*, `monday-api` owns the *shape*.

- **Commit** the funnel + throw work.

Acceptance: a forced failing mutation displays a mapped error (not a success
toast) and is logged exactly once; every SDK call routes through the funnel.

---

## Step 5 — Sweep every existing catch / console / swallow to the logger

Now walk the whole tree and bring every failure path up to the standard's four
conditions (caught in the right mechanism · zero silent swallow · clear identity ·
user-facing display when the user initiated the action).

- Run `../scripts/audit.sh` (grep the tree
  manually for the same gap classes) on the app to get a deterministic, file:line
  list of gaps by severity (silent catch / bare `console` / floating promise / bare
  `JSON.parse` / unwrapped storage access).
- For **every** `catch` / `.catch`: it must do exactly one of — call `logger.*`,
  re-`throw`, or display via the user sink. An empty catch, a comment-only catch,
  a `return null`-only catch, or a bare `console.*` catch is a gap. The **only**
  allowed silent path is `if (e.name === 'AbortError') return;` (and even then the
  rest of the block must handle other errors).
- Replace every bare `console.*` in app code with the matching `logger` level.
- For **user-initiated** failures (save / delete / blocking load), add user-facing
  display via the sink — one error, one toast — and make the message specific
  (mapped through the error parser), not generic.
- Wrap bare `JSON.parse` and storage reads. Instrument date/number parsers that
  can silently produce `NaN`/`Invalid Date` on the write paths.
- Follow the per-category canonical shape in `catch-patterns.md` — do not invent a
  new pattern per site.
- Where a catch is adjacent to both a `logger.*` and a display call on the *same*
  error, remove the redundant one (log-once means the display facade already logs;
  a second `logger.error` double-fires). This "double-log drift" sweep is the
  mechanical part Tracker's Phase 3 spent ~24 sites on.

Do this in as many commits as is natural, but **keep the tree green at every
commit** — nothing here should require the ESLint kit to be present yet.

Acceptance: `audit.sh`
shows zero silent catches and zero dark-console in app code; every user-initiated
failure has display.

---

## Step 6 — Install the ESLint kit (only once the tree already passes it)

This is the lock. It is added *after* steps 3–5 have already made the tree clean,
never before. Installing it earlier would red the tree and violate the core
principle.

- **Install the plugin dependency first**: `pnpm add -D eslint-plugin-promise`
  (per the `_install` note in `../templates/eslint-error-rules.json`). Without it,
  `promise/catch-or-return` — one of the four mandatory rules — cannot run at all:
  `check.sh` and `audit.sh` drop it with a "floating promises are NOT checked"
  note, and floating `.then()` chains go undetected. Installing it in this app
  also lets the scripts' borrow mode enforce the rule in sibling apps that have
  no own ESLint (borrow mode prefers an install where the plugin resolves).
- Then, **dry-run the kit** against the current tree: run the four rules
  (`no-console`, `no-empty` with `allowEmptyCatch:false`, the `catch-must-log`
  `no-restricted-syntax` selector, and `promise/catch-or-return`) over `src/`
  *without committing the config*. If it reports **any** violation, you are not
  done with step 5 — go back and clean the reported sites. The kit must pass on the
  unmodified tree before you commit the config.
- Only once the dry-run is clean, add the kit to the app's `package.json`
  `eslintConfig` (or flat config) from `../templates/eslint-error-rules.json`,
  with the standard exemptions: rules **off** in `logger.js`, in test files, in
  sink files, and in build config (e.g. `vite.config.js`). TypeScript projects
  additionally get `no-floating-promises` with
  `ignoreVoid:false` (see `eslint-rules.md`).
- The **rule-commit is its own commit**, landing on an already-green tree. The
  cleanup commits (steps 3–5) and this rule-commit never sit on opposite sides of
  a red-CI boundary — that is the invariant.
- Note the documented hole: a bare orphan async call in plain JS is not statically
  catchable; the global `unhandledrejection` handler (installed in step 3) is the
  runtime net, and the audit checks it manually.

Acceptance: the app's lint (now including the kit) returns exit 0; a deliberately
introduced silent catch or bare `console` fails lint with the remediation message.

---

## Step 7 — Acceptance

The retrofit is done when all of these hold:

1. **`audit.sh` returns
   0 critical/high gaps** (a documented, justified tail of low-severity items is
   acceptable; critical and high must be zero).
2. **Existing tests pass** (`pnpm run test:run` or the app's CI command), and any
   new tests added in steps 2/4 were seen failing first (test-guard).
3. **Manual smoke** of the two user-visible surfaces: trigger a render throw and
   confirm the fallback screen (Hebrew, correct render-vs-chunk copy); trigger a
   failing user action and confirm exactly one toast with a specific mapped
   message.
4. **Create an `.error-guard` marker file in the app root.** This marker is the
   signal that the app has completed a retrofit; it enables the **full-tree ship
   gate** (the `ship.sh` error-guard step runs the kit over the *entire* tree for
   marked apps, not just changed files). An unmarked app only gets the changed-file
   check. The marker is a small file — a one-line note that the app is at the
   error-guard standard and the date is enough.
- **Commit** the marker.

---

## Step 8 — Close the change

Close the tracked change opened in step 0 via change-tracker (`/close_change`):
record actual time, write the narrative summary (what was fixed, infra installed,
funnel wired, catch sites swept, kit locked, marker added), and update the
CHANGELOG. Closing the change is autonomous.

A production deploy, if the user wants one, is a **separate** gated action — route
it through the `mapps` ship procedure, which will ask its one confirming question
and run the error-guard full-tree gate (now enabled by the `.error-guard` marker).

---

## Feed lessons back

Any platform quirk or retrofit friction discovered during a session gets appended
to this runbook (or the owning reference page) in the same session — the runbook
is a living snapshot, sharpened by each app it is run on before heavier apps
(Planner, sync-calender, discussions) are attempted.

---

## Pilot lessons — CEO_Display (2026-07-07, first real execution)

1. **Dirty tree at step 0 need not abort when the change is docs-only.** CEO_Display
   had an uncommitted CLAUDE.md edit from a prior session. Committing it as the first
   commit ON the retrofit branch (instead of stopping) preserved both the clean-tree
   invariant and the never-touch-main rule.
2. **"Existing logger" may be surface-incompatible with the template.** The app's
   logger was a named export with variadic `(message, ...args)` methods (including
   `logger.log`, which the template does not have). Preserving the old surface with a
   compat shim would have lost module attribution and kept two call conventions alive;
   full call-site migration (81 sites, mechanical regex: `logger.log(` -> `logger.debug('<Module>', `)
   was cheap and left one canonical surface. Prefer migration over shimming when the
   old surface is variadic.
3. **The step-1 baseline can hide a live bug that IS the step-2 item.** The red
   baseline's rules-of-hooks errors included hooks called inside an inline render IIFE —
   a latent crash. Fixing lint (step 1) and fixing live bugs (step 2) collapsed into
   one commit; that is fine, note it in the commit message.
4. **An app with no toast system:** a ~100-line inline `ErrorToastHost` (fixed-position,
   RTL, auto-close, registers `useUiErrorSink` once) satisfies the display contract
   without adding a UI library. Mount it inside the root boundary, next to the router.
5. **Blocking-load double-surface:** when a feature renders a full error screen for a
   failed load, the funnel toast would be a second surface for the same error. Solved
   with a `suppressToast: true` option on `safeApi` that flags the thrown error; the
   app's sink adaptation skips flagged errors. This is now the sanctioned pattern for
   screen-displayed failures.
6. **Toast specificity must be decided AT the funnel, not in the caller's catch.**
   The sink toasts on the FIRST log of an error instance (the funnel's apiError), so a
   caller-attached userMessage would arrive too late. Write-path helpers pass the
   operation-specific Hebrew `userMessage` down INTO `safeApi`; the caller's
   `showErrorWithDetails` is then a console-only duplicate plus rollback bookkeeping.
7. **Non-blocking persistence loads (storage getItem, invalid stored JSON) are WARN,
   not ERROR** — defaults keep the app fully functional and a toast would be noise.
   Save-path failures of user-initiated actions stay ERROR (toast).
8. **test-guard interplay:** the PostToolUse test-guard hook fires on every product
   file the retrofit touches. In an app with no test runner, record per-file waivers
   (`redgreen.sh waive <src-file> "<reason>"` with `REDGREEN_RUNNER` set, since runner
   detection dies before waive otherwise) and list the framework install as follow-up.
9. **Runtime smoke without a browser:** `npx esbuild <funnel> --bundle` + a Node
   one-liner stubbing `monday.api` verifies the two funnel throws (soft error,
   transport) and the logger's log-once contract. Full in-iframe smoke (fallback
   screen + one-toast) still needs a human/browser pass — flag it in the report when
   run headless.
