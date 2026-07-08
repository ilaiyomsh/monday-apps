# Tech-Debt Status — Operational Queue

> **Source of truth for "what's next" and "what's in-flight"**.
> Builders read 🟢 NEXT to pick up work. Reviewers read 🟡 IN-REVIEW to audit. Both update this file as part of their handoff.
>
> See also:
> - `ROADMAP.md` — strategy and wave sequencing (slow-changing).
> - `ANALYSIS.md` — per-finding history and "Fix applied" contracts (live).
> - `README.md` — methodology, branching rules, working agreements.

## Wave overview

| Wave | Scope | Status |
|---|---|---|
| **Wave 1** | Docs cleanup, README, i18n, ESLint baseline + ratchet | ✅ MERGED |
| **Wave 2** | Integration harness + 6 golden-flow tests (F026) | ✅ MERGED |
| **Wave 3** | Unify retry loop via `executeWithRetry` (F013 + F014) | ✅ MERGED |
| **Wave 4** | Split `mondayApi.js` (F007) | ✅ MERGED |
| **Wave 5** | Decompose `MondayCalendar.jsx` (F005, 1,906 LOC) | 🚧 IN-PROGRESS — Wave 5.1.x complete (5.1.4 merged at 1b97d43); Wave 5.2 / 6 unblocked (see `wave-5-plan.md`) |
| **Wave 6** | Decompose `MappingTab.jsx` + absorb `AdditionalTab.jsx` (F006 + F011) | ⬜ FUTURE |
| **Wave 7** | Modal pair `AllDayEventModal` + `EventModal` (F008 + F010) | ⬜ FUTURE |
| **Wave 8** | Decompose `useMondayEvents.js` (F009) — riskiest, last | ⬜ FUTURE |
| **Wave 9** | Low-priority / decision-blocked findings (F004, F012, F023, F025, F030–F032, F035) | ⬜ FUTURE |

Source: `wave-4-plan.md` §Wave map. Per-wave queues and specs follow below.

## How agents use this file

| Agent | Reads | Writes |
|-------|-------|--------|
| Builder (Prompt 1) | The first row marked 🟢 NEXT, plus the matching "Per-task spec" below the queue. | Flips the row to 🚧 IN-PROGRESS when starting; to 🟡 IN-REVIEW when staging is done. Fills the `Branch` cell. |
| Reviewer-Merger (Prompt 2) | The first row marked 🟡 IN-REVIEW, plus the same spec. | After merge, flips to ✅ MERGED and fills the `Merge SHA` column. Promotes the next row to 🟢 NEXT if blockers cleared. |

Iron rule: a builder never picks up a 🟡 row, a reviewer never picks up a 🟢 row. If two rows are both 🟢 the builder picks the lowest-numbered. If two rows are both 🟡 the reviewer picks the oldest.

## Status legend

- ⬜ **FUTURE** — depends on earlier rows; not pickable.
- 🟢 **NEXT** — ready to pick up; no blockers.
- 🚧 **IN-PROGRESS** — a builder is currently working. Set by the builder before staging.
- 🟡 **IN-REVIEW** — branch exists with staged work; awaiting a reviewer.
- ✅ **MERGED** — landed in `chore/tech-debt-sweep`.

## Active wave

**Wave 5** — decompose `MondayCalendar.jsx` (F005, 1,906 LOC). Largest god-file in the codebase; Wave-2 integration suite (4 of 6 tests mount the calendar) is the structural safety net. Per ROADMAP §4.1: extract `useCalendarSwipe` (step 1) → extend `useApproval` in two PRs (step 2) → `useCalendarSelection` (step 3) → `useUndoState` + `UndoBanner` (step 4) → composition `useMondayCalendarHooks` (step 5). Target: ~1,400 LOC after Wave 5.1.x; deeper child-component split deferred to Wave 5.2 or later. See `tech-debt/wave-5-plan.md` for design rationale and `ROADMAP.md` §4.1 for the source-of-truth extraction sequence.

## Queue

