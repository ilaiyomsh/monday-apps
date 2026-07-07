# Tech Debt — Forward Plan

**State as of 2026-05-07:** Commit `9131c6d` closed 9 findings (F001 / F002 / F003 / F019 / F020 / F021 / F022 / F024 / F028).
**Remaining:** 26 findings. Most of them **don't** need to be closed in a single PR or in a strict sequence — some depend on external action (Monday API, maintainer decisions), some need infrastructure (tests) before they can be touched safely, and some are simply low-priority items that can be deferred indefinitely.

This document sequences the remaining work into **waves** by dependency block, not by finding ID order.

---

## Wave 1 — One week, no risk, no external dependencies

Goal: close more quick wins before touching any god-file. Every item here is actionable today.

### 1.1 — F015 + F016 + F017 + F018 + F034 — "decision: docs"

**Problem:** `ARCHITECTURE.md`, `CLAUDE.md`, `REFACTORING_ROADMAP.md`, `TASKS_PLAN.md`, and the two `docs/api-*` files all contain numbers that no longer match reality (file sizes, hook lists, component layouts).

**Decision needed:** do we want those facts in the repo at all?
- **If yes:** add a `pnpm run loc` script that emits a generated table, and run it in CI on changes to `mondayApi.js` or `MondayCalendar.jsx`. All hand-maintained tables get deleted, docs link to the generated output.
- **If no (my recommendation):** delete the size tables in `CLAUDE.md` / `ARCHITECTURE.md`, replace them with a one-liner *"To run a count: `find src -name '*.js*' | xargs wc -l | sort -rn | head`."* Delete `docs/api-*-mapping.md` outright — git history is the source of truth.

**Effort:** ~2–3 hours. Standalone PR: "docs: deduplicate stale architecture references".

**Why now:** any future decision about a god-file refactor (Wave 4) requires docs that don't lie. If `CLAUDE.md` keeps claiming "MondayCalendar.jsx 993 lines" while the file is 1,910, every LLM that opens the file gets the wrong context.

---

### 1.2 — F015 — write a real README

**Problem:** `README.md` is currently the Monday Quickstart boilerplate. Anyone landing on the repo would assume this is an empty starter.

**Effort:** ~1 hour. Pull the relevant sections from `CLAUDE.md` (Project Overview, Commands, Architecture). Keep `CLAUDE.md` as the deeper reference.

---

### 1.3 — F029 — finish i18n for the last 5 components

**Problem:** `Toast`, `ErrorDetailsModal`, `UndoBanner`, `SettingsValidationDialog`, `MobileResizeOverlay` likely contain hardcoded Hebrew strings and don't import `useTranslation`.

**Effort:** half a day. One PR. Recommended order, by user-facing exposure:
1. `Toast` — most frequent.
2. `ErrorDetailsModal` — critical to the error UX.
3. `UndoBanner` — frequent, post-delete.
4. `SettingsValidationDialog` — rare, but blocks the first-install flow.
5. `MobileResizeOverlay` — edge case.

---

### 1.4 — F033 — ESLint in CI

**Problem:** `eslintConfig: react-app` is declared in `package.json` but nothing runs it in CI. Lint regressions would land silently.

**Sequence:** baseline run produced 171 problems (54 errors, 117 warnings) — too large for a single review pass, so the cleanup is split into three task branches before the CI gate lands.

1. **PR A1** — `tech-debt/wave-1.4a-eslint-baseline`: clear all 54 errors + low-risk cleanup (auto-fix `import/first`, fix malformed `eslint-disable` comments, lift hooks above early returns to fix `rules-of-hooks`, name anonymous default exports, `no-mixed-operators`, `default-case`, drop unused `vi` test imports).
2. **PR A2** — `tech-debt/wave-1.4b-unused-vars`: remaining `no-unused-vars` triage — delete dead imports/declarations, decide case-by-case whether an unused destructured field signals a real omission.
3. **PR A3** — `tech-debt/wave-1.4c-exhaustive-deps`: `react-hooks/exhaustive-deps` per-callsite triage — real fix, add dep, or `eslint-disable-next-line` with Hebrew rationale. Highest-judgment piece.
4. **PR B** — `tech-debt/wave-1.4d-eslint-ci`: add to `.github/workflows/test.yml`:
   ```yaml
   - run: pnpm exec eslint src/ --ext .js,.jsx --max-warnings 0
   ```
