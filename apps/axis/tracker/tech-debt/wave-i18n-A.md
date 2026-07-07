# Wave i18n.A — Hardcoded strings, dead exports

**Branch:** `tech-debt/wave-i18n-A`
**Target:** ~10 files. Rows tagged `W6.A` in `docs/i18n-locale-audit-findings.md`.
**Goal:** kill all P0 hardcoded-strings rows, plus a few low-risk P1/P2 cleanups that share files.

## Scope (rows from audit-findings.md)

### P0 strings — bring under i18n
- `components/SettingsWizard/steps/WelcomeStep.jsx` — all EN literals → `t()` + `useStableT`. Add keys under `wizard.steps.welcome.*`.
- `components/SettingsWizard/steps/QuestionsStep.jsx` — all EN literals + Yes/No → `t()`. Keys under `wizard.steps.questions.*` + reuse `common.yes`/`common.no` (add if missing).
- `components/SettingsWizard/steps/InstallStep.jsx` — all EN literals + status strings → `t()`. Keys under `wizard.steps.install.*`.
- `components/SettingsWizard/SettingsWizard.jsx` — header text, nav buttons, aria-labels → `t()`. Replace `dir="ltr"` with `dir={useLocale().dir}`.
- `components/ApprovalActionBar/ApprovalActionBar.jsx` — Hebrew literals → `t()`. Keys under `approval.actionBar.*` + plural for "X reports selected".
- `components/ErrorToast/ErrorToast.jsx` — Hebrew aria-labels/titles + `הועתק!` → `t()`. Keys under `errors.toast.*`.

### P1 strings — small, isolated
- `components/StopwatchLoader/StopwatchLoader.jsx` — `aria-label="טוען..."` → `t('common.loading')`.
- `components/ConfirmDialog/ConfirmDialog.jsx` — Hebrew default props (`title`/`message`/`confirmText`/`cancelText`) → fall back to `t()` when prop is undefined; do NOT hardcode defaults. Keys under `common.confirm.*`.
- `components/ErrorDetailsModal/ErrorDetailsModal.jsx` — 3 EN labels (`Request ID:`, `Stack Trace:`, `Variables:`) → `t()`. Keys under `errors.details.*`.
- `components/ErrorBoundary/ErrorBoundary.jsx` — class component:
  - Strings: import `i18next` directly and call `i18next.t('errorBoundary.*')`. If `i18next` not initialized yet, fall back to current hardcoded Hebrew (the existing behavior — safer than crashing).
  - Direction: replace inline `direction:'rtl'` with `direction:'inherit'` and `textAlign:'right'` with `textAlign:'start'`.

### Dead exports cleanup (locked decision)
- `src/constants/calendarConfig.jsx` — delete `localizer`, `WorkWeekView`, `ThreeDayView`, `hebrewMessages` exports. Make `locales` internal (remove `export`). Verify zero external consumers via grep before deleting (already done in audit, re-confirm).

## Out of scope (do NOT touch in this wave)

- `components/NetworkErrorScreen.jsx` — WONT-FIX per locked decision.
- `"Powered by Twyst"` literals — WONT-FIX.
- All dropdown components (`SearchableSelect`, `MultiSelect`, `DatePickerInput`, `TimeSelect`, `TaskSelect`) — these go in Wave B.
- All Dashboard family — Wave C.
- `EventModal`, `AllDayEventModal`, `MondayCalendar` — Wave C.

## Acceptance criteria

All four must pass before opening PR:

1. `pnpm test:run` — full suite green.
2. `pnpm run build` — Vite production build succeeds.
3. ESLint warnings count is **≤** baseline (see `.github/workflows/test.yml` for the pinned threshold).
4. `src/i18n/__tests__/keySymmetry.test.js` — both locales have the same keys after all new keys are added.

## Implementation notes

- For every component touched, prefer `useStableT()` over `useTranslation()` (project convention). Where the component is a class (only `ErrorBoundary`), use `i18next.t` directly.
- New i18n keys go into BOTH `src/i18n/locales/he/translation.json` and `src/i18n/locales/en/translation.json`. The key symmetry test will fail if you miss one.
- For pluralization (`approval.actionBar.selectedCount`) use i18next's `count` interpolation, not string concatenation.
- For `ErrorBoundary` direction fix: just inline-style change, do NOT add CSS module.
- For `calendarConfig.jsx` dead exports: also remove any dead helper functions only those exports used (e.g., if `pickLocale` is only used by `hebrewMessages`, it goes too). Verify with grep.

## After sub-agent finishes

The sub-agent must:
1. Commit on `tech-debt/wave-i18n-A`.
2. Push to origin.
3. Open PR via `gh pr create` with title `tech-debt(i18n): Wave A — kill hardcoded strings + dead calendarConfig exports`.
4. Return a ≤150-word summary with: PR URL, files touched count, test results, any deviations from this plan.

The main thread will then merge the PR, update `docs/i18n-implementation-state.md` + audit-findings cells, commit, and trigger Wave B.
