# Wave i18n.C — Modals + Dashboard + remaining

**Branch:** `tech-debt/wave-i18n-C`
**Target:** ~14 files. Rows tagged `W6.C` in `docs/i18n-locale-audit-findings.md`.
**Theme:** clean up the long tail — `useStableT` consistency, locale-aware sorting/formatting, and the real RTL bug in Dashboard.

## Scope (rows from audit-findings.md)

### High-impact fix (do first — real RTL bug visible in Hebrew prod today)
- `components/Dashboard/DashboardToolbar.jsx` — `<ArrowRight />` back-icon points the wrong way in RTL. Swap to `ArrowLeft` when `useLocale().isRtl`. Single icon change.

### Modals
- `components/EventModal/EventModal.jsx`:
  - Migrate from `useTranslation` to `useStableT`.
  - `localeCompare(b.name, 'he')` → `localeCompare(b.name, useLocale().language)`.
- `components/AllDayEventModal/AllDayEventModal.jsx`:
  - Migrate to `useStableT`.
  - `localeCompare(b.name, 'he')` → use `useLocale().language`.
  - `צור אירוע` (line 1205) → `t()`.
  - Inline `marginRight: '12px'/'10px'` (lines 797, 824, 1090) → `marginInlineEnd` or CSS module class.

### Dashboard family
All Dashboard components should use `useStableT` consistently (project convention):
- `Dashboard.jsx` — already clean. Verify, no change expected.
- `DashboardBarChart.jsx`:
  - `useTranslation` → `useStableT`.
  - Replace the reverse-translation hack on line 47 (`t('...granularity.day') !== 'Day' ? 'שעות' : 'hours'`) with a dedicated key `dashboard.charts.hoursUnit`.
  - `direction: 'ltr'` wrapper — leave as-is (Recharts workaround), but add a 1-line comment explaining it.
- `DashboardEmployeeChart.jsx` — `useTranslation` → `useStableT`. Same Recharts comment.
- `DashboardPieCharts.jsx` — `useTranslation` → `useStableT`. Two `useMemo`s with `t` in deps become safe once `t` is stable.
- `DashboardFilterPanel.jsx` — `useTranslation` → `useStableT`. Three `useMemo`s with `t` deps become safe.
- `DashboardStats.jsx` — `useTranslation` → `useStableT`. Format percentages via `Intl.NumberFormat(useLocale().dateLocale, { style: 'percent' })`.

### Other
- `components/MonthlyBattery/MonthlyBattery.jsx` — add `useStableT` (component has zero i18n today). Hardcoded `שעות` (×2) + `סה"כ` → `t()`. Format numbers via `toLocaleString(useLocale().dateLocale)`.
- `components/CustomDatePicker.jsx`:
  - Hardcoded `WEEK_DAYS_HE`/`WEEK_DAYS_EN` arrays → derive from `useLocale().dateFnsLocale` (date-fns `localize.day(i, { width: 'narrow' })`).
- `components/CustomEvent/CustomEvent.jsx` — `format(start,'HH:mm')` → pass `{ locale: useLocale().dateFnsLocale }`. Cosmetic but consistent.
- `components/MobileResizeOverlay/MobileResizeOverlay.jsx`:
  - Migrate `useTranslation` → `useStableT`.
  - `format(date,'HH:mm')` calls (lines 220, 228) → add `{ locale: dateFnsLocale }`.
- `MondayCalendar.jsx`:
  - Line 1267 — `'הדיווח נעול - אושר ע"י מנהל'` lockReason → `t('approval.lockReason')`. Note: `t` already in this file via `useStableT`.
  - Lines 110–113 — `HEBREW_WEEKDAYS_GUTTER` array + `יום ${...}` template in `TimeGutterHeaderFactory`. Derive weekday name from `useLocale().dateFnsLocale` (date-fns `format(date, 'EEEEE')` for narrow, then construct the `יום X` / `Day X` label via `t('calendar.gutter.dayPrefix', { day })`).
- `components/SettingsDialog/MappingTab.jsx` — line 108 `useMemo` calls `t()` but `t` not in deps. Migrate to `useStableT` AND add `t` to deps array.

### `MondayContext.jsx` defaults — minor
- Lines 8–12: change the default context value from a Hebrew-loaded object to `null`, so components that read context outside a provider fail loudly instead of silently falling back to Hebrew. Update any test/storybook stubs that broke.
- Lines 133–134: `weekStartDay = 0` / `timeFormat = '24h'` — leave as-is for this wave, document in code comment that these are Israel defaults pending a future locale-driven derivation.

## Out of scope

- Pre-i18n boot screens (`NetworkErrorScreen`, `ErrorBoundary`) — WONT-FIX.
- `"Powered by Twyst"` — WONT-FIX.
- Anything already covered by Wave A or B.

## Acceptance criteria

Same 4 automated checks. Additional check for the Dashboard ArrowRight fix:
- Render-test (if available) for `DashboardToolbar` that asserts `ArrowLeft` appears in `he` mode and `ArrowRight` in `en` mode. If no test infrastructure for this, add a simple one in the wave.

## After sub-agent finishes

Same protocol. PR title: `tech-debt(i18n): Wave C — modals + Dashboard + tail cleanups`.