5. Optional: add `pnpm audit --prod --audit-level=high` as a non-blocking step.

**Effort:** A1 ~1–2h, A2 ~1–2h, A3 ~half-day, B ~30min.

**Risk:** lint has never run here; warning count came in at 117. Expected, and that's why the cleanup is sequenced.

---

**Wave 1 summary:** 4–5 small PRs, ~two work-weeks (not calendar weeks). Near-zero risk.

---

## Wave 2 — Test infrastructure (blocks Wave 4)

### 2.1 — F026 — integration tests before any decompose

**Problem:** the six god-files (`MondayCalendar` 1910, `MappingTab` 1535, `mondayApi` 1420, `AllDayEventModal` 1212, `EventModal` 871, `AdditionalTab` 786) have **no test coverage**. They cannot be split safely without a safety net. The current 701 tests are unit-level around `utils/` — they don't cover any user flow.

**What to write:** not Cypress (overhead). RTL + jsdom (already installed):
1. **`MondayCalendar` — "create timed event"** — render the calendar, click a time slot, fill `EventModal`, save, assert the event renders.
2. **`MondayCalendar` — "create all-day vacation"** — same flow but through `AllDayEventModal`.
3. **`MondayCalendar` — "drag event to new time"** — `fireEvent.drag`, assert `updateEventPosition` was called.
4. **`MondayCalendar` — "filter by reporter"** — open `FilterBar`, select a reporter, assert `loadEvents` is called with updated `filterRules`.
5. **`SettingsDialog` — "change structure mode"** — switch from `PROJECT_ONLY` to `PROJECT_WITH_STAGE`, assert `MappingTab` shows the new fields.
6. **`EventModal` — "convert temporary to billable"** — assert `convert` mode works.

Each of these needs a `monday-sdk-js` mock. `src/test-utils/mondayMock.js` already exists — extend it.

**Effort:** 6 tests × 2–4 hours = a full week, spreadable over two days.

**Payoff:** the moment `MondayCalendar` renders cleanly under mock, splitting it stops being scary. Every extraction PR re-runs those six tests as proof that no flow regressed.

---

## Wave 3 — Unify API wrappers (blocks the `mondayApi.js` split)

### 3.1 — F013 + F014 — `safeApi` with retry

**Problem:** 53 callers use `safeApi`, which has no 429 retry. The issue documented in `docs/api-concurrency-issue.md` is still relevant for most of them.

**Steps:**
1. Extract the retry loop from `wrapMondayApiCall` into a helper `executeWithRetry(fn, options)`.
2. Apply it to `safeApi`. Both signatures stay backward-compatible.
3. Migrate the 19/27 internal `wrapMondayApiCall` callers to `safeApi` (this happens during the `mondayApi.js` split in Wave 4 — no need to do it now).
4. Regression check: the existing `mondayApiRetry.test.js` should pass against the unified helper.

**Effort:** one PR. ~1 day. Risk: medium — touches the API layer. The 29 retry tests are a decent safety net.

**Optional:** add a request queue (option B) or startup staggering (option C) from the doc — but if retry resolves 95 % of the 429 hits, that can wait.

---

## Decomposition phase — Waves 4–8 (one wave per god-file)

