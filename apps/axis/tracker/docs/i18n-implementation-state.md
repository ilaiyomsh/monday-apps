# i18n Implementation — State of Truth

> **READ-FIRST AFTER EVERY `/compact`.**
> Read this file IN FULL. Then read `docs/i18n-locale-audit-findings.md`.
> Then read the wave plan of the active wave only (see "Active Wave" below).
> DO NOT read other files until you understand the next step from this file.

---

## Status

- **Active wave:** *(none — initiative complete)*
- **Next action:** none. All 3 waves merged; 57/57 audit rows tracked done. Optional follow-ups: manual UX QA (human eyeballs), and the pre-existing CI env blocker (`parse-gitignore` patch) lives outside the i18n scope.
- **Updated:** 2026-05-12

## Locked design decisions (do not re-litigate)

1. **Pre-i18n boot screens** (`NetworkErrorScreen`, `ErrorBoundary`) — **English only.** No pre-boot locale resolver. Rows are marked `N/A` in the audit findings table.
2. **`"Powered by Twyst"`** — brand literal, stays hardcoded. Rows marked `N/A`.
3. **`calendarConfig.jsx` static exports** (`localizer`, `WorkWeekView`, `ThreeDayView`, `hebrewMessages`) — dead exports, verified by grep, slated for deletion as part of Wave A.

## Wave roster

| Wave | Branch | PR | Status | Plan file |
|---|---|---|---|---|
| A | `tech-debt/wave-i18n-A` | #30 (squashed: 8bf4331) | merged | `tech-debt/wave-i18n-A.md` |
| B | `tech-debt/wave-i18n-B` | #31 (squashed: 78790e8) | merged | `tech-debt/wave-i18n-B.md` |
| C | `tech-debt/wave-i18n-C` | #32 (squashed: 9d7a802) | merged | `tech-debt/wave-i18n-C.md` |

**Wave summary:**
- **A** — Wizard steps + ApprovalActionBar + ErrorToast + StopwatchLoader + ConfirmDialog + ErrorDetailsModal + ErrorBoundary + dead exports cleanup in `calendarConfig.jsx`. ~10 files.
- **B** — Select dropdowns family (shared dropdown-anchor utility): SearchableSelect, MultiSelect, DatePickerInput, TimeSelect, TaskSelect. ~5 files + 1 utility.
- **C** — Modals (EventModal, AllDayEventModal) + Dashboard family + MondayCalendar TimeGutter/lockReason + CustomDatePicker + MobileResizeOverlay + MondayContext defaults. ~14 files.

## "Verified" criteria (automated only)

A wave row is marked `נבדק` only when **all** of the following hold for the wave's PR:

1. `pnpm test:run` passes — Vitest, current baseline 747 tests, 3 timezones in CI.
2. `pnpm run build` succeeds — Vite production build, no errors.
3. ESLint warnings count is **≤** the baseline pinned in `.github/workflows/test.yml` (no regression on `react-hooks/exhaustive-deps`).
4. i18n key symmetry test passes (`src/i18n/__tests__/keySymmetry.test.js`) — both locales (he/en) have the same keys.
5. *(Optional bonus)* `mcp__claude-in-chrome` smoke if a dev server is running — load the screen, switch language, verify strings appear in both. Does not block.

Manual UX QA (real eyeballs) stays with the human; row stays `נבדק` only when (1)-(4) hold.

## Workflow protocol

### Before each wave
1. Read this file in full.
2. Read `docs/i18n-locale-audit-findings.md`.
3. Read the wave's plan file.
4. Spawn a sub-agent (general-purpose, sonnet, `isolation: worktree`) with:
   - Clear scope: only the rows assigned to this wave.
   - Acceptance criteria: the 4 automated checks above.
   - Output contract: ~150-word summary with PR URL, files touched, test results, any deviations.

### After sub-agent returns
1. Verify PR URL exists; `gh pr view <PR>` to confirm CI green.
2. Merge with `gh pr merge --squash` (matches existing tech-debt waves pattern).
3. Pull main locally.
4. Update this file: bump active wave, set PR + status, update "Last completed action".
5. Update `audit-findings.md`: fill `בוצע` cells with PR# and `נבדק` cells with date+IY (or leave blank if any check failed).
6. Commit + push.
7. Tell the human: *"Good point for `/compact`."*

### Context safety rules
- The main thread NEVER reads more than 5 files per turn. If you need to read more, you are doing the work that belongs in the sub-agent — stop.
- All "heavy" reads (whole component files, multi-file diffs, audit walkthroughs) happen inside sub-agents.
- If approaching ~600k tokens, stop and explicitly ask the human to `/compact`.

## Last completed action

- 2026-05-12: Wave C merged (PR #32 → 9d7a802). 17 modified + 1 new test. Highlights: fixed visible RTL bug in DashboardToolbar (ArrowRight → ArrowLeft); all 6 Dashboard components → `useStableT`; reverse-translation hack in BarChart replaced with `dashboard.charts.hoursUnit`; percentages via `Intl.NumberFormat('percent')`; modals migrated incl. `marginInlineEnd` + locale-aware sorting; MondayContext default → `null` (hard fail outside provider); TimeGutter + CustomDatePicker derive weekday names from `dateFnsLocale`. Local: 1496 tests pass (+2 new), build green, lint 38 warns / 5 errs (vs. baseline 39/5 — improved). 25 W6.C audit rows marked done. **All 57 audit rows now closed.**
- 2026-05-12: Wave B merged (PR #31 → 78790e8). 8 files (5 dropdowns + 1 new `src/utils/dropdownAnchor.js` + 2 locale JSONs). 1494 tests green locally, build green, lint at baseline (39 warns). Deviation: `DatePickerInput` MutationObserver for Vibe internal popups still writes physical `left`/`right`, but dir-aware now — Vibe inline-styles don't accept logical props reliably. 18 W6.B audit rows marked done.
- 2026-05-12: Wave A merged (PR #30 → 8bf4331). 14 files. Local Vitest green (1494 in worktree-doubled run), Vite build green, lint at baseline, keySymmetry passing. CI on the PR went red at the same pre-existing `@mondaycom/apps-cli` postinstall step that's been red on `main` for the past 3+ runs — environmental, not a regression. Merged via squash.
- 2026-05-12: Phase 0 landed (state file + 3 wave plans + audit doc legend/criteria + `תוכנן` column populated). Single commit on `main`.

## Open questions / blockers

- CI is environmentally red on `main` (and was on PR #30) due to a `parse-gitignore` patch-package mismatch inside `@mondaycom/apps-cli` postinstall. Tests never run. Tracked as a separate concern — does NOT block i18n waves since local Vitest + build + lint + keySymmetry all pass and the failure mode is identical pre/post wave.

## Pointer index (for compact recovery)

| Need | File |
|---|---|
| What's next? | This file → "Status" + "Next action" |
| Per-row issue list | `docs/i18n-locale-audit-findings.md` |
| Active wave scope | `tech-debt/wave-i18n-{A,B,C}.md` |
| Past tech-debt wave conventions | `tech-debt/STATUS.md`, prior `tech-debt/wave-*-plan.md` |
| i18n infrastructure | `src/i18n/index.js`, `src/i18n/useStableT.js`, `src/hooks/useLocale.js` |
