---
name: error-guard
description: "The canonical error-catching skill — an uncaught error cannot be handled, so every fallible site gets a catch mechanism before the task is done. Use whenever writing or reviewing code with error paths: try/catch placement, error boundaries, global handlers, toast/fallback display, silent catches, white screens, floating promises, GraphQL soft errors in 200 responses. Trigger on: error handling, error boundary, silent catch, swallowed error, white screen, unhandled rejection; and on the user's phrases: תפיסת שגיאות, טיפול בשגיאות, שגיאות רינדור, מסך לבן, בליעת שגיאות. Also invoked as `/error-guard retrofit [app]` and `/error-guard audit [path]`."
argument-hint: "[retrofit [app] | audit [path]]"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# error-guard — errors that get caught

The failure mode this skill exists to end: an error fires in production, nothing catches
it, nothing logs it, the user sees a white screen or a false success toast, and monitoring
sees nothing at all. **An uncaught error cannot be handled** — catching is the precondition
for everything else (logging, display, recovery).

Division of labor: **the skill teaches the pattern; the hook and the gate enforce it
deterministically.** Enforcement is real tool exit codes (ESLint rules, `check.sh`,
`audit.sh`, the ship gate), never prose. The rule messages are written as remediation
instructions — when the hook fires, the message IS the fix you apply.

Reference model: the Tracker app (`Axis/tracker`) — fully implemented standard, live infra,
proven ESLint selector. The references in this skill generalize it to the whole portfolio.

## Mode A — new code (the default, no command)

These rules bind every code-writing task in a wired app. Not optional, not deferred.

1. **Mapped before done.** Every new error source gets a catch mechanism from the
   canonical pattern (`references/catch-patterns.md`) BEFORE the task counts as finished.
   The seven source categories (`references/standard.md` §1):
   every `await` · direct SDK calls · parsing external data (`JSON.parse`, storage, deep
   field access) · `useEffect` launching async work · event handlers calling async work ·
   code that can throw during render · date/number parsing.
   For SERVER code (Express/monday-code) the category list and patterns are
   `references/server-patterns.md` — async handlers wrapped, one terminal middleware,
   process nets, webhook contract.
2. **The four PASS criteria** (`references/standard.md` §3) — a source is handled only if ALL hold:
   caught by the correct mechanism for its category · zero silent swallow (every catch
   logs, rethrows, or displays) · clear error identity (code/category, specific Hebrew
   message where user-facing) · displayed to the user when the user initiated the action.
3. **Soft errors in a 200 response are ALWAYS converted to thrown errors** — at the API
   funnel layer, once, for every caller (`references/catch-patterns.md` (b3)). A GraphQL
   response with `res.errors` populated is a failure, never a success.
4. **The single allowed silent path:** `if (e.name === 'AbortError') return;` —
   deliberate cancellation is not an error. Everything else in the catch block still
   logs/rethrows/displays.
5. The PostToolUse hook gives immediate feedback on every edit (see Enforcement below);
   its message is the remediation instruction — follow it verbatim, do not argue with it.

## Mode B — RETROFIT (existing app) — `/error-guard retrofit [app]`

Bring a shipping app up to the standard without a big-bang rewrite. The full procedure is
`references/retrofit-runbook.md` — read it start to finish before touching the app. The
non-negotiables:

- **One app per session.** Never batch. If the app doesn't fit one session, stop at a
  green commit boundary (never between the sweep and the lint lock).
- **NEW git branch only.** Clean tree, dedicated branch (e.g. `error-guard-retrofit`),
  opened via `/new_change`. No repo → stop and tell the user.
- **Fixed order, rules last:** green lint baseline → fix verified live bugs → install
  infra from `templates/` (per React version) → single API funnel that throws on soft
  errors → sweep every catch/console/swallow → install the ESLint kit only once the tree
  already passes it → acceptance (`audit.sh` zero critical/high + manual smoke) →
  `.error-guard` marker file → `/close_change`.

## Mode C — AUDIT — `/error-guard audit [path]`

- **Default: `scripts/audit.sh`** — cheap, deterministic scan of a whole tree: silent
  catches, bare `console`, floating promise chains, bare `JSON.parse`, unwrapped storage
  access. Output: file:line gap list by severity (model: `references/standard.md` §2, §7).
- **Deep multi-agent audit** (Tracker-workflow style, per-site scoring table) — ONLY on
  explicit user request. It is expensive (millions of tokens); never launch it as a
  default or "while we're here".