**Updated 2026-05-08:** the original "Wave 4" is split into one wave per god-file. Reasons (full rationale in `tech-debt/wave-4-plan.md`): reviewability (≤4 sub-tasks per wave is the methodology sweet spot), independent revertability (a stalled extraction in one file shouldn't block the next), and explicit pattern transfer (each wave's learnings feed the next wave's plan).

| Wave | Closes | File | LOC | Plan |
|---|---|---|---|---|
| **Wave 4** | F007 | `src/utils/mondayApi.js` | 1,460 | Per-task contracts in `STATUS.md`. Design in `wave-4-plan.md`. |
| **Wave 5** | F005 | `src/MondayCalendar.jsx` | 1,906 | Per-task contracts in `STATUS.md`. Design in `wave-5-plan.md`. ROADMAP §4.1 has the extraction sequence. |
| **Wave 6** | F006 + F011 | `src/components/SettingsDialog/MappingTab.jsx` + `AdditionalTab.jsx` | 1,540 + 786 | TBD — `useColumnDiscovery` extraction closes both. ROADMAP §4.3 has the sketch. |
| **Wave 7** | F008 + F010 | `AllDayEventModal.jsx` + `EventModal.jsx` | 1,213 + 871 | TBD — paired modals share `useEventModalState`. ROADMAP §4.4 has the sketch. |
| **Wave 8** | F009 | `src/hooks/useMondayEvents.js` | 929 | TBD — last per ROADMAP §4.5; load-bearing memoization, optimistic updates. |

**Principle (unchanged):** never split a file without at least one integration test covering its flow. Never big-bang.

### 4.1 — F005 — `MondayCalendar.jsx` (1,910 → ~600)

**Step 1 — `useCalendarSwipe`** (lines 257–329 — swipe + finger-following):
- 70 lines, fully self-contained, zero shared state.
- Safety net: the drag/drop test from Wave 2 (#3).
- Result: ~1,840 LOC.

**Step 2 — extend `useApproval`** with `handleApproveSelected`, `handleApproveAllInWeek`, `handleApproveEvent`, `handleRejectEvent` (lines 1233–1310):
- 80 lines, but 7+ context values to thread through. Plan two PRs: PR A moves logic into the hook, PR B cleans up the wrappers.
- Safety net: write one new test for "approve event from calendar".
- Result: ~1,720 LOC.

**Step 3 — `useCalendarSelection`** (multi-select state + handlers, ~120 lines):
- Result: ~1,600 LOC.

**Step 4 — `useUndoState` + `UndoBanner` integration:**
- Result: ~1,500 LOC.

**Step 5 — composition: `MondayCalendar` calls `useMondayCalendarHooks()`** (one composite hook that wires the rest):
- Result: ~1,200 LOC.

After those steps the render body is mostly JSX + modals. Splitting into child components brings the file to ~600.

**Effort:** step-by-step, each is its own PR with a test. Total: 2–3 weeks spread over 2 months.

---

### 4.2 — F007 — split `mondayApi.js` (1,420 LOC) — **only after Wave 3**

**Target layout:**
```
src/utils/mondayApi/
  client.js        — safeApi + executeWithRetry + MondayApiError
  items.js         — fetchItemById, createBoardItem, deleteItem, updateItemColumnValues
  boards.js        — fetchConnectedBoardsFromColumn, fetchUniquePeopleFromBoard
  columns.js       — fetchColumnSettings, fetchStatusColumnSettings, parseStatusLabels
  mirror.js        — resolveMirrorSourceColumn (now with proper logger.debug)
  index.js         — barrel re-export
```

**Effort:** 1–2 days. One PR. Safety net: the 29 retry tests + Wave 2 integration tests.

---

### 4.3 — F006 — `MappingTab.jsx` (1,535 LOC)

Waits on F005 — the extraction pattern from there is reusable here. Four splits: `EventTypeSection`, `ProjectTypeSection`, `AssignmentsSection`, `useColumnDiscovery`.

---

### 4.4 — F008 + F010 — `AllDayEventModal` (1,212) + `EventModal` (871)

Split as a pair — they share patterns. Extract `useEventModalState` first (state machine), then sub-sections.

---

### 4.5 — F009 — `useMondayEvents.js` (929 LOC)

**Last in Wave 4** because it's the riskiest — 6 `eslint-disable react-hooks/exhaustive-deps` annotations with real justifications, optimistic updates, pagination, refs. Touch only at the very end, and only if there's slack.

---

## Wave 9 — Low priority / decision-blocked

> Renumbered from Wave 5 on 2026-05-08 to make room for Waves 5–8 (one wave per god-file).

### 9.1 — F004 — Vulnerabilities

**State:** `react-big-calendar > lodash-es` (high severity, prod). `@mondaycom/apps-cli` (build-time only).

**Complexity:** there's a patch at `patches/react-big-calendar+1.19.4.patch`. An upgrade requires re-validating that the patch still applies, or porting it to the new version.

**Effort:** half a day. Standalone PR. Manual DnD smoke test after the upgrade (drag / resize / horizontal-direction guard).

---

### 9.2 — F011 — `AdditionalTab.jsx` (786 LOC)

**Defer:** F006 (splitting `MappingTab`) will extract `useColumnDiscovery`. Once that exists, `AdditionalTab` consumes it and naturally drops to ~500 LOC. Nothing to do here right now.

---

### 9.3 — F012 + F027 — `settings_str` in `useBoardBuilder.js`

**Blocked on:** verification from Monday — is the typed `settings` field populated on freshly-created columns?
- **If yes** → migrate to `settings`.
- **If no** → update `CLAUDE.md` ("never use `settings_str`" → "never use `settings_str` **except for newly-created columns in `useBoardBuilder`**, where typed `settings` isn't populated yet"). The existing code is correct.

**Effort (after the answer):** minutes.
**How to verify:** open an issue in the Monday Developers community, or write a short script that creates a column and immediately queries both `settings` and `settings_str` for comparison.

---

### 9.4 — F023 — 13 unused exports in `mondayApi.js`

**Blocked on:** maintainer decision — are those names (`fetchCurrentUser`, `createTask`, `fetchItemById`, etc.) intentional future API surface, or leftovers?

**My recommendation:** delete now, add back when someone needs them. Future-proofing is cheap to undo in an internal monorepo. If this were an external library, different story.

---

### 9.5 — F025 — PropTypes / TypeScript

**Defer indefinitely.** Either a strategic migration to TypeScript (large), or stay with JSDoc + integration tests (status quo). Halfway is worse than either.

---

### 9.6 — F030 — `settingsSchemaVersion`

**Don't do it yet.** Add a schema version when the *next* migration arrives. Right now it's overhead with no payoff.

---

### 9.7 — F031, F032, F035 — Polish

Large CSS modules, log-and-rethrow helper, dual-storage helper. **Not tech debt — style.** Don't schedule.

---

## Recommended timeline (if everything runs smoothly)

| Week | Work |
|------|------|
| 1 | Wave 1 — docs cleanup, README, ESLint baseline, i18n for the 5 components |
| 2 | ESLint cleanup + CI enforcement |
| 3 | Wave 2 — integration tests (#1, #2 — timed event + all-day vacation) |
| 4 | Wave 2 — tests #3, #4, #5, #6 |
| 5 | Wave 3 — `safeApi` retry unification |
| 6 | Wave 4 — split `mondayApi.js` (F007) |
| 7 | Wave 5 — `MondayCalendar` extractions, steps 1+2 (swipe + approval) |
| 8 | Wave 5 — `MondayCalendar` extractions, steps 3+4 |
| 9–10 | Wave 6 — `MappingTab` + `AdditionalTab` (F006 + F011) |
| 11–12 | Wave 7 — modals (`AllDayEventModal` + `EventModal`) |
| 13+ | Wave 8 — `useMondayEvents`, then Wave 9 (vulnerabilities + open decisions) |

---

## Iron rules along the way

1. **Never touch a god-file without at least one integration test covering its flow.** If there isn't one — write it first.
2. **One extraction per PR.** 70–150 LOC moved per PR. Not 500.
3. **Don't move behavior without verifying the user-flow before and after are identical.** Even if the code looks identical — verify.
4. **Update `tech-debt/ANALYSIS.md` after every closed finding.** It must remain the single source of truth for status.
5. **`pnpm run test:run` must be green before merge.** Currently 701/701.
6. **No big-bang refactors. Ever.**

---

## Why this isn't faster

The most recent PR (`refactor(events): move temporary flag to checkbox`) is a good example of scope: focused change, landed cleanly. If we keep that cadence — one extraction from `MondayCalendar` per week — we hit "all done by week 13" in the non-optimistic case.

The main risk: **the test wave (Wave 2) is boring.** It's tempting to skip and start splitting immediately. But refactoring a 1,910-LOC component without tests is exactly how you ship regression bugs that nobody notices until a user complains six weeks later.
