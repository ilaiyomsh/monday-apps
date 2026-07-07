# Error Handling — End-to-End Closure: Status & Handoff

**Date:** 2026-07-07 · **Audience:** any agent continuing this work · **Owner skill:** `error-guard` (this folder)
**Repo root for everything below:** the project root of the current clone — the directory containing `.claude/` (in scripts: `$CLAUDE_PROJECT_DIR`, falling back to `git rev-parse --show-toplevel`). All relative paths below resolve against it.

## 0. Mission statement

Goal set by the user: error handling closed **end to end** across the whole monday.com app portfolio — every error **caught** (no silent swallows, no white screens, no false success), **logged once** through a single choke-point, **displayed** to the user when they initiated the action, **monitored** remotely, and all of it **enforced deterministically** on AI-generated code rather than remembered by agents. Client-side is largely done (see §1–2); the remaining workstreams are in §3.

---

## 1. What exists and is verified (as of 2026-07-07)

Everything in this section was built by a multi-agent workflow and **adversarially verified by execution** (live browser smoke for templates, red-gate runs for scripts, generated-app audit for the scaffold, independent verification of the pilot). Deep-research grounding: `references/research-2026-07.md`.

### 1.1 The `error-guard` skill (`.claude/skills/error-guard/`)
- `SKILL.md` — 3 modes: **A** new-code rules (default), **B** `retrofit [app]`, **C** `audit [path]`; enforcement map; ownership boundaries; **Self-correction section** (protocol for defects of the skill's own tooling).
- `references/standard.md` — the ruler: 7 error-source categories, 4 PASS criteria, silent-swallow rule (single `AbortError` exception), display matrix, log-once ownership contract, severity model. Generalized from the Tracker reference implementation.
- `references/catch-patterns.md` — canonical WRONG/RIGHT pattern per category, incl. the three distinct network classes (fetch does not reject on HTTP status → check `response.ok`; true network rejection; **GraphQL soft errors in HTTP-200 responses must be converted to throws at the API funnel**), React 19 root options, race patterns (AbortController / fetch-id), parse guards, one-error-one-surface display contract.
- `references/eslint-rules.md` + `templates/eslint-error-rules.json` — the 4-rule kit: `no-console` (no allow), `no-empty` (`allowEmptyCatch:false`), `catch-must-log` (proven `no-restricted-syntax` selector; **message text = remediation instruction for the agent**), `promise/catch-or-return` (dep: `eslint-plugin-promise`). TS projects add `no-floating-promises` with `ignoreVoid:false`. Standard exemptions: logger file, test files, sink files, dev-harness, build config.
- `references/retrofit-runbook.md` — mode B steps 0–8 (branch-only, fixed order, **rules enter only after the tree is clean**), + 9 pilot lessons appended from the first real execution.
- `references/known-issues.md` — self-correction log: sanctioned false-positive registry (FP-1: the UI sink's own display-path catch), documented hole (FN-1: bare orphan async call in plain JS — runtime net is the global `unhandledrejection` handler), defect log (2 fixed defects from build day).
- `templates/` — drop-in infra, **all verified live in an assembled Vite app**: `logger.js` (single `emit` choke-point, `addSink` fan-out with per-sink try/catch, log-once via `correlationId`/`__loggedId`, ring buffer, beforeSend-style suppression point), `globalErrorHandler.js` (onerror + unhandledrejection + capture-phase resource errors → logger; idempotent), `error-boundary/AppErrorBoundary.jsx` (react-error-boundary wrapper, chunk-vs-render fallback, Hebrew UI), `entry-react19.jsx` (createRoot `onUncaughtError`/`onCaughtError`; the caught-path logs module `ErrorBoundary:ReactRoot` — see known-issues defect log for why) / `entry-react18.jsx`, `useUiErrorSink.js` (one ERROR record = one toast; skips `ErrorBoundary*` modules; injectable toast; ring-buffer replay capped).
- `scripts/check.sh` (single-file scan, powers the hook + ship gate, fail-open, ~1–2 s) and `scripts/audit.sh` (whole-tree severity-bucketed gap report + JSON.parse/storage heuristics + catch census). Both red-gate verified (SEEN failing on every rule class before trusted).

### 1.2 Enforcement (live now, three layers)
1. **PostToolUse hook** `.claude/hooks/error-guard-check.sh` (registered in `.claude/settings.json`, matcher `Write|Edit`): every edited JS/JSX/TS/TSX file is scanned; violations return exit 2 with the remediation message to the editing agent. Fail-open on any internal error.
2. **Ship gate** in `.claude/skills/mapps/scripts/ship.sh`: apps with an `.error-guard` marker file get a **blocking full-tree `audit.sh`** before deploy; unmarked apps get a non-blocking warning on changed files.
3. **Per-app ESLint kit** — permanent anchor, blocking in CI where CI exists.

### 1.3 Scaffold integration (`.claude/skills/monday-scaffold/`)
Every newly generated app is compliant from birth: infra files in `templates/shared/` (`utils/logger.js`, `utils/globalErrorHandler.js`, `components/ErrorBoundary/`, `hooks/useUiErrorSink.js`), pre-wired entry, the rule kit in `package.json` `eslintConfig`, `.error-guard` marker. **Verified:** a freshly materialized scaffold passes `audit.sh` with zero gaps and builds green.

### 1.4 App status table

| App | State | Notes |
|---|---|---|
| `Axis/tracker` | ✅ Reference model (own local impl, test-locked) | Remote sink code-complete but **PAUSED** (change #121: user must create Axiom dataset + `tracker-ingest` token; runbook at `Axis/axiom-logging-handoff/`) |
| `CEO_Display` | ✅ Retrofitted, **UNMERGED** | Branch `error-guard-retrofit` (7 commits, 18 catch sites, 81 logger call-site migrations, 1 latent rules-of-hooks crash fixed, audit exit 0, independent verification PASS). NOT pushed. No test runner (waivers recorded). |
| `Axis/Planner` | ❌ No infra at all | Heaviest retrofit |
| `Axis/sync-calender` | ❌ Partial (some boundaries, 111 catch sites unaudited) | |
| `discussions` | ❌ Partial (has boundaries + global handler, no kit) | |
| `status-report` | ❌ Nothing, **not even a git repo** | git init is precondition |
| `updates-reports`, others | ❌ Unassessed | run `audit.sh` first |

### 1.5 Governance
- the project root's `.claude/CLAUDE.md`: error-guard row in the skills table + two standing rules — (a) every catch must log/throw/display, hook feedback must be fixed not silenced; (b) **skills self-correct**: defects of a skill's own tooling/guidance go to that skill's `references/known-issues.md` and are fixed at source in the same session.
- Ownership boundaries: error-guard stops at the logger; remote sinks = `add-to-status-hub`; monday API error shapes = `monday-api`; deploy = `mapps` ship; pipeline/merge = `monday-cicd`.

---

## 2. Verified-fact nuggets the next agent should not re-derive

- monday GraphQL returns errors inside HTTP-200 responses; both Apollo and TanStack Query docs confirm soft errors must be **thrown** to surface. The funnel pattern (`safeApi` + `assertNoGraphQLErrors`) is the sanctioned fix; the CEO_Display pilot added a sanctioned `suppressToast` option for errors whose caller renders a full error screen (one error = one surface).
- React error boundaries catch **only render-phase throws** — not event handlers, async callbacks, or rejections. Global handlers are non-negotiable.
- React 19's root `onCaughtError` fires **before** react-error-boundary's `onError`; the root record is canonical for log-once. Hence its module label must be `ErrorBoundary:`-prefixed or the UI sink double-surfaces (fixed defect, see known-issues).
- In plain JS, a bare orphan async call is statically invisible (needs TS type info) — documented hole FN-1; the runtime net is `unhandledrejection`.
- test-guard stop-gate catch-22 for runner-less apps: `redgreen.sh waive` requires the test file to exist, but the gate's coverage lookup only finds conventional test paths — in an app with no test suite a waiver cannot be made visible to the gate; it yields after 2 blocks ("recorded, not forgiven"). Documented with fix candidates in `test-guard/references/hooks-contract.md`.

---

## 3. Remaining workstreams (priority order)

### W1 — Remote monitoring (the biggest gap: caught ≠ monitored)
Today every pipeline ends at the local logger (console + ring buffer + toast). A production error is invisible to the developer.
1. **Tracker:** unblock paused change #121 — the ONLY missing pieces are user-created Axiom dataset (`axis-prod`) + ingest token; then preview-verify → deploy → CSP canary → revoke drill → `/close_change`. Full runbook: `Axis/axiom-logging-handoff/README.md` (start at `NEXT-STEPS.md`). Tracker's `CLAUDE.md` banner says to ask the user about resuming this at session start.
2. **Everything else:** wire `logger.addSink` → Axiom via the `add-to-status-hub` skill (dual-transport pattern already exists there). The error-guard logger template deliberately exposes `addSink` + a beforeSend-style suppression point for exactly this; add first-party stack filtering (iframe host noise) at that point.
3. Acceptance: a thrown test error in a production app appears in Axiom within minutes, exactly once, with module/correlationId/context.

### W2 — Close the CEO_Display pilot
1. In-iframe manual smoke (needs the user): run dev server + tunnel from branch `error-guard-retrofit`, verify normal function, one Hebrew toast on a failing action, fallback screen (not white) on a render throw.
2. Merge — preferably by onboarding CEO_Display to the shared CI/CD pipeline (`monday-cicd` skill) and releasing through its gates. NEVER push to main directly.
3. Install vitest (`/test-guard retrofit`) and replace the recorded waivers with real mutation-proven tests for `useMondayAPI.js`, `utils/mondayApi.js`, `utils/errorHandler.js`.
4. Log the whole change in change-tracker (`/new_change` + `/close_change`) — the orchestrated run skipped it.

### W3 — Retrofit queue (one app per session, runbook mode B)
Recommended order: `Axis/Planner` (no infra, highest exposure) → `Axis/sync-calender` → `discussions` → `status-report` (git init first) → `updates-reports` → run `audit.sh` on anything left. Each: new branch, `/new_change`, runbook steps 0–8, `.error-guard` marker at the end. Expect and record runbook divergences (feed-lessons-back section).

### W4 — Server-side extension (NOT STARTED — design + docs + templates)
Current skill scope is client-side only (SKILL.md says so explicitly). Integration apps (`integration-scaffold`, Express on monday-code) need their own standard. Deliverables:
1. `references/server-patterns.md` — the server ruler, covering: async route-handler wrapper (Express 4 does NOT catch rejected promises in handlers — every async handler must be wrapped, or Express 5 semantics confirmed against live docs), single terminal error middleware (`(err, req, res, next)`) that logs once + returns a safe JSON error (no stack leakage to clients), process-level nets (`process.on('uncaughtException'/'unhandledRejection')` → log → graceful shutdown, NOT continue), webhook specifics (monday challenge echo, signature-verification failures are WARN not ERROR, respond 200 fast + queue heavy work), scheduler/queue jobs (top-level catch per job run), storage/secure-storage guards, timeouts + abort on outbound calls.
2. Server logger template — same structured record + emit/addSink/log-once contract as the client template (sinks: stdout JSON for monday-code log collection + optional Axiom transport). Note: monday-code ships `@mondaycom/apps-sdk` Logger — decide wrap-vs-replace and document why (check live docs via `ask_developer_docs` first).
3. ESLint kit adaptation for Node: same 4 rules; `no-console` exemption strategy differs (server output goes to stdout — route it through the logger, which owns the console); overrides for the server entry.
4. Integrate into `integration-scaffold` templates (middleware pre-wired, kit in package.json) the same way monday-scaffold was done.
5. Update error-guard `SKILL.md`: remove the "server-side out of scope" line, add server variants to modes A/B/C, extend the hook's path filter if server dirs differ.
6. Verify the way the client side was verified: assembled smoke (supertest hitting routes that throw sync / throw async / reject), red-gate the kit on server fixtures, then retrofit ONE real integration app as the server pilot.

### W5 — Tooling debts
1. Fix the test-guard waive catch-22 (candidates documented in `test-guard/references/hooks-contract.md`): state-only resolution for `cmd_waive`, or teach the stop-gate to match source-keyed state dirs.
2. Consider a `check.sh --staged` variant for the CI/CD pipeline (monday-cicd) so pipeline CI and the local hook agree byte-for-byte.

---

## 4. Conventions the next agent MUST respect
- Skill instruction prose and code comments in **English**; user-facing strings (toasts, fallbacks) in **Hebrew**; chat with the user in Hebrew.
- One retrofit app per session; new branch only; commits autonomous, **push / production deploy each require exactly one confirming question** (autonomy gate map in `mapps`).
- Deploys ONLY via the mapps ship procedure (`ship.sh`); bare `pnpm deploy`/`code:push` is hook-blocked.
- Never silence an error-guard rule to get green — fix the code, or follow the false-positive protocol in SKILL.md §Self-correction.
- Platform quirks / skill defects discovered → owning skill's references (`known-issues.md`) in the same session.
- Tests must be SEEN failing (test-guard); probes only in `TEST_WORKSPACE_ID=16291824` with `WZ-` prefixes.
- monday docs are live — verify unfamiliar platform behavior via `ask_developer_docs` (mapps-api.sh) before coding against it.

## 5. Quick file index
| What | Where |
|---|---|
| Skill root | `.claude/skills/error-guard/` |
| Hook | `.claude/hooks/error-guard-check.sh` (+ `.claude/settings.json`) |
| Ship gate | `.claude/skills/mapps/scripts/ship.sh` (error-guard step) |
| Scaffold infra | `.claude/skills/monday-scaffold/templates/shared/` |
| Pilot branch | `CEO_Display` @ `error-guard-retrofit` |
| Tracker reference impl | `Axis/tracker/src/utils/logger.js`, `Axis/tracker/error-handling-bundle/` |
| Axiom resume runbook (Tracker) | `Axis/axiom-logging-handoff/` |
| Research grounding | `.claude/skills/error-guard/references/research-2026-07.md` |
| Memory note | `~/.claude/projects/-Users-ilaish-monday-app-apps/memory/error-guard-skill-2026-07.md` (machine-local Claude auto-memory; exists only on the original author's machine) |
