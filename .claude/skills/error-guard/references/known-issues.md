# error-guard — Known Issues & Self-Correction Log

Log of the skill's OWN defects: false positives/negatives of the rule kit,
script/hook misbehavior, template bugs, and wrong guidance. Protocol: SKILL.md
§ "Self-correction". Every entry gets a date, the trigger, the resolution, and
which consumers were checked. Newest first.

## Sanctioned rule exceptions (false-positive registry)

Shapes the kit flags that are legitimate BY DESIGN. An inline `eslint-disable`
is allowed ONLY for shapes listed here, with a comment naming the entry.

| # | Shape | Why legitimate | Where |
|---|-------|----------------|-------|
| FP-1 | Silent catch inside the UI error sink's own display path | The sink IS the display layer; calling the logger from inside it would recurse through `emit` (its re-entrancy guard exists for exactly this). The logger's `dispatchToSinks` try/catch already reports a throwing sink via raw `console.error`. | `templates/useUiErrorSink.js` (`uiHandler`) |
| FP-2 | Console breadcrumbs + intentional silent catches in transport/guard infra | The Axiom transport, server sinks, and process guards sit BELOW the logger (recursion hazard) or ON the exit path (logging must not block `process.exit`). `check.sh`/`audit.sh` skip them by basename: `axiomBrowserTransport.js`, `*Sink*`, `*-sink.*`, `processGuards.js`, `process-guards.js`, `*/services/logger/*`. Added 2026-07-07 with the remote-monitoring + server extension. | `templates/axiomBrowserTransport.js`, `templates/server/*` |
| FP-3 | Silent catch inside a log-serialization helper (`safeSerialize`-style: builds the payload the logger emits) | Calling the logger from the helper's own catch recurses through the logger's emit path; the catch already falls back to `String(value)`, so no information is lost silently. | First consumer: `apps/axis/day-off/src/services/mondayApi.ts` (monorepo) — 2026-07-07. (Renumbered from a duplicate "FP-2" on 2026-07-14 — no code comments referenced the old number.) |
| FP-4 | One-shot `console.info('[app] ' + versionLabel)` at app-entry load (the "version layer" pattern: `getVersionLabel()`/`versionLabel` module + a single info line logged before `createRoot`) | Not an error path — a deliberate, single, always-visible build-identity breadcrumb (semver + draft/release + short SHA), read once at boot, same spirit as the already-exempted Sink files. Routing it through `logger.info` would mute it in production (logger gates INFO to ERROR-only outside debug mode), defeating the point of a build marker visible in the deployed console. | entry files (`src/main.jsx`/`src/index.jsx`) across apps using the version layer — 2026-07-14 |

## Documented false negatives (holes the kit cannot close)

| # | Shape | Net | Status |
|---|-------|-----|--------|
| FN-1 | Bare async call (`doAsync()` with no `await`/`.then`/`.catch`) in plain JS | Runtime: global `unhandledrejection` handler. Audit: manual check listed in mode C. On the SERVER the net is FATAL by policy (processGuards exits) — loud, not silent. | Permanent (needs TypeScript type info to lint) — see `eslint-rules.md` |
| FN-2 | `catch (e) { next(e) }` where `next` is NOT Express's next (a shadowing local fn that drops the error) | `check.sh`/`audit.sh` use a UNION catch-must-log selector (client allowances + server `next()`) because one config covers both worlds — so a client catch calling any `next(...)` passes the hook. The per-app ESLint kits stay precise: the CLIENT kit (`eslint-error-rules.json`) does NOT allow `next`, so the permanent anchor still catches it. Deliberate trade-off, 2026-07-07. | Accepted (hook = fast feedback; kit = precision) |

## Defect log

### 2026-07-21 — check.sh/audit.sh ported to ESLint 9 flat config (FIXED)
- **Trigger:** the scripts were written for the ESLint-8 eslintrc engine
  (`--no-eslintrc --config <json> --resolve-plugins-relative-to`). The repo runs
  ESLint 9 (flat config default), which removed those flags. A prior stopgap
  forced eslintrc mode with `ESLINT_USE_FLAT_CONFIG=false` — but that env var and
  the entire eslintrc engine are removed in ESLint 10, and the borrow logic
  depended on each consumed app carrying `eslint-plugin-promise` /
  `@typescript-eslint/parser` locally (most do NOT), so the promise + TS rules
  silently dropped per app. Documented as the fails-open gap in
  `docs/ERROR-AXIOM-STANDARD.md §Enforcement`.