## Enforcement map (three layers)

| Layer | Mechanism | When | Force |
|---|---|---|---|
| Immediate feedback | PostToolUse hook on Edit/Write of JS/JSX/TS/TSX → `scripts/check.sh` on the edited file | every edit | non-blocking write; exit 2 returns the remediation message to the agent |
| Deploy gate | error-guard step in `ship.sh` (mapps skill): `check.sh` on changed files; full tree for apps with an `.error-guard` marker | before every deploy | blocking |
| Permanent anchor | per-app ESLint kit (`references/eslint-rules.md`, `templates/eslint-error-rules.json`) | every lint/CI run | blocking in CI |

The kit's 4 rules: `no-console` (no allow list) · `no-empty` with `allowEmptyCatch:false` ·
`catch-must-log` (the proven `no-restricted-syntax` selector — copy byte-for-byte) ·
`promise/catch-or-return` (dep: `eslint-plugin-promise`). TypeScript projects add
`@typescript-eslint/no-floating-promises` with `ignoreVoid:false`. Standard exemptions:
rules off in the logger file, test files, sink files, and build config (e.g.
`vite.config.js`) — nowhere else.

**Documented hole:** a bare orphan async call in plain JS is statically invisible. The
global `unhandledrejection` handler is the runtime net (which is why it is non-negotiable),
and audits check for it manually.

## Ownership boundaries

- **error-guard owns catch → log → display → ERROR/WARN shipping.** Everything up to and
  including the app's logger (catching, funneling, log-once, one-toast display) PLUS the
  remote **error** sink to the shared `app-errors` Axiom dataset
  (`references/remote-monitoring.md` — zero-touch per app once the one-time user setup ran).
- **Full operational observability** (INFO event streams, per-app `<slug>-prod` datasets,
  the status-hub dashboard) stays **`add-to-status-hub`** — opt-in per app, on top of and
  independent from the error sink (two sinks on one logger coexist).
- **monday API error shapes** (`error.data.errors`, `errorCode`, complexity/rate limits,
  column formats) are **`monday-api`**. error-guard owns the funnel-and-throw discipline;
  monday-api owns the shape.
- **Server-side (Express on monday-code / integration apps) is IN scope** —
  `references/server-patterns.md` is the server ruler; `templates/server/` is the drop-in
  infra; modes A/B/C apply with the server vocabulary (asyncHandler coverage, one terminal
  middleware, process nets, webhook contract).

## File map

References (the depth lives here):
- `references/standard.md` — the ruler: roles, 7 sources, 4 PASS criteria, silent-swallow
  rule, display matrix, log-once contract, severity model.
- `references/catch-patterns.md` — the one sanctioned pattern per category, WRONG/RIGHT
  pairs: async/await, the three network classes, boundaries, React 19 root options, races,
  event handlers, parse guards, NaN guards, the display contract.
- `references/eslint-rules.md` — the 4-rule kit + TS addition + overrides + install
  (package.json and flat config).
- `references/retrofit-runbook.md` — mode B, steps 0–8 with gates.
- `references/server-patterns.md` — the SERVER ruler: 7 server source categories,
  asyncHandler rule, terminal middleware, process nets, webhook contract, monday-Logger
  wrap decision, Node ESLint overrides, server definition of done.
- `references/remote-monitoring.md` — Axiom error shipping for ANY app: fixed
  architecture decisions (2026-07-07), one-time user setup (`app-errors` dataset +
  ingest token), client + server wiring runbooks, acceptance test, incident mode,
  token-compromise runbook, boundary with add-to-status-hub.
- `references/research-2026-07.md` — the research synthesis grounding all of the above.

Templates (drop-in infra, adapt names/i18n per app):
- `templates/logger.js` — emit choke-point, addSink, log-once, ring buffer, suppression point.
- `templates/globalErrorHandler.js` — onerror + unhandledrejection + resource errors → logger.
- `templates/error-boundary/AppErrorBoundary.jsx` — react-error-boundary wrapper, onError →
  logger, Hebrew fallback, chunk-vs-render distinction.
- `templates/entry-react19.jsx` / `templates/entry-react18.jsx` — entry snippets
  (19: createRoot onUncaughtError/onCaughtError; 18: global handlers only).
- `templates/useUiErrorSink.js` — the one-error-one-toast contract.
- `templates/axiomBrowserTransport.js` + `templates/axiomErrorSink.js` — the remote
  error sink for client apps (JS port of the 69-test-verified Axis transport; gated
  on `VITE_AXIOM_*` env, structurally inert in dev/test).