| #       | Sub-task                                                                          | F0XX | Branch                                          | PR | Status         | Merge SHA  |
|---------|-----------------------------------------------------------------------------------|------|-------------------------------------------------|----|----------------|------------|
| 5-plan  | Wave 5 plan + Wave 4 archive (docs only)                                          | —    | `tech-debt/wave-5-plan`                         | [#23](https://github.com/ilaiyomsh/tracker/pull/23) | ✅ MERGED      | 99e85e4    |
| 5.1.0   | Extract `useCalendarSwipe` hook (swipe state + finger-following)                  | F005 | `tech-debt/wave-5.1.0-swipe`                    | [#24](https://github.com/ilaiyomsh/tracker/pull/24) | ✅ MERGED      | 28cc3ab    |
| 5.1.1a  | Move approval-handler logic into `useApproval` (toast + reload + selection-clear) | F005 | `tech-debt/wave-5.1.1a-approval-logic`          | [#25](https://github.com/ilaiyomsh/tracker/pull/25) | ✅ MERGED      | c1cd2f6    |
| 5.1.1b  | Replace inline approval handlers in `MondayCalendar` with hook references         | F005 | `tech-debt/wave-5.1.1b-approval-wrappers`       | [#26](https://github.com/ilaiyomsh/tracker/pull/26) | ✅ MERGED      | 4b7fd35    |
| 5.1.2   | Extract `useCalendarSelection` (selection-mode toggle + duplicate/delete handlers)| F005 | `tech-debt/wave-5.1.2-selection`                | [#27](https://github.com/ilaiyomsh/tracker/pull/27) | ✅ MERGED       | 8e89340    |
| 5.1.3   | Extract `useUndoState` + integrate `UndoBanner` glue                              | F005 | `tech-debt/wave-5.1.3-undo`                     | [#28](https://github.com/ilaiyomsh/tracker/pull/28) | ✅ MERGED       | 72cf7aa    |
| 5.1.4   | Composition — `useMondayCalendarHooks()` wires the new hooks                      | F005 | `tech-debt/wave-5.1.4-composition`              | [#29](https://github.com/ilaiyomsh/tracker/pull/29) | ✅ MERGED       | 1b97d43    |

> Sequencing: 5-plan ships first (docs-only — establishes the per-task contracts below). 5.1.0 promotes after 5-plan merges. 5.1.1a promotes after 5.1.0; 5.1.1b promotes after 5.1.1a (logic move + cleanup are deliberately split — see plan). 5.1.2 / 5.1.3 / 5.1.4 sequence linearly: each row's `**Fix applied:**` entry feeds the next row's plan. Methodology iron rule: one row at a time.
>
> Targets F005. Wave 6 (`MappingTab.jsx` + `AdditionalTab.jsx`, F006 + F011) unblocks once 5.1.4 merges and the extraction patterns harden.

## Archive — Wave 4

| #       | Sub-task                                                                          | F0XX        | Branch                                          | PR | Status     | Merge SHA  |
|---------|-----------------------------------------------------------------------------------|-------------|-------------------------------------------------|----|------------|------------|
| 4-plan  | Wave 4 plan + Wave 3 archive + ROADMAP renumber (docs only)                       | —           | `tech-debt/wave-4-plan`                         | —  | ✅ MERGED   | ae8ecfd    |
| 4.1.0   | Bootstrap `mondayApi/` directory + barrel re-export (zero behavior change)        | F007        | `tech-debt/wave-4.1.0-barrel-bootstrap`         | [#17](https://github.com/ilaiyomsh/tracker/pull/17) | ✅ MERGED   | 7bab9d1    |
| 4.1.1   | Move `client.js` (wrappers + retry + error class + query validator)               | F007        | `tech-debt/wave-4.1.1-client-module`            | [#18](https://github.com/ilaiyomsh/tracker/pull/18) | ✅ MERGED   | 4c8bc06    |
| 4.1.2   | Move `columns.js` + `mirror.js` (settings parsing + mirror resolution)            | F007        | `tech-debt/wave-4.1.2-columns-mirror`           | [#19](https://github.com/ilaiyomsh/tracker/pull/19) | ✅ MERGED   | 084fea6    |
| 4.1.3   | Move `boards.js` (board-level fetchers)                                           | F007        | `tech-debt/wave-4.1.3-boards-module`            | [#20](https://github.com/ilaiyomsh/tracker/pull/20) | ✅ MERGED   | ffb533f    |
| 4.1.4   | Move `items.js` (item-level fetchers — ~14 functions)                             | F007        | `tech-debt/wave-4.1.4-items-module`             | [#21](https://github.com/ilaiyomsh/tracker/pull/21) | ✅ MERGED   | 0683e4c    |
| 4.1.5   | Migrate 27 internal `wrapMondayApiCall` callers to `safeApi`; delete the wrapper  | F007 + F013 | `tech-debt/wave-4.1.5-unify-wrappers`           | [#22](https://github.com/ilaiyomsh/tracker/pull/22) | ✅ MERGED   | 8725599    |

## Archive — Wave 3

| #       | Sub-task                                                   | F0XX        | Branch                                       | Status     | Merge SHA  |
|---------|------------------------------------------------------------|-------------|----------------------------------------------|------------|------------|
| 3-plan  | Wave 3 plan + Wave 2 archive (docs only)                   | —           | `tech-debt/wave-3-plan`                      | ✅ MERGED   | 434c403    |
| 3.1.0   | Extract `executeWithRetry(fn, options)` helper             | F013        | `tech-debt/wave-3.1.0-extract-retry`         | ✅ MERGED   | ce2d65a    |
| 3.1.1   | Apply retry to `safeApi` via `executeWithRetry`            | F013 + F014 | `tech-debt/wave-3.1.1-safeapi-retry`         | ✅ MERGED   | 1331bcc    |
| 3.1.2   | Integration regression — `safeApi` retries 429 in a flow   | F014        | `tech-debt/wave-3.1.2-safeapi-integration`   | ✅ MERGED   | be4fab6    |

## Archive — Wave 2

| #       | Sub-task                                       | F0XX | Branch                                            | Status     | Merge SHA  |
|---------|------------------------------------------------|------|---------------------------------------------------|------------|------------|
| 2-plan  | Wave 2 plan + Wave 1 archive (docs only)       | —    | `tech-debt/wave-2-plan`                           | ✅ MERGED   | 0af5375    |
| 2.1.0   | Integration harness + smoke test               | F026 | `tech-debt/wave-2.1.0-integration-harness`        | ✅ MERGED   | 9051421    |
| 2.1.1   | Integration test — create timed event          | F026 | `tech-debt/wave-2.1.1-create-timed`               | ✅ MERGED   | f746ab6    |
| 2.1.2   | Integration test — create all-day vacation     | F026 | `tech-debt/wave-2.1.2-create-allday`              | ✅ MERGED   | 23fe6c1    |
| 2.1.3   | Integration test — drag event to new time      | F026 | `tech-debt/wave-2.1.3-drag-event`                 | ✅ MERGED   | ef7b31d    |
| 2.1.4   | Integration test — filter by reporter          | F026 | `tech-debt/wave-2.1.4-filter-reporter`            | ✅ MERGED   | 4ad469f    |
| 2.1.5   | Integration test — change structure mode       | F026 | `tech-debt/wave-2.1.5-structure-mode`             | ✅ MERGED   | 9e825c0    |
| 2.1.6   | Integration test — convert temporary to billable | F026 | `tech-debt/wave-2.1.6-convert-temporary`        | ✅ MERGED   | 622bb15    |

## Archive — Wave 1

| #     | Sub-task                                | F0XX     | Branch                                    | Status      | Merge SHA  |
|-------|-----------------------------------------|----------|-------------------------------------------|-------------|------------|
| 1.1   | Docs cleanup (size tables, archive)     | F015–F018, F034 | (merged earlier in sweep)          | ✅ MERGED   | 1e4398b    |
| 1.2   | README rewrite                          | F015     | (merged earlier in sweep)                 | ✅ MERGED   | a87b345    |
| 1.3   | i18n final five components              | F029     | (merged earlier in sweep)                 | ✅ MERGED   | be78941    |
| 1.4a  | ESLint baseline + low-risk cleanup      | F033     | (merged)                                  | ✅ MERGED   | c54ebff    |
| 1.4b  | `no-unused-vars` cleanup                | F033     | (merged)                                  | ✅ MERGED   | 3456ec2    |
| 1.4-plan | Wave 1.4 plan split (docs only)      | —        | `tech-debt/wave-1.4-plan-update`          | ✅ MERGED   | 22135ba    |
| 1.4-status | STATUS.md operational queue       | —        | `tech-debt/wave-1.4-status-doc`           | ✅ MERGED   | 1af1083    |
| 1.4c  | `react-hooks/exhaustive-deps` audit + cheap fixes | F033 | `tech-debt/wave-1.4c-exhaustive-deps`   | ✅ MERGED   | 255d31a    |
| 1.4d  | ESLint `--max-warnings <N>` in CI       | F033     | `tech-debt/wave-1.4d-eslint-ci`           | ✅ MERGED   | 75160d3    |
| 1.4e  | Stabilize `t` from react-i18next        | F033     | `tech-debt/wave-1.4e-stable-t`            | ✅ MERGED   | c2bd8b2    |

---

## Per-task specs

Specs are read-only contracts. The builder copies the In-scope / Out-of-scope / Verification-baseline blocks verbatim into the `**Fix applied:**` entry in `ANALYSIS.md`, then expands them with what actually shipped. The reviewer audits the diff against the same block.

### 1.4b — `no-unused-vars` cleanup

- **Goal:** clear all `no-unused-vars` warnings from the ESLint baseline.
- **Approach:** mechanical. Remove dead imports / dead destructure aliases / dead local declarations. For genuinely-needed setter-only `useState` patterns or dormant-feature code, annotate with `// eslint-disable-next-line no-unused-vars -- <Hebrew rationale>` rather than deleting (deletion is a functional change, out of scope).
- **In scope:** every site surfaced by `pnpm exec eslint src/ --ext .js,.jsx` with rule `no-unused-vars`.
- **Out of scope:** any other lint rule, any refactor not driven by an unused-var warning, any deletion of dormant feature code.
- **God-files:** narrow edits only (parameter dropping, dead-destructure cleanup) — no refactors.
- **Verification baseline expected:** 0 `no-unused-vars` warnings remaining; total lint count drops from ~95 to ~48 (the residual being all `react-hooks/exhaustive-deps`). Tests 700/701 (env-dependent feature-flag failure unchanged). Build clean.
- **History:** see `ANALYSIS.md` F033 for prior wave contracts.
- **Status note:** merged at `3456ec2` (merge commit predates STATUS.md; row backfilled by reviewer).

### 1.4-plan — Wave 1.4 plan split (docs only)

- **Goal:** record in `ROADMAP.md` and `tech-debt/README.md` that Wave 1.4 is now four PRs (A1 + A2 + A3 + B), not two, after the baseline lint run came in larger than anticipated (171 problems, 54 errors).
- **In scope:** `tech-debt/ROADMAP.md` section 1.4; `tech-debt/README.md` Wave-1 task #4.
- **Out of scope:** any code change, any other section of those docs, any other doc.
- **God-files:** none.
- **Verification baseline expected:** no test/build impact (docs only).
- **Status note:** committed on branch — awaiting reviewer.

### 1.4-status — STATUS.md operational queue (this PR)

- **Goal:** introduce `tech-debt/STATUS.md` as the queue + per-task contract source so builder/reviewer agents can run without manual hand-holding.
- **In scope:** create `tech-debt/STATUS.md`; cross-reference it from `tech-debt/README.md` "Agent procedure" section so future agents discover it.
- **Out of scope:** any change to `ROADMAP.md`, `ANALYSIS.md`, `AUDIT.md`, or `src/`.
- **God-files:** none.
- **Verification baseline expected:** no test/build impact (docs only).
- **Status note:** committed on branch — awaiting reviewer. Bootstrap exception: this is the row that introduces the workflow itself, so it was authored under the rules it documents.

### 1.4c — `react-hooks/exhaustive-deps` audit + cheap fixes + known-debt list

- **Goal (revised 2026-05-07):** apply *only* cheap real fixes (add a missing dep, drop an unnecessary dep). Document every remaining warning as a known-debt entry in `ANALYSIS.md` F033 with file:line, classification, and the wave that will resolve it. Do **not** suppress via `// eslint-disable-next-line` — bulk suppression would mask future regressions and pollute god-files we plan to tear down in Wave 4.
- **Why the change from "clear all to zero":** original spec assumed suppression was the right tool when a value is "genuinely stable" (e.g. `t` from react-i18next). In practice that meant ~30 disable comments for one library quirk plus deferred refactors in god-files. Two failure modes: (1) a wrong rationale wouldn't be caught by the CI gate planned for 1.4d, since the rule is suppressed at the site; (2) when Wave 4 dismantles `MondayCalendar.jsx`/`MappingTab.jsx`/`AllDayEventModal.jsx`, the suppressions vanish anyway — they were never the fix, just bureaucracy. Better to track the count, gate regressions at that count, and let Wave 4 work the count down naturally.
- **In scope:**
  1. Real fixes: dependencies that ESLint correctly identifies as missing AND the closure actually needs them (or unnecessary deps that can be dropped without behavior change). Each fix verified by re-running the affected hook's flow if it's a UI hook.
  2. Catalog: under F033 in `ANALYSIS.md`, list every remaining warning with file:line, rule rationale, classification (`cheap-skip` / `god-file` / `local-async-fn` / `narrow-object-access` / `t-from-i18next` / `parent-prop`), and the wave/finding that will resolve it.
- **Out of scope:**
  - Any `// eslint-disable-next-line react-hooks/exhaustive-deps` addition. If a warning isn't a cheap real fix, it goes on the known-debt list, untouched.
  - Refactoring local async functions to `useCallback` (changes behavior — wave 4).
  - Touching god-files beyond what was already listed (`MondayCalendar.jsx`, `AllDayEventModal.jsx`, `MappingTab.jsx`, `useMondayEvents.js`).
  - ESLint config changes (`react-app` extends stays as-is, per 1.4d spec).
- **Verification baseline expected:** lint count drops from 48 → ~46 (the two cheap fixes). Tests 700/701 (env-dependent failure unchanged). Build clean. Known-debt list in `ANALYSIS.md` enumerates every remaining warning.
- **Hand-off to 1.4d:** the count after 1.4c becomes 1.4d's `--max-warnings <N>` threshold.
- **Promotable when:** 1.4-status, 1.4b, and 1.4-plan all merged into sweep. ✅ all merged.

### 1.4d — ESLint `--max-warnings <N>` in CI (controlled threshold)

- **Goal (revised 2026-05-07):** add `pnpm exec eslint src/ --ext .js,.jsx --max-warnings <N>` step to `.github/workflows/test.yml` where `<N>` is the count of `react-hooks/exhaustive-deps` known-debt entries catalogued in 1.4c (expected: ~46). A regression that adds a *new* warning fails CI; the catalogued ones do not. As Wave 4 dismantles the god-files and Wave 2 introduces test scaffolding, future PRs will lower `<N>` toward 0.
- **Why the change from `--max-warnings 0`:** see 1.4c rationale. Zero would require bulk suppression that hides new bugs and creates noise the Wave 4 refactor will delete anyway. Threshold gating at the post-1.4c count delivers the same regression-detection guarantee with no bureaucracy.
- **In scope:** `.github/workflows/test.yml` only. The `<N>` value is pinned to the count produced by 1.4c — record it in the workflow comment so reviewers can spot drift.
- **Out of scope:** ESLint config changes (the `react-app` extends stays as-is); any new dev dependencies; the optional `pnpm audit` step (deferred); ratcheting `<N>` down (1.4e handles the next ratchet via a stable-`t` shim).
- **God-files:** none.
- **Verification baseline expected:** new CI job runs and passes on this branch and on sweep. Warning count exactly matches the threshold. Tests 700/701. Build clean.
- **Promotable when:** 1.4c merged.

### 1.4e — Stabilize `t` from `react-i18next` (drop 13 warnings)

- **Goal:** eliminate the 13 `react-hooks/exhaustive-deps` warnings whose missing dep is `t` from `useTranslation()` (5 in non-god files: `Dashboard.jsx`, `useAllDayEvents.js`, `useCalendarHandlers.js` ×2, `useUndoDelete.js`; 8 in `MondayCalendar.jsx`). Lower the 1.4d CI threshold from 46 → 33 in the same PR.
- **Approach (investigate, then pick one — don't ship without picking):**
  1. **Custom hook `useStableT()`** — a tiny wrapper that returns a `t` reference whose identity is stable across renders within the same language. Call sites swap `useTranslation()` for `useStableT()` and the warning goes away because ESLint sees the call as a known-stable hook (or the value can be added to deps without triggering re-runs). This is the most likely path; ~1 file added under `src/i18n/`, plus 13 line edits.
  2. **`react-hooks/exhaustive-deps` `additionalHooks` regex** — only useful for *custom* hooks that match a name pattern; doesn't directly mark a *value* as stable. Likely insufficient for the `t` case but worth ruling out.
  3. **eslint-plugin-react-hooks knownStable hint or v5 `useEffectEvent`** — investigate whether the plugin version pinned by `react-app` supports a stable-callback hint. If yes, single config line. If no, fall back to (1).
- **In scope:** the chosen mechanism (file added or config edited), 13 call-site edits, threshold drop in `.github/workflows/test.yml` from 46 → 33, ANALYSIS.md F033 catalog updated to remove the 13 `t-from-i18next` rows and add a "Fix applied — Wave 1.4e" bullet.
- **Out of scope:** the other 33 known-debt warnings (god-file structural / narrow-object-access / local-async-fn / migrate-helper); any other ESLint rule; touching the god-files beyond the 8 narrow `MondayCalendar.jsx` line edits at the warning sites.
- **God-files:** `MondayCalendar.jsx` — 8 line edits at the warning sites only (swap `t` source to the stable variant). No structural change. This is the wave-1 narrow exception, same shape as 1.4a/1.4b's god-file edits.
- **Verification baseline expected:** lint count 46 → 33 (`--max-warnings 33` in CI). Tests 700/701. Build clean. CI passes on this branch and on sweep.
- **Promotable when:** 1.4d merged (threshold gate in place at 46; this row drops it).
- **Risk to flag during builder review:** if option (1) is chosen, the new hook needs to handle language switches correctly — `t`'s identity *should* update when `i18n.language` changes (otherwise stale strings render). The shim must memoize on `i18n.language`, not return a frozen reference.

---

### 3-plan — Wave 3 plan + Wave 2 archive (docs only)

- **Goal:** seed Wave 3 in `STATUS.md` (queue + per-task specs), archive Wave 2 rows under `## Archive — Wave 2`, add `tech-debt/wave-3-plan.md` design doc, and stamp `ANALYSIS.md` F013 + F014 as in-progress with a pointer to the plan.
- **In scope:** `tech-debt/STATUS.md` (this section + queue + Wave 2 archive); `tech-debt/wave-3-plan.md` (new); `tech-debt/ANALYSIS.md` F013 + F014 entries only.
- **Out of scope:** any code change; any change to `ROADMAP.md`, `AUDIT.md`, or `README.md`; any new `src/` file (those land in 3.1.0–3.1.2).
- **God-files:** none.
- **Verification baseline expected:** no test/build impact (docs only). Lint stays at 34. Tests 707/708.
- **Status note:** committed on branch — awaiting reviewer.

### 3.1.0 — Extract `executeWithRetry(fn, options)` helper

- **Goal:** factor the retry loop currently embedded in `wrapMondayApiCall` (`src/utils/mondayApi.js:204-256`) into a reusable internal helper `executeWithRetry(fn, { functionName, onRetry })`. Rewrite `wrapMondayApiCall` internally to call it. **No behavior change.** No call-site change.
- **In scope:**
  1. `src/utils/mondayApi.js` — extract `executeWithRetry`; rewrite `wrapMondayApiCall` body to use it; preserve the existing `logger.warn` retry message verbatim via the `onRetry` callback. Add `executeWithRetry` to `_testHelpers`.
  2. `src/utils/__tests__/mondayApiRetry.test.js` — add 5–8 tests for the extracted helper: retries on retryable error → resolves on second attempt, throws after `MAX_RETRIES` exhausted, does not retry on non-retryable error, honors `retry_in_seconds` from `extensions`, falls back to exponential backoff (2s/4s) when no `retry_in_seconds`, calls `onRetry` callback with `{error, attempt, delay}` shape.
- **Out of scope:** `safeApi` (3.1.1's job). Any behavior change in `wrapMondayApiCall`. Logging-format edits. Any of the 27 caller sites. New retry knobs (jitter, custom MAX_RETRIES, etc.).
- **God-files:** `src/utils/mondayApi.js` is the file under refactor. Edits are narrow surgical changes at lines 196-257 only — no structural reshape, no movement of unrelated functions.
- **Verification baseline expected:** lint stays at 34. Tests `707 + N new = ~712-715 / one-more-than-pre-existing-failures`. Build clean. Spot-check: a `wrapMondayApiCall` caller (e.g., `fetchProjectsForUser`) still retries on a synthesized 429 (covered by an existing test if present, or add one).
- **Risk to flag during builder review:** preserve `logger.warn` message string verbatim (`${functionName} - Retryable error, attempt N/MAX_RETRIES, waiting Xms`) — emit it inside `onRetry` so log assertions don't break. Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` in new tests so they don't add 6+ seconds to suite runtime.
- **Promotable when:** 3-plan merged.

### 3.1.1 — Apply retry to `safeApi` via `executeWithRetry`

- **Goal:** wire `safeApi` (`src/utils/mondayApi.js:271-314`) through `executeWithRetry` so the 53 `safeApi` callers across 17 files get the same 429/transport retry coverage that `wrapMondayApiCall` callers already have. Closes F014 (the documented `safeApi` 429 issue) and the F013 wrapper-divergence root.
- **In scope:**
  1. `src/utils/mondayApi.js` — `safeApi` body wraps the SDK call in `oneAttempt`; passes through `executeWithRetry`. Preserve all existing semantics: GraphQL soft errors still log-and-return (don't throw), transport errors still wrap in `MondayApiError`. Match `wrapMondayApiCall`'s `onRetry` log-line so both wrappers emit identically-shaped retry warnings.
  2. New `src/utils/__tests__/safeApiRetry.test.js` — 6–8 tests covering: retries on 429 transport error (resolves second attempt), retries on `RATE_LIMIT_EXCEEDED`-coded thrown error, gives up after `MAX_RETRIES` and throws `MondayApiError`, does NOT retry on non-retryable transport (e.g., 401), does NOT retry on soft GraphQL errors (call counts === 1, response returned with `errors` array intact), honors `retry_in_seconds`, final-failure `MondayApiError` has `apiRequest.query` populated.
- **Out of scope:** any change to the 53 caller sites (none should need modification — that's the proof of backward compatibility). `wrapMondayApiCall` (already wired by 3.1.0). New retry knobs. A global request queue or startup staggering. Migrating internal `wrapMondayApiCall` callers (Wave 4.2).
- **God-files:** `src/utils/mondayApi.js` only — `safeApi` body edit.
- **Verification baseline expected:** lint stays at 34. Tests `~715 + 6-8 new = ~722 / one-more-than-pre-existing-failures`. Build clean. **Manual smoke (recommended, document in Fix-applied entry):** `pnpm start`, throttle network in DevTools, force one request to 429 — verify no `ErrorDetailsModal` toast and the data loads.
- **Risk to flag during builder review:** test isolation (`vi.useFakeTimers()` mandatory, otherwise retry tests block ~2-6s each). The asymmetry vs. `wrapMondayApiCall` (soft GraphQL errors are not retried by `safeApi` because they don't throw) is intentional and **must** be documented in the F013 closing note in `ANALYSIS.md`. Hot paths affected: `useFilterOptions`, `useMondayEvents` pagination tail, `useDashboardData`, `useColumnOptions` — all benefit.
- **Promotable when:** 3.1.0 merged.

### 3.1.2 — Integration regression: `safeApi` retries 429 in a real flow

- **Goal:** prove the F014 fix lands in user-flow code paths, not just in unit isolation. Reuses the Wave 2 harness to trigger a 429 on a real `safeApi` caller and assert the flow recovers.
- **In scope:** `src/__tests__/integration/safeApiRetry.test.jsx`. Use `renderCalendar()` from Wave 2; configure `mondayMock` to throw a 429-shaped error on first call to a `safeApi` operation (e.g., the `useFilterOptions` reporters query) and succeed on the second; open `FilterBar`; assert reporters dropdown populates AND `monday.api` was called twice for that operation. Extend `src/test-utils/mondayMock.js` with a small `respondInSequence([err, ok])` helper **only if needed**.
- **Out of scope:** any production-code change; new harness scaffolding beyond per-call sequencing; testing more than one `safeApi` caller; covering `wrapMondayApiCall` paths (already covered by `mondayApiRetry.test.js`).
- **God-files:** none.
- **Verification baseline expected:** lint stays at 34. Tests `+1` over 3.1.1's count. Build clean. Pre-existing `featureFlags` failure unchanged.
- **Promotable when:** 3.1.1 merged. **Closes Wave 3.**

---

### 4-plan — Wave 4 plan + Wave 3 archive + ROADMAP renumber (docs only)

- **Goal:** seed Wave 4 in `STATUS.md` (queue + per-task specs), archive Wave 3 rows under `## Archive — Wave 3`, add `tech-debt/wave-4-plan.md` design doc that splits the decomposition phase into Waves 4–8 (one wave per god-file), renumber ROADMAP §5 → §9 to make room, and stamp `ANALYSIS.md` F007 (and F013's deferred unification step) as in-progress with a pointer to the plan.
- **In scope:** `tech-debt/STATUS.md` (this section + queue + Wave 3 archive); `tech-debt/wave-4-plan.md` (new); `tech-debt/ROADMAP.md` (renumber §5 → §9, add §4–§8 wave map); `tech-debt/ANALYSIS.md` F007 + F013 entries only.
- **Out of scope:** any code change; any change to `AUDIT.md` or `README.md`; any new `src/utils/mondayApi/` file (those land in 4.1.0–4.1.4).
- **God-files:** none.
- **Verification baseline expected:** no test/build impact (docs only). Lint stays at 34. Tests 724/725 (pre-existing `featureFlags` failure unchanged).
- **Status note:** committed on branch — awaiting reviewer.

### 4.1.0 — Bootstrap `mondayApi/` directory + barrel re-export

- **Goal:** create the new directory structure with **zero behavior change**. All current `mondayApi.js` content moves to `src/utils/mondayApi/client.js` verbatim; `src/utils/mondayApi/index.js` becomes a barrel re-exporting everything; `src/utils/mondayApi.js` is deleted (Vite/Vitest resolve the directory's `index.js` automatically, so the 18 importer files keep working unchanged). Subsequent sub-tasks carve `client.js` down by moving exports to dedicated module files.
- **In scope:**
  1. Create `src/utils/mondayApi/client.js` with the full current contents of `src/utils/mondayApi.js`.
  2. Create `src/utils/mondayApi/index.js` that re-exports everything from `./client.js` — including `_testHelpers` and the named exports `MondayApiError`, `safeApi`, `parseTimeString`, `fetchColumnSettings`, `fetchAllBoardItems`, `createBoardItem`, `fetchEventsFromBoard`, `fetchProjectsForUser`, `findProjectLinkColumn`, `createTask`, `updateItemColumnValues`, `fetchCurrentUser`, `fetchItemById`, `fetchProjectById`, `deleteItem`, `createEventTypeStatusColumn`, `createColumn`, `createBoardWithColumns`, `fetchStatusColumnSettings`, `fetchStatusColumnsFromBoard`, `parseStatusLabels`, `fetchItemsStatus`, `fetchItemsLinkedIds`, `fetchCustomerMapFromAssignments`, `fetchActiveAssignments`, `resolveMirrorSourceColumn`, `fetchConnectedBoardsFromColumn`, `fetchUniquePeopleFromBoard`.
  3. Delete `src/utils/mondayApi.js`.
  4. Verify the 18 importer files (`src/hooks/`, `src/components/`, `src/contexts/`, `src/MondayCalendar.jsx`) still import from `'./utils/mondayApi'` / `'../utils/mondayApi'` / `'../../utils/mondayApi'` and resolve via the barrel. **No import-path edits.**
  5. Verify `src/utils/__tests__/mondayApiRetry.test.js` and `src/utils/__tests__/safeApiRetry.test.js` still resolve `_testHelpers` (they import from `'../mondayApi'` → barrel → `client.js`).
- **Out of scope:** any export move out of `client.js` (those are 4.1.1–4.1.4). Renaming any export. Touching test imports beyond the barrel-resolution check. Migrating `wrapMondayApiCall` callers (4.1.5).
- **God-files:** `mondayApi.js` is moved as one unit — no surgical editing of its body in this row.
- **Verification baseline expected:** lint stays at 34. Tests 724/725 (no count change — pure relocation). Build clean. **Manual smoke (mandatory for this row):** `pnpm start`, calendar loads, create one event, save it. Proves barrel resolution works at runtime, not just at build time. Compare `pnpm run build` chunk sizes before/after — should match within ~1%.
- **Risk to flag during builder review:** circular-import check via `madge --circular src/utils/mondayApi/` (or equivalent) — should report zero cycles. The `_testHelpers` re-export must use `export *` or an explicit named re-export, not just `export { default }` — verify both `mondayApiRetry.test.js` and `safeApiRetry.test.js` pass against the barrel.
- **Promotable when:** 4-plan merged.

### 4.1.1 — Move `client.js` (wrappers + retry + error class + query validator)

- **Goal:** carve out the runtime infrastructure that all other modules depend on. After this row, `client.js` contains only the cross-cutting machinery (`safeApi`, `wrapMondayApiCall`, `executeWithRetry` + retry helpers, `MondayApiError`, `validateQuery`, `_getErrorExtensions`, `extractOperationName`, `_testHelpers`); the data-fetching exports remain in a temp location to be moved in 4.1.2–4.1.4.
- **In scope:**
  1. Within `src/utils/mondayApi/client.js`, segregate the file into two clearly marked regions: top — the "client" exports listed above — bottom — the data fetchers awaiting relocation. No exports leave the file in this row.
  2. Update `src/utils/__tests__/mondayApiRetry.test.js` and `src/utils/__tests__/safeApiRetry.test.js` to import `_testHelpers` from `'../mondayApi/client'` (direct, bypassing the barrel) — this matches the file where the helpers permanently live and avoids a barrel hop.
  3. Update `src/utils/mondayApi/index.js` barrel to re-export the "client" surface explicitly from `./client` (no behavior change for importers; just makes the boundary explicit).
- **Out of scope:** moving any data-fetcher export to a new file (those are 4.1.2–4.1.4). Logic changes inside `client.js`. Renaming exports. Migrating `wrapMondayApiCall` callers.
- **God-files:** `client.js` is the file under refactor; edits are organizational (region comments + import-path change in 2 test files), no logic change.
- **Verification baseline expected:** lint stays at 34. Tests 724/725 (count unchanged; only import paths in 2 test files). Build clean.
- **Risk to flag during builder review:** the test-import path change is the only externally-visible diff — verify both test files run green and that `_testHelpers` still resolves.
- **Promotable when:** 4.1.0 merged.

### 4.1.2 — Move `columns.js` + `mirror.js` (settings parsing + mirror resolution)

- **Goal:** extract status-column and mirror-resolution logic into dedicated modules. This is a relatively small group (~6 exports) that's logically cohesive.
- **In scope:**
  1. Create `src/utils/mondayApi/columns.js` with: `fetchColumnSettings`, `fetchStatusColumnSettings`, `fetchStatusColumnsFromBoard`, `parseStatusLabels`, `createColumn`, `createEventTypeStatusColumn`. Each function imports `safeApi` (or `wrapMondayApiCall`) from `./client.js`.
  2. Create `src/utils/mondayApi/mirror.js` with: `resolveMirrorSourceColumn`. Imports `safeApi` from `./client.js`.
  3. Remove these exports from `client.js`.
  4. Update `src/utils/mondayApi/index.js` barrel to re-export from `./columns` and `./mirror` (importers unchanged).
- **Out of scope:** moving items/boards exports (4.1.3, 4.1.4). Migrating `wrapMondayApiCall` callers (4.1.5). Logic changes.
- **God-files:** `client.js` is the file under refactor — exports are physically moved out, not edited.
- **Verification baseline expected:** lint stays at 34. Tests 724/725. Build clean. Circular-import check passes.
- **Risk to flag during builder review:** verify `parseStatusLabels` is pure (it is — no `monday` arg) and that any internal calls between the moved functions still resolve. `resolveMirrorSourceColumn` calls `fetchStatusColumnsFromBoard` (now in `columns.js`) — must import via `./columns.js`, not the barrel, to avoid a barrel cycle.
- **Promotable when:** 4.1.1 merged.

### 4.1.3 — Move `boards.js` (board-level fetchers)

- **Goal:** extract the small set of board-level fetchers that don't fit `items.js` or `columns.js`.
- **In scope:**
  1. Create `src/utils/mondayApi/boards.js` with: `createBoardWithColumns`, `fetchConnectedBoardsFromColumn`, `fetchUniquePeopleFromBoard`. Imports `safeApi`/`wrapMondayApiCall` from `./client.js`; imports nothing from peer modules.
  2. Remove these exports from `client.js`.
  3. Update `src/utils/mondayApi/index.js` barrel.
- **Out of scope:** items, columns, mirror, wrapper migration.
- **God-files:** `client.js` shrinks further — no logic edits.
- **Verification baseline expected:** lint 34. Tests 724/725. Build clean. Circular-import check passes.
- **Promotable when:** 4.1.2 merged.

### 4.1.4 — Move `items.js` (item-level fetchers — ~14 functions)

- **Goal:** the largest mechanical move of the wave. After this row, `client.js` contains only the cross-cutting machinery from 4.1.1; everything else lives in `items.js` / `boards.js` / `columns.js` / `mirror.js`.
- **In scope:**
  1. Create `src/utils/mondayApi/items.js` with: `parseTimeString`, `fetchAllBoardItems`, `createBoardItem`, `fetchEventsFromBoard`, `fetchProjectsForUser`, `findProjectLinkColumn`, `createTask`, `updateItemColumnValues`, `fetchCurrentUser`, `fetchItemById`, `fetchProjectById`, `deleteItem`, `fetchItemsStatus`, `fetchItemsLinkedIds`, `fetchCustomerMapFromAssignments`, `fetchActiveAssignments`. Imports `safeApi`/`wrapMondayApiCall` from `./client.js`. Imports nothing from peer modules.
  2. Remove these exports from `client.js`.
  3. Update `src/utils/mondayApi/index.js` barrel — at this point the barrel re-exports from `./client`, `./items`, `./boards`, `./columns`, `./mirror`, and `client.js` is purely the runtime machinery layer.
- **Out of scope:** wrapper migration (4.1.5). Logic edits inside any moved function. Renaming.
- **God-files:** `client.js` reaches its target size after this row (~300 LOC of runtime infrastructure).
- **Verification baseline expected:** lint 34. Tests 724/725. Build clean. Circular-import check passes — `items.js` must not import from `boards.js` / `columns.js` / `mirror.js` or vice versa (verify via `madge`). Bundle-size diff vs. pre-4.1.0 should be ≤1%.
- **Risk to flag during builder review:** `parseTimeString` is a pure helper (no API call). It's currently in `mondayApi.js` for historical reasons; placing it in `items.js` is a judgment call — flag in the Fix-applied entry. Alternative: a new `src/utils/mondayApi/parsing.js`. Recommendation: keep in `items.js` to avoid sub-100-LOC files for one helper.
- **Promotable when:** 4.1.3 merged.

### 4.1.5 — Migrate 27 internal `wrapMondayApiCall` callers to `safeApi`; delete the wrapper

- **Goal:** close F013's wrapper-unification step (deferred from Wave 3 per the wave-3-plan). Each of the 27 `wrapMondayApiCall` callers (across `items.js`, `boards.js`, `columns.js`, `mirror.js`) becomes a `safeApi` caller; once all 27 are migrated, `wrapMondayApiCall` is deleted from `client.js`. **Closes F007 and finalizes F013.**
- **In scope:**
  1. Per-module migration: rewrite each `wrapMondayApiCall(name, request, () => monday.api(query, opts))` site as `safeApi(monday, name, query, opts)` — preserving `name` (function name string), forwarding `variables` via `opts.variables`. The signature change is: `wrapMondayApiCall` returned `{ response, duration }`; `safeApi` returns the raw response. Each call site that currently destructures `{ response }` flattens to use the response directly. Throw paths unchanged — `safeApi` already wraps transport errors in `MondayApiError`.
  2. Delete `wrapMondayApiCall` from `client.js` (and from `_testHelpers` if exposed). Keep `executeWithRetry` and the retry helpers.
  3. Update `src/utils/__tests__/mondayApiRetry.test.js` — drop tests that target `wrapMondayApiCall` directly (if any); retain `executeWithRetry` and helper tests.
  4. Update `tech-debt/ANALYSIS.md` F013 verdict from `🔄 IN-PROGRESS` to `✅ FIXED`.
- **Out of scope:** any new retry knob. Touching `safeApi`'s public contract (already finalized in Wave 3.1.1). Touching the 53 existing `safeApi` callers. Renames.
- **God-files:** the four module files (`items.js`, `boards.js`, `columns.js`, `mirror.js`) — narrow per-call edits at each migration site. No structural reshape.
- **Verification baseline expected:** lint 34. Tests `724 / 725 - <removed wrapMondayApiCall direct tests>`. Build clean. **Manual smoke (mandatory):** `pnpm start`, throttle network in DevTools, force one request to 429 on a previously-`wrapMondayApiCall` site (e.g., `fetchProjectsForUser`) — verify it still retries and recovers (same behavior as before, now via `safeApi`'s retry path).
- **Risk to flag during builder review:**
  1. **Soft GraphQL errors.** `wrapMondayApiCall` threw on soft GraphQL errors; `safeApi` does not (per Wave 3.1.1's documented asymmetry). The 27 callers must be reviewed for any code that catches `MondayApiError` from a *soft* error — those branches become unreachable post-migration. Most likely there are none (Wave 3 audited this), but verify per-site.
  2. **Return-shape change.** Callers that expected `{ response, duration }` get `response` directly. Audit every site for `result.response` vs `result.duration` access.
  3. **Logging shape.** `wrapMondayApiCall` emitted a slightly different `logger.apiResponse` payload than `safeApi`. Acceptable drift; flag in Fix-applied entry.
- **Promotable when:** 4.1.4 merged. **Closes Wave 4.**

---

### 5-plan — Wave 5 plan + Wave 4 archive (docs only)

- **Goal:** seed Wave 5 in `STATUS.md` (queue + per-task specs), archive Wave 4 rows under `## Archive — Wave 4`, add `tech-debt/wave-5-plan.md` design doc that maps ROADMAP §4.1 onto seven sub-tasks (1 docs + 6 extractions), and stamp `ANALYSIS.md` F005 as in-progress with a pointer to the plan.
- **In scope:** `tech-debt/STATUS.md` (this section + queue + Wave 4 archive + wave-overview update); `tech-debt/wave-5-plan.md` (new); `tech-debt/ROADMAP.md` row 121 (replace "TBD" with pointer to plan); `tech-debt/ANALYSIS.md` F005 entry only.
- **Out of scope:** any code change; any change to `AUDIT.md` or `README.md`; any new `src/hooks/` file (those land in 5.1.0–5.1.4).
- **God-files:** none.
- **Verification baseline expected:** no test/build impact (docs only). Lint stays at 34. Tests 724/725 (pre-existing `featureFlags` failure unchanged).
- **Status note:** committed on branch — awaiting reviewer.

### 5.1.0 — Extract `useCalendarSwipe` hook

- **Goal:** carve the swipe state machine out of `MondayCalendar.jsx` into `src/hooks/useCalendarSwipe.js`. Per ROADMAP §4.1 step 1: ~70 lines, fully self-contained, zero shared state. The drag/drop integration test from Wave 2 (`dragEvent.test.jsx`) is the safety net.
- **In scope:**
  1. Create `src/hooks/useCalendarSwipe.js`. Move `computeAdjacentDate` (lines ~246) plus the swipe-related `useState` slices and `useEffect`s (lines ~257–329) and any handlers exclusively used by the swipe flow. The hook returns `{ swipeState, handlers, computeAdjacentDate }` (or whatever shape the existing call sites consume — preserve verbatim).
  2. Replace the relocated code in `MondayCalendar.jsx` with `const swipe = useCalendarSwipe({ calendarDate, calendarView, setCalendarDate });` plus the destructure that the JSX consumes.
  3. Imports cleaned up — drop any now-unused symbols from `MondayCalendar.jsx` only.
- **Out of scope:** any approval / selection / undo extraction (5.1.1–5.1.3). Touching `react-big-calendar`'s DnD plumbing. Renaming the swipe state slices. New unit tests (Wave 2 `dragEvent` is the safety net).
- **God-files:** `MondayCalendar.jsx` is the file under refactor. Edits are surgical removals at the swipe-related line ranges plus one hook-call insertion.
- **Verification baseline expected:** lint 34 (or lower if the move drops one of the F033 `exhaustive-deps` known-debt entries). Tests 724/725. Build clean. **Manual smoke (mandatory):** `pnpm start`, swipe gesture between weeks on the work-week view (mobile gesture in DevTools mobile emulation if not on a real device). Document the smoke result in the `**Fix applied:**` entry.
- **Risk to flag during builder review:** the swipe `useEffect` at lines ~620 sets `selectedEventId(null)` on view changes — verify whether this is owned by swipe or by the future `useCalendarSelection` (5.1.2). Default: leave it in `MondayCalendar.jsx` for now; 5.1.2 picks it up. Per ROADMAP §4.1 the swipe extraction is "fully self-contained" — anything that crosses concerns waits for the right wave.
- **Promotable when:** 5-plan merged.

### 5.1.1a — Move approval-handler logic into `useApproval`

- **Goal:** push the four approval-wrapper handlers' UI side-effects (toast / `loadEvents` reload / `clearSelection` / `setIsProcessingApproval`) into `useApproval` so the consumer doesn't need to thread 7+ context values per handler. Per ROADMAP §4.1 step 2 (PR A of two).
- **In scope:**
  1. Extend `useApproval` (`src/hooks/useApproval.js`) to accept additional options: `{ events, currentViewRange, filterRules, loadEvents, approvalSelection, toasts: { showSuccess, showError, showWarning, showErrorWithDetails }, t }`. The hook returns new wrapper-shaped functions: `approveSelected`, `approveAllInWeek`, `approveEventWithFeedback`, `rejectEventWithFeedback` — each running the same toast/reload/clear-selection sequence currently inlined in `MondayCalendar.jsx` lines 1229–1305. The hook also exposes `isProcessingApproval` (move the `useState` from `MondayCalendar`).
  2. `MondayCalendar.jsx` imports the new returns; the four `handleApprove*` / `handleReject*` `useCallback`s become thin call-throughs (1-line each) — final cleanup is 5.1.1b's job.
  3. Existing `useApproval` consumers (e.g., `Dashboard.jsx`) continue to work unchanged — the new options are additive, all defaulted to undefined.
- **Out of scope:** deleting the inline wrappers in `MondayCalendar.jsx` (5.1.1b). Renaming any existing `useApproval` return. Touching `useEventSelection`. Adding hook unit tests (Wave 2 `convertTemporary` + a manual approval smoke is the safety net).
- **God-files:** `MondayCalendar.jsx` is touched at lines 1229–1305 only (logic move, no other section). `useApproval.js` is the receiving file.
- **Verification baseline expected:** lint stable or lower. Tests 724/725. Build clean. **Manual smoke (mandatory):** `pnpm start`, approve an event from the calendar (single + bulk + approve-all-in-week paths). Verify the toast text, the reload, and the selection-clear all still fire identically.
- **Risk to flag during builder review:**
  1. **Stale closures.** Each new wrapper inside `useApproval` needs a `useCallback` with the right dep array. Mirror the original dep arrays from `MondayCalendar.jsx` lines 1253 / 1279 / 1292 / 1305 verbatim, run the suite, then trim only after green.
  2. **Backward compatibility.** Verify `Dashboard.jsx` (and any other consumer) still works without passing the new options. If the new wrappers crash when the toast options are undefined, default them to no-op functions inside the hook.
  3. **`isProcessingApproval` ownership.** It's now inside the hook. The `ApprovalActionBar` consumes it via prop drilling — verify the prop wiring still works after the move.
- **Promotable when:** 5.1.0 merged.

### 5.1.1b — Replace inline approval handlers in `MondayCalendar` with hook references

- **Goal:** delete the four `handleApprove*` / `handleReject*` `useCallback`s in `MondayCalendar.jsx` and reference the hook returns directly from the consumer JSX. Per ROADMAP §4.1 step 2 (PR B of two).
- **In scope:**
  1. Inline the new hook returns at the consumer sites (`ApprovalActionBar` props, `EventModal` callback props). The four `useCallback` blocks at lines 1229–1305 are deleted.
  2. Drop now-unused state (`isProcessingApproval` was lifted into the hook in 5.1.1a) and now-unused imports.
- **Out of scope:** any logic change. Touching `useApproval.js` (5.1.1a finalized it). Renames.
- **God-files:** `MondayCalendar.jsx` only — surgical deletions at the four `useCallback` ranges.
- **Verification baseline expected:** lint 34 or lower. Tests 724/725. Build clean. Manual smoke not strictly mandatory if 5.1.1a's smoke covered the same flows — at the reviewer's discretion.
- **Risk to flag during builder review:** dead code outside the four `useCallback` blocks (e.g., a now-unused `setIsProcessingApproval` import, or a `useState` declaration whose setter is gone). ESLint `no-unused-vars` should catch these — verify count drops, not stays flat.
- **Promotable when:** 5.1.1a merged.

### 5.1.2 — Extract `useCalendarSelection`

- **Goal:** carve the multi-select / approval-selection-mode glue out of `MondayCalendar.jsx` into `src/hooks/useCalendarSelection.js`. Per ROADMAP §4.1 step 3 (~120 lines).
- **In scope:**
  1. Create `src/hooks/useCalendarSelection.js`. The hook owns: the `selectedEventId` state, the `useMultiSelect` instantiation, the `useEventSelection` instantiation (the one currently called `approvalSelection`), the duplicate/delete handlers (`handleDuplicateSelected` line 1137, `handleDeleteSelected` line 1182, `handleEventContextMenu` line 1199, `handleContextMenuDelete` line 1211, `closeContextMenu` line 1222), and the exit-on-view-change effect that resets `selectedEventId` on `calendarDate` / `calendarView` changes (line ~620).
  2. Returns `{ multiSelect, approvalSelection, selectedEventId, contextMenu, handlers: {...} }`. Consumer destructures and threads into JSX exactly as today.
  3. `MondayCalendar.jsx` replaces the inlined state + handlers with `const selection = useCalendarSelection({ events, monday, ... });`.
- **Out of scope:** undo (5.1.3). Touching `useEventSelection` or `useMultiSelect` internals. Renaming exposed names.
- **God-files:** `MondayCalendar.jsx`. Surgical removals at the listed line ranges.
- **Verification baseline expected:** lint 34 or lower. Tests 724/725. Build clean. **Manual smoke (recommended):** open calendar, enter approval-selection mode, select 2 events, approve, exit selection. Independently: long-press an event on mobile to open the context menu, delete via context menu, verify it works.
- **Risk to flag during builder review:**
  1. **`approvalSelection` is shared.** 5.1.1a took it as a *prop* into `useApproval`; this hook will own its instantiation. The composite hook (5.1.4) decides the final ownership story — for 5.1.2, instantiate inside `useCalendarSelection` and pass into `useApproval` via prop drilling at the `MondayCalendar` level. Document the choice in `**Fix applied:**`.
  2. **Effect ordering.** The `setSelectedEventId(null)` effect on view change implicitly synchronizes selection with calendar state. After the move, verify the effect still fires before any approval-selection clear (which lives in `useApproval` after 5.1.1a). Most likely no interaction; flag if you find one.
- **Promotable when:** 5.1.1b merged.

### 5.1.3 — Extract `useUndoState` + integrate `UndoBanner`

- **Goal:** carve the calendar-side undo wiring (banner ref, dismiss handler, restore-events bridge) into `src/hooks/useUndoState.js`. The existing `useUndoDelete` already owns the commit/undo state machine — this hook is the consumer-side glue. Per ROADMAP §4.1 step 4.
- **In scope:**
  1. Create `src/hooks/useUndoState.js`. The hook wraps `useUndoDelete`, owns the banner-related local state (overlay-touch-Y, banner timer cleanups), and exposes `{ undoDelete, banner: { isOpen, count, onUndo, onDismiss, ...refs } }`.
  2. `MondayCalendar.jsx` replaces the inlined `useUndoDelete` call and any banner state with `const undo = useUndoState({ monday, restoreEvents, showError });`. JSX renders `<UndoBanner {...undo.banner} />` as today.
  3. Drop now-unused imports / state declarations from `MondayCalendar.jsx`.
- **Out of scope:** touching `useUndoDelete.js` internals. Adding undo unit tests (parking-lot — Wave 2 doesn't currently cover undo, flag in Fix-applied if a test is appropriate).
- **God-files:** `MondayCalendar.jsx`. Narrow extraction.
- **Verification baseline expected:** lint 34 or lower. Tests 724/725. Build clean. **Manual smoke (recommended):** delete an event → undo banner appears → click undo → verify event reappears. Independently: dismiss banner manually, verify the timer cleans up.
- **Risk to flag during builder review:** banner-timer leaks if the hook's cleanup function doesn't run on unmount. Verify `useEffect` cleanup paths fire by toggling between calendar views during an active banner.
- **Promotable when:** 5.1.2 merged.

### 5.1.4 — Composition: `useMondayCalendarHooks()`

- **Goal:** wire the four new hooks (`useCalendarSwipe`, `useApproval`, `useCalendarSelection`, `useUndoState`) into one composite hook. Per ROADMAP §4.1 step 5 — the file's render body becomes mostly JSX + modals after this row. Target: `MondayCalendar.jsx` ~1,400 LOC.
- **In scope:**
  1. Create `src/hooks/useMondayCalendarHooks.js`. The hook owns the instantiation of the four new hooks plus shared collaborators (settings, monday SDK, context, toasts, events, filter rules). Returns one composite object.
  2. `MondayCalendar.jsx`'s top-of-function replaces ~25 separate hook calls with `const data = useMondayCalendarHooks(props);` followed by destructures grouped by concern.
  3. **Optional (reviewer judgment):** if the diff stays under 400 lines, also pull `CustomEventWithProps` / `CustomToolbarWithProps` / `eventStyleGetter` / `slotPropGetter` / `dayPropGetter` / `draggableAccessor` / `resizableAccessor` into a `src/utils/calendarRenderHelpers.jsx` module. If the diff exceeds 400 lines, defer the helper-module extraction to a separate Wave 5.2 row.
- **Out of scope:** child-component decomposition (Wave 5.2 or later). Renaming. Touching the four extraction-target hooks (5.1.0–5.1.3 finalized them).
- **God-files:** `MondayCalendar.jsx` is the file under refactor. The change is large in line count but mechanical in shape — the new hook becomes the file's primary composition layer.
- **Verification baseline expected:** lint 34 or lower (composition typically drops 2–4 `exhaustive-deps` warnings — verify whether the threshold can ratchet down separately). Tests 724/725. Build clean. **Manual smoke (mandatory):** full Wave-2 flow run — create timed event, create all-day, drag, filter by reporter, approve from calendar, undo a delete, swipe between weeks. The composition is the easiest place to introduce a stale-closure bug.
- **Risk to flag during builder review:**
  1. **Closure freshness.** `useMondayCalendarHooks` returns one object; its identity must change when any nested hook's state changes, otherwise consumers don't re-render. Verify the JSX still re-renders on every relevant state change.
  2. **Hook-call order.** React's rules-of-hooks: every nested hook must be called unconditionally on every render. Verify `useMondayCalendarHooks`'s body has no early returns.
  3. **Bundle size.** A composite hook can defeat tree-shaking if not careful. Compare `pnpm run build` chunk sizes before/after — should match within ~1%.
- **Promotable when:** 5.1.3 merged. **Closes Wave 5.1.x.**

---

- **Goal:** seed Wave 2 in `STATUS.md` (queue + per-task specs), archive Wave 1 rows under `## Archive — Wave 1`, add `tech-debt/wave-2-plan.md` design doc, and stamp `ANALYSIS.md` F026 as in-progress with a pointer to the plan.
- **In scope:** `tech-debt/STATUS.md` (this section + queue + archive); `tech-debt/wave-2-plan.md` (new); `tech-debt/ANALYSIS.md` F026 entry only.
- **Out of scope:** any code change; any change to `ROADMAP.md`, `AUDIT.md`, or `README.md`; any new `src/test-utils/` file (those land in 2.1.0).
- **God-files:** none.
- **Verification baseline expected:** no test/build impact (docs only). Lint stays at 34. Tests 700/701.
- **Status note:** committed on branch — awaiting reviewer.

### 2.1.0 — Integration harness + smoke test

- **Goal:** make `<App />` renderable end-to-end under jsdom + Monday SDK mock, with deterministic time + seeded data, so subsequent tests are short.
- **In scope:**
  1. Extend `src/test-utils/mondayMock.js` with operation-name-keyed responses (current substring matcher is fragile for paginated `useMondayEvents` queries) and factory helpers: `mockBoardWithItems()`, `mockProjectsResponse()`, `mockReportersResponse()`, `mockEmptyEventsResponse()` (must return `cursor: null` on first page so pagination terminates).
  2. New `src/test-utils/renderCalendar.jsx` — composition over `renderWithProviders` mounting `<App />` with seeded settings (`STRUCTURE_MODES.PROJECT_ONLY`, mapping pre-filled), pinned `vi.setSystemTime(new Date('2026-05-07T09:00:00+03:00'))`, mock pre-loaded with one project, one reporter, one stage label, empty event list. Defaults to `he` locale.
  3. New `src/test-utils/INTEGRATION_TESTS.md` — short usage notes (seeded IDs, async settling rules, when to override defaults).
  4. New `src/__tests__/integration/calendar.smoke.test.jsx` — `await renderCalendar()`; assert calendar grid in DOM and the seeded reporter visible. Proves the harness works without committing to any of the 6 flows.
- **Out of scope:** any of the 6 flow tests (2.1.1–2.1.6); any production-code change; vitest config changes beyond what the harness needs (none expected).
- **God-files:** none touched — harness is read-only against them.
- **Verification baseline expected:** lint 34 unchanged; tests 701/702 (one new smoke). Build clean.
- **Promotable when:** 2-plan merged.

### 2.1.1 — Integration test: create timed event

- **Goal:** assert the create-timed flow end-to-end: time-slot click → `EventModal` → fill project + duration → save → `createBoardItem` payload matches expectations and the event renders.
- **In scope:** `src/__tests__/integration/createTimedEvent.test.jsx`. Reuse `apiPayloadCapture.js` for the column-values shape and `eventTypeMapping.resolveTimedEventIndex` for the event-type index assertion.
- **Out of scope:** any production code; harness changes (those live in 2.1.0); any other flow.
- **God-files:** none touched (`MondayCalendar.jsx`, `EventModal.jsx` only read by the test, not modified).
- **Verification baseline expected:** lint 34; tests 702/703; build clean.
- **Promotable when:** 2.1.0 merged.

### 2.1.2 — Integration test: create all-day vacation

- **Goal:** assert the all-day flow: trigger all-day creation → `AllDayEventModal` → choose `חופשה` → save → payload uses `formatDurationForSave` (days unit) and `calculateEndDateFromDays` (exclusive end).
- **In scope:** `src/__tests__/integration/createAllDayEvent.test.jsx`. Reuse `durationUtils` constants for assertion.
- **Out of scope:** production code; other flows; harness changes.
- **God-files:** none modified.
- **Verification baseline expected:** lint 34; tests 703/704; build clean.
- **Promotable when:** 2.1.1 merged.

### 2.1.3 — Integration test: drag event to new time

- **Goal:** assert `useCalendarHandlers.onEventDrop` is called with new start/end when an event is dragged to a different time slot.
- **In scope:** `src/__tests__/integration/dragEvent.test.jsx`. If jsdom can't synthesize HTML5 DnD events for `react-big-calendar`, fall back to invoking `onEventDrop` directly via the `Calendar` instance and assert `updateEventPosition` mock was called. Either path proves the handler chain. Document the chosen path in the `**Fix applied:**` entry.
- **Out of scope:** production code; rewriting RBC's DnD; testing the DnD library itself.
- **God-files:** none modified.
- **Verification baseline expected:** lint 34; tests 704/705; build clean.
- **Promotable when:** 2.1.2 merged.

### 2.1.4 — Integration test: filter by reporter

- **Goal:** assert filter UX produces correct GraphQL filter rules: open `FilterBar`, select a reporter, assert `loadEvents` called with `filterRules` containing a person-column rule for that reporter ID.
- **In scope:** `src/__tests__/integration/filterByReporter.test.jsx`. Reuse `useCalendarFilter.filterRules`, `useFilterOptions`.
- **Out of scope:** production code; project-filter case (default to reporter only).
- **God-files:** none modified.
- **Verification baseline expected:** lint 34; tests 705/706; build clean.
- **Promotable when:** 2.1.3 merged.

### 2.1.5 — Integration test: change structure mode

- **Goal:** assert `StructureTab` switches drive `MappingTab` correctly: switch from `PROJECT_ONLY` to `PROJECT_WITH_STAGE`, assert `MappingTab` now renders the `stageColumnId` field.
- **In scope:** `src/__tests__/integration/structureModeSwitch.test.jsx`. Reuse `STRUCTURE_MODES` from `SettingsContext.jsx`, `getRequiredSettings` from `settingsValidator.js`.
- **Out of scope:** production code; the assignments-mode toggle (separate concern); persistence to `monday.storage.instance` (asserted by existing unit tests).
- **God-files:** `MappingTab.jsx` is read-only in the test.
- **Verification baseline expected:** lint 34; tests 706/707; build clean.
- **Promotable when:** 2.1.4 merged.

### 2.1.6 — Integration test: convert temporary to billable

- **Goal:** assert the convert-temporary flow: seed a `זמני` event → click → `EventModal` opens in convert mode → choose project/billable → save → update payload changes event-type status to `שעתי` and writes the project link.
- **In scope:** `src/__tests__/integration/convertTemporary.test.jsx`. Reuse `eventTypeMapping.resolveTimedEventIndex`, `TEMPORARY_EVENT_LABEL`.
- **Out of scope:** production code; non-convert update paths (move/edit are covered transitively by 2.1.3 + 2.1.1).
- **God-files:** `EventModal.jsx` read-only.
- **Verification baseline expected:** lint 34; tests 707/708; build clean.
- **Promotable when:** 2.1.5 merged. Closes Wave 2.

---

## Conventions for editing this file

- One row per sub-task, even tiny ones (docs-only, status-only). The audit trail matters more than file size.
- **Builders never edit other rows** — only their own.
- **Reviewers update the row they merge** (status → ✅ MERGED, fill `Merge SHA`) and may promote the next row from ⬜ FUTURE → 🟢 NEXT if all its blockers are now ✅ MERGED.
- When a wave finishes, archive its rows under a `## Archive — Wave N` heading. Do not delete.
- If you find yourself reaching for `AUDIT.md`, stop — that file is a frozen snapshot of the original 35 findings and never gets edited.