- **Fix:** both scripts now generate a flat config (`eslint.config.mjs` in a temp
  dir) from the same `templates/eslint-error-rules.json` rule intents, via a new
  shared engine `scripts/lib-eslint-flat.sh` (the two scripts drifting apart is
  what let this survive — one engine now). Removed flags: `--no-eslintrc`,
  `--resolve-plugins-relative-to`, `ESLINT_USE_FLAT_CONFIG=false`. Plugins now
  resolve from the **repo root** (added as root devDependencies:
  `eslint`, `eslint-plugin-promise`, `@typescript-eslint/parser`,
  `@typescript-eslint/eslint-plugin`, `typescript`), so the full kit runs
  uniformly regardless of the target app's own install. ESLint is run with cwd =
  repo root (flat config only lints files under its base path) and
  `--no-config-lookup --config` so the app's own eslint.config is ignored.
- **TS handling:** `.ts/.tsx` files are parsed with `@typescript-eslint/parser`
  and get the syntax kit in BOTH modes. Type-aware `no-floating-promises`
  (`ignoreVoid:false`) is added in `audit.sh` full-tree mode only (gated on a
  tsconfig + the TS plugin, best-effort with a syntax-only retry on
  project-service error) — too heavy for the per-edit hook. This is the
  documented degraded mode (`references/eslint-rules.md`).
- **Red-gated:** scratch file with (a) empty catch and (b) console-only catch →
  check.sh exits 1 reporting `no-empty` + `no-restricted-syntax` + `no-console`;
  full hook exits 2 with the remediation; `.mutbak` interop still skips.
  `audit.sh` on `apps/team-people-column` passes (0 HIGH); on a TS app the
  type-aware pass flags real floating promises. Per-file latency ~0.65s (JS) /
  ~0.74s (TS). `pnpm -r --if-present type-check` green after the devDep install.
- **NOTE (ESLint 10):** the eslintrc removal that motivated this is now handled —
  the scripts are flat-config native. The old "migrate before v10" warning is
  resolved.

### 2026-07-14 — check.sh false positive on foreign inline eslint-disable (FIXED)
- **Trigger:** editing `DatePickerPopover.jsx`, which carries an
  `eslint-disable-next-line react-hooks/exhaustive-deps` comment, tripped the
  PostToolUse hook with `[react-hooks/exhaustive-deps] Definition for rule ...
  was not found` — a rule the error-guard config never defines.
- **Defect:** ESLint treats an inline disable that references an unknown rule as
  a ruleId-bearing message, so the gate counted it as a violation. Any file with
  an inline disable for a rule outside the error-guard kit false-failed on every
  edit.
- **Fix:** `check.sh` now runs ESLint with `--no-inline-config`. Side benefit:
  inline comments can no longer silence the error-guard rules themselves
  (aligns with "never silence a rule"). Verified on the trigger file (clean) and
  the rule kit still fires (violations still reported on a crafted bad catch).


### 2026-07-14 — Rule kit false positive: version-layer `console.info` banner (FIXED) + registry numbering collision (FIXED)
- **Trigger:** wiring the version-layer caption into `apps/team-people-column`
  (monorepo) — `check.sh` reported `[no-console]` on the entry-file version
  banner; the identical pattern was already shipping unflagged in
  `apps/discussions` and `apps/axis/tracker` (the PostToolUse hook reports
  but never blocks the write).
- **Fix at source:** `templates/eslint-error-rules.json` — `no-console`
  changed to `["error", { "allow": ["info"] }]` (only `console.info` allowed;
  `.log/.warn/.error/.debug` still flagged outside logger/Sink/test
  overrides). `check.sh` rebuilds its config from the template on every run,
  so all apps are covered immediately. Sanctioned shape registered as FP-4.