- `templates/server/` — the server drop-in set: `logger.js` (choke-point,
  `(message, tag, context)` signature, monday-Logger wrap), `axiomServerSink.js`,
  `asyncHandler.js`, `errorMiddleware.js`, `processGuards.js`.
- `templates/eslint-error-rules.json` — the kit, ready to merge.
- `references/known-issues.md` — the skill's self-correction log: sanctioned
  rule exceptions, documented holes, and the defect log (see Self-correction).

Scripts (ESLint 9 flat config — ported 2026-07-21, see known-issues.md):
- `scripts/lib-eslint-flat.sh` — shared engine both scripts source: file filter,
  ESLint/plugin resolution (repo root preferred), generated flat config
  (`eslint.config.mjs`), and the ESLint invocation. One engine so the two gates
  cannot drift apart again.
- `scripts/check.sh` — error-rules-only ESLint on given files (the hook and ship
  gate call this). Syntax-level rules only (fast, ~0.7s/file); no type-aware pass.
- `scripts/audit.sh` — deterministic whole-tree gap count by severity (mode C
  default). Adds type-aware `no-floating-promises` in full-tree mode when a
  tsconfig + the TS plugin are present (best-effort, fails open to syntax-only).
- **Plugin resolution:** the kit's plugins (`eslint-plugin-promise`,
  `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`) live in the
  **repo root** `devDependencies`, so the gate runs the full rule set regardless
  of what each app installs.

## Definition of done (mode A)

- [ ] Every new error source maps to a canonical catch pattern (7 categories)
- [ ] Every catch logs, rethrows, or displays — only `AbortError` is silent
- [ ] Soft-200 errors throw at the funnel; no false success paths
- [ ] User-initiated failures display exactly one specific toast (log-once holds)
- [ ] The PostToolUse hook is quiet on all edited files

## Self-correction (errors of the skill itself)

The skill's own tooling can be wrong. When it is, the failure gets RECORDED and
FIXED at the source — never worked around silently. All entries go to
`references/known-issues.md` in the same session they are discovered.

1. **False positive** (a kit rule flags legitimate code): never add a bare
   `eslint-disable`. First check `known-issues.md` for a matching sanctioned
   pattern. If new: record the code shape + why it is legitimate, then disable
   the single line WITH a comment naming the entry. The SECOND occurrence of
   the same shape means the rule is wrong — refine the selector/config in
   `templates/eslint-error-rules.json` (and consumers), not the code. Precedent:
   the UI sink's own display-path catch (the one sanctioned `eslint-disable` in
   the templates).
2. **False negative** (a swallow the kit missed): add the escaped shape to
   `known-issues.md` and extend the selector or `audit.sh` heuristics in the
   same session. The documented bare-async-call hole stays documented, not silent.
3. **Script/hook runtime failure**: the hook is fail-open BY DESIGN (an internal
   error exits 0), so its failures are invisible in normal use. Any observed
   misbehavior of `check.sh`/`audit.sh`/the hook (crash, wrong exit code, hang,
   nonsense output) is a known-issues entry + an in-session fix; red-gate the fix
   (make the script SEEN failing on the trigger input before trusting it again).
4. **Template defect**: a bug found in installed infra in ONE app is assumed
   present in `templates/` and in every app that consumed them — fix the
   template, then grep all consumers (`.error-guard` markers + scaffold) and fix
   each. Precedent: the React 19 `onCaughtError` module-label bug (2026-07-07).
5. **Guidance defect** (a reference doc told an agent something wrong): fix the
   doc in-session and note the correction in `known-issues.md` with the date —
   stale guidance is a bug like any other.
6. **Cross-skill interop false positive** (another skill's gate would fire on a
   file a different skill's process is deliberately mutating): the hook must
   skip that file for the duration, not report noise — and never by weakening
   the rule itself. Worked example: `.claude/hooks/error-guard-check.sh` skips
   any file with a `.mutbak` sibling (a live-armed `test-guard` mutation
   spot-check); added 2026-07-07 after the v2 shakedown collision, documented on
   both sides (this file + `test-guard/references/hooks-contract.md` §6). The
   pristine file is re-checked on the restoring edit after `spotcheck-fire`.

Retrofit friction (as opposed to skill defects) keeps flowing to the runbook's
"Feed lessons back" section, as before.