- **Consumers checked (monorepo):** `discussions` and `axis/tracker` entry
  files re-checked clean post-fix; `team-people-column`'s local
  `package.json` eslintConfig mirrored with the same allow. Follow-up:
  mirror the allow into discussions'/tracker's local eslintConfig too.
- **Registry collision found while syncing:** the HQ copy carried TWO rows
  numbered FP-2 (transport/guard infra + log-serialization helper, both
  2026-07-07), and the monorepo copy had silently diverged (FP-1 only).
  Renumbered: serialization helper → FP-3, version banner → FP-4; both
  copies re-synced to the full 4-row registry. No code comments referenced
  the old duplicate number.

### 2026-07-07 — Scope extension (remote monitoring + server) — verification record
- Client Axiom transport (`templates/axiomBrowserTransport.js`) is a JS port of the
  Axis TS original (44/44 tests there); the port itself was smoke-verified in Node
  via injected seams: inert gate, sanitizer/allowlist (PII keys dropped), envelope
  enrichment, timer/size/hidden(keepalive) flushes, 5-per-window dedup, 3-failure
  circuit breaker, dispose. Sink (`axiomErrorSink.js`): ship policy, mapping (V8
  frame preferred over `@`-message line, `error.message` never ships), ring-buffer
  replay, double-attach guard — all seen passing; breaker seen failing first
  (harness bug — 2 failed batches ≠ 3; fixed in the harness, transport correct).
- Server templates verified by an ASSEMBLED Express 4 app: sync throw + wrapped
  async throw → 500 safe JSON `{error, correlationId}` (no message/stack leak),
  `err.status` honored (404), log-once proven (deep catch + middleware → ONE sink
  record, same correlationId), UNwrapped async rejection → `unhandled_rejection`
  logged and process exited 1 (net is fatal by design). Axiom env gate inert
  without vars. `check.sh`/`audit.sh` red-gated on server fixtures (silent catch
  flagged; `next(err)` and `logger.*` pass; sanctioned infra skipped) and the
  assembled integration-scaffold app audits ZERO HIGH.
- CSP question (was #121's canary): settled statically — monday-code hosting serves
  documents with NO CSP header (only 301s carry `default-src 'none'`); recorded in
  `references/remote-monitoring.md`.

### 2026-07-07 — Template defect: React 19 `onCaughtError` double-surface (FIXED)
- **Trigger:** live smoke in headless Chrome during the build's template verification.
- **Defect:** `entry-react19.jsx` logged boundary-caught render errors as module
  `'ReactRoot'`; since React 19's root `onCaughtError` fires BEFORE
  react-error-boundary's `onError`, that record was the canonical one and the UI
  sink's `startsWith('ErrorBoundary')` filter missed it → toast on top of the
  fallback screen (double surface).
- **Fix:** the `onCaughtError` log module is `'ErrorBoundary:ReactRoot'`
  (`onUncaughtError` deliberately unchanged — with no boundary there is no
  fallback screen, so its toast is the correct single surface).
- **Consumers checked:** scaffold entry template (React 18 wiring — not affected);
  CEO_Display pilot (React 18 entry — not affected).

### 2026-07-07 — Guidance defect: stale "stage 3 — pending" wording (FIXED)
- **Trigger:** pilot agent reported the runbook/SKILL still described
  `check.sh`/`audit.sh` as not yet existing while using them as the acceptance gate.
- **Fix:** wording removed from SKILL.md + retrofit-runbook.md same session.

## Hook union selector misses the server `logError` convention (2026-07-19)

`scripts/check.sh`'s UNION_SELECTOR accepts only `logger.*` member calls,
`throw`, `showErrorWithDetails`, or `next(err)` inside a catch. deadline-confirm's
server convention is the named import `logError(tag, msg, ctx)` from
`helpers/logger.js` — semantically the same funnel — so the PostToolUse hook
flags EVERY such catch (including long-committed code like
`confirm-service.js`), while the app's own ESLint kit passes clean. Until the
selector adds `:not(:has(CallExpression[callee.name='logError']))` (and the
sibling `logAttempt`/`logInfo` names where appropriate), treat hook findings
on `logError(...)`-handled catches in this app as false positives — verify
with `npx eslint <file>` before "fixing".
