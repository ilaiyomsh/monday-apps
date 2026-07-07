# Adding English (Hebrew → Hebrew + English) to a Monday App — Implementation Guide

This guide is the practical playbook distilled from the `feature/he-en-i18n` branch of the
`tracker` app. It assumes you are starting from a Hebrew-only React 18 + Vite + Monday SDK
app (similar shape to `tracker`), and you want to ship full bilingual support **without**
regressing the Hebrew experience and **without** corrupting Monday board data.

> Source rollout doc: `docs/he-en-i18n-rollout.md`. This guide is the "do it again on
> another app" version — it merges the original plan with what was actually executed
> (50+ commits on the branch) and the corrections we discovered along the way.

---

## 0. Mental Model — Before You Touch Code

### The Iron Rule: UI text vs. board data

You translate **UI strings only**. You never translate anything that originated from the
Monday API. In particular, never translate:

| Source | Examples |
|---|---|
| Status column labels | "חופשה", "שעתי", custom labels users created |
| `projectTypeMapping` values | "פנימי" / "חיצוני" — the keys are `label.id`s |
| nonBillable / stage labels | Whatever the user configured |
| Project / item / user names | Free text typed into Monday |

A translated string leaking into a Monday `column_values` payload corrupts board data.
Treat this as a **release-blocking** invariant and protect it with a CI gate (see §3).

### Resolution chain

A single function decides the active language everywhere:

```
settings.languageOverride  →  monday.context.user.currentLanguage  →  'he'
```

`'he'` is the fallback so existing users see no change until you flip a flag.

### The 10 increments — what they actually are

The branch shipped in 10 increments plus a long tail of bug-fix commits. Treat each
increment as one PR, mergeable to `main` independently:

1. Dormant i18n foundation + test utilities + CI gates
2. First UI extraction (toolbar / filter bar — low risk surfaces)
3. Modal extraction (event modals — core UX)
4. Settings extraction + **mapping hardening** (the payload-guard work)
5. Context-driven language plumbing (`MondayContext` exposes language/dir/locale)
6. Calendar localization factory (parameterized `calendarConfig`)
7. Date/time helper migration (`dateTimeHelpers.js`)
8. Hidden language picker behind env flag
9. Soft launch in production (RTL layout retained)
10. Full LTR for English

After increment 10, expect ~15–25 follow-up bug-fix commits for things you only see
once a real user opens the app in English (see §11).

---

## 1. Increment 1 — Dormant Foundation

The goal of this increment is to make the codebase i18n-ready while shipping **zero
visible change**. If you can't merge this PR with green tests and identical Hebrew
output, you are not ready for the rest.

### 1.1 Install dependencies

```bash
pnpm add i18next react-i18next
# date-fns is usually already present; if not:
pnpm add date-fns
```

### 1.2 Create `src/i18n/index.js`

```js
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he/translation.json';
import en from './locales/en/translation.json';

export const SUPPORTED_LANGUAGES = ['he', 'en'];

i18next.use(initReactI18next).init({
    resources: { he: { translation: he }, en: { translation: en } },
    lng: 'he',
    fallbackLng: ['he'],
    interpolation: { escapeValue: false }, // React handles escaping
    returnEmptyString: false
});

export function resolveLanguage(settings, mondayContext) {
    const override = settings?.languageOverride;
    if (override) {
        if (!SUPPORTED_LANGUAGES.includes(override)) {
            throw new Error(`Unsupported language override: "${override}"`);
        }
        return override;
    }
    const fromContext = mondayContext?.user?.currentLanguage;
    if (fromContext && SUPPORTED_LANGUAGES.includes(fromContext)) return fromContext;
    return 'he';
}

export const t = i18next.t.bind(i18next);
export default i18next;
```

Why `resolveLanguage` **throws** on a bad override: a bad override is a configuration
bug coming from your own settings UI / storage — you want to see it, not silently
swallow it. The runtime caller (`useLanguageSync`, see §5) catches and falls back.

Import the module once, early — typically in `src/index.jsx`:

```js
import './i18n';
```

### 1.3 Create empty locale files

`src/i18n/locales/he/translation.json` and `src/i18n/locales/en/translation.json`,
both starting with `{}`. Keep them as a single namespace at first; split into
multiple files only if a single file passes ~1500 lines.

### 1.4 Test utilities (do this **before** extracting any string)

These are the load-bearing scaffolding. Without them, every increment after this one
is painful. Build all four:

- `src/test-utils/mondayMock.js` — in-memory replacement for `monday-sdk-js`.
  Must support `get('context')` / `get('settings')`, `listen('context', cb)`,
  `api(query)` keyed by query substring, and both `storage` and `storage.instance`.
  Expose a `__seedStorage(key, value)` helper for synchronous seeding (avoids
  `useEffect` races in tests).

- `src/test-utils/renderWithProviders.jsx` — wraps a UI tree in
  `MondayProvider` + `SettingsProvider`. Accepts `{ monday, initialContext,
  initialSettings, language }`. The `language` shortcut sets
  `context.user.currentLanguage` — that is the only knob your tests need to
  switch languages.

- `src/test-utils/renderHookWithProviders.jsx` — same wrapper for `renderHook`.
  You will need this for every integration test on hooks like `useMondayEvents`.

- `src/test-utils/apiPayloadCapture.js` — wraps the mock's `api()` function so
  every call is recorded. The integration tests assert against captured payloads.

### 1.5 CI gate: i18n key symmetry

Add `src/i18n/__tests__/keySymmetry.test.js`. The test:
- reads every `*.json` under `locales/he` and `locales/en`,
- flattens nested keys with dots,
- asserts the two key sets are equal.

Two gotchas the branch hit:
- The project is `"type": "module"` — `__dirname` does not exist. Use
  `path.dirname(fileURLToPath(import.meta.url))`.
- Don't sort by reference equality — sort the flattened arrays before comparing.

### 1.6 What does **not** change in increment 1

No component imports `useTranslation`. No string is replaced with `t(...)`. The app
must look pixel-identical to before. Your only proof the foundation works is
green tests.

---

## 2. Increment 2 — First Extraction (Low-Risk Surfaces)

Pick the two least risky surfaces with the most strings. In `tracker` these were
`CalendarToolbar.jsx` and `FilterBar/FilterBar.jsx`. Together they contributed
about 22 strings.

### 2.1 Extraction recipe (do this for every component)

1. `import { useTranslation } from 'react-i18next'` and call `const { t } = useTranslation();`.
2. For each visible string, decide a key path that mirrors the component:
   `filterBar.searchPlaceholder`, `calendarToolbar.views.month`, etc.
3. Add the Hebrew text under that key in `he/translation.json`.
4. Add the English translation under the same key in `en/translation.json`.
5. Replace the literal in the JSX with `{t('that.key')}`.
6. For dynamic text, use interpolation: `t('allDayModal.daysSelectionTitle', { type })`.
   The `type` flows through unchanged — that is critical when `type` is
   board data (e.g. a Hebrew status label).

### 2.2 Hebrew snapshot safety

Add baseline snapshots for the components you extract from. The snapshots are
**load-bearing** — they catch the case where you accidentally swap a Hebrew literal
for an English one or break an interpolation. Keep them in `he` only; English
visual snapshots can be added later if needed.

### 2.3 Bilingual rendering tests

For each extracted component, add a test that renders it with `language: 'he'`
and again with `language: 'en'` and asserts the visible labels switch correctly.
This is your primary regression net for all subsequent increments.

---

## 3. Increment 3 — Modal Extraction + Payload Preservation

Modals are higher-risk because their submit handlers build Monday API payloads.
This is where translated strings can leak into board data.

### 3.1 The payload guard

Create `src/utils/payloadGuard.js` with:

- `extractStrings(obj)` — recursively collect every string value in a payload.
- `assertNoForbiddenStrings(payload, forbiddenList, { allowedKeys })` — throws if
  any string in `payload` matches any value in `forbiddenList`. `allowedKeys`
  whitelists fields that can legitimately contain free Hebrew text (e.g. `notes`,
  user-typed text).
- `findStatusColumnWrites(columnValues, statusColumnIds)` and
  `detectStatusColumnShape(value)` — auto-detect status writes and verify they
  are `{ index: N }` (preferred) or `{ label }` whose value matches the original
  board label exactly (round-trip — never a translated string).

Use it in integration tests for every event-creating / event-updating flow:

```js
const payload = capturedApi.lastCall.variables.columnValues;
assertNoForbiddenStrings(payload, Object.values(en.translation), {
    allowedKeys: ['notes']
});
```

### 3.2 Integration tests for `useMondayEvents` and `useAllDayEvents`

Cover, in **both languages**:
- create timed event, create all-day event, bulk all-day create
- update event, drag/resize, delete
- assert: same payload shape, same status indexes, only UI strings differ

### 3.3 Extract the modals

Same recipe as §2.1, but expect ~30 strings in `EventModal` and ~35 in
`AllDayEventModal`. Watch for:
- Validation messages (must translate).
- `aria-label` / `title` attributes (must translate).
- Confirmation dialogs.

---

## 4. Increment 4 — Settings UI + Mapping Hardening

### 4.1 Column value builders

Create `src/utils/columnValueBuilders.js`. The point of this module is to be
**the single chokepoint** through which every status-column write goes. Each
builder:
- accepts a numeric `index` (or a category that resolves to an index via the
  user's mapping),
- returns `{ index: N }`,
- throws on anything that is not a number.

The branch consciously did **not** retrofit the four legacy `{ label: ... }`
writes in `useMondayEvents` / `useAllDayEvents` because those values originate
from board data (round-tripped). Document this if you choose the same path —
otherwise plan a follow-up to migrate them.

### 4.2 Extract settings text

The `SettingsDialog` family is the longest extraction (171 strings in `tracker`).
Do it tab-by-tab as separate commits so reviews stay sane:
- `SettingsDialog.jsx` (chrome + tab labels)
- `StructureTab.jsx`
- `MappingTab.jsx` (longest — 87 strings)
- `FiltersTab.jsx`
- `AdditionalTab.jsx` / `CalendarTab.jsx`

Beware hardcoded tab labels passed via constants — `c6f76c6 fix(i18n): translate
hardcoded SettingsDialog tab labels` was a follow-up because some tab labels
sat in a config object instead of JSX.

---

## 5. Increment 5 — Context-Driven Language Plumbing

### 5.1 Extend `MondayContext`

Have the provider expose, in addition to `context` and `isMobile`:
- `language` — result of `resolveLanguage(settings, context)`
- `dir` — `'rtl'` for `he`, `'ltr'` for `en` (keep `'rtl'` until increment 10
  if you want a soft launch first)
- `locale` — `'he-IL'` / `'en-US'`
- `weekStartDay`, `timeFormat` — defaults safe for the current behavior

### 5.2 `SettingsContext` carries the override

Add a `languageOverride` field (nullable, backward-compatible). Write it via
the picker (increment 8). Read it in `useLanguageSync` (next).

### 5.3 `useLanguageSync` hook

Create `src/hooks/useLanguageSync.js`. It:
- reads `customSettings.languageOverride` and `context.user.currentLanguage`,
- runs `resolveLanguage(...)` (catches errors, falls back to `'he'`, logs),
- if `i18n.language !== target`, calls `i18n.changeLanguage(target)`,
- emits a `logger.info('Language changing', { from, to, source })` line —
  this is your telemetry breadcrumb during soft launch.

Wire it once in `AppContent`, **after** `SettingsProvider` and `MondayProvider`
are mounted.

### 5.4 `useLocale` hook (added late on the branch — but do it here)

Single-source-of-truth for "what does this component need to know about the
current language?" Returns `{ language, isRtl, isLtr, dir, dateLocale,
dateFnsLocale, culture }`. Components that previously read
`useMondayContext()` for direction should consume `useLocale()` instead — it's
a one-liner and decouples them from the SDK context.

```js
const LOCALE_TABLE = {
    he: { isRtl: true,  dir: 'rtl', dateLocale: 'he-IL', dateFnsLocale: he   },
    en: { isRtl: false, dir: 'ltr', dateLocale: 'en-US', dateFnsLocale: enUS },
};
```

This was added at the end of the branch as a refactor (`17c6219`,
`8b8d696`, `82b8eae`) — if you're starting fresh, build it now.

### 5.5 Sync `<html lang>` and `<html dir>`

In the same effect that calls `i18n.changeLanguage`, also set
`document.documentElement.lang` and `.dir`. This drives CSS logical
properties and screen-reader behavior.

---

## 6. Increment 6 — Calendar Localization Factory

If you use `react-big-calendar` (or anything similar), extract the static
config into a factory. See `src/constants/calendarConfig.factory.js` for the
exact shape.

Three traps worth calling out — all three were post-launch fixes on the branch:

### 6.1 Don't overwrite `localizer.startOfWeek`

`react-big-calendar` calls `localizer.startOfWeek()` (no args) and expects a
**number 0–6**. If you replace it with a `(date) => Date` function, Month view
crashes with "Cannot read properties of undefined (reading '0')". Expose your
date-returning version under a different name (`customStartOfWeek`).

### 6.2 Register every culture alias you might pass

Your code may pass `culture="he"`, `culture="he-IL"`, or `culture="en-US"`.
Register all of them in the localizer's `locales` map; otherwise rbc internals
will pass `locale=undefined` to `format()` and crash week / month views:

```js
locales: { he, en: enUS, 'en-US': enUS, 'he-IL': he }
```

### 6.3 `weekStartsOn` must be a number

Settings loaded from storage may come back as the string `"0"`. `date-fns`
throws `RangeError: Invalid time value`. Coerce: `Number(weekStartDay) || 0`.

### 6.4 Pass `messages`, `culture`, and `rtl` to the calendar dynamically

The calendar component reads all three from `useLocale()` / the factory. RTL
flips automatically once you reach increment 10.

---

## 7. Increment 7 — Date/Time Helpers

Create `src/utils/dateTimeHelpers.js` with locale-aware, TZ-stable helpers:

- `formatTime(date, { locale, timeFormat })` — `HH:MM` or `h:MM AM/PM`
- `formatDate(date, { locale })` — uses `Intl.DateTimeFormat`
- `formatDateTime(...)`
- `parseUserTime(str)` — accepts both `09:00` and `9:00 AM`
- `toMondayDateString(date)` and `toMondayDateTimeString(date)` — Monday wants
  **local-clock** values for date columns, not UTC. Build the string from
  `date.getFullYear()` / `getMonth()` / `getDate()`, not from `toISOString()`.
- `isSameDay(a, b)`, `addDays(date, n)` — local-time based; immune to DST.

Run the test suite against three timezones in CI to prove the TZ stability:
`Asia/Jerusalem`, `UTC`, `America/New_York`. A GitHub Actions matrix that sets
`TZ=...` is the cheapest way.

Migrate call sites **gradually** — starting with `useMondayEvents.js`,
`useAllDayEvents.js`, `durationUtils.js`, and `mondayApi.js`. The tracker
branch left the legacy `toMondayDateFormat` / `toLocalDateFormat` helpers in
place; replace incrementally to limit blast radius per PR.

---

## 8. Increment 8 — Hidden Language Picker

```js
// src/utils/featureFlags.js
export function isLanguagePickerEnabled() {
    if (typeof import.meta?.env?.VITE_ENABLE_LANGUAGE_PICKER === 'string') {
        return import.meta.env.VITE_ENABLE_LANGUAGE_PICKER === 'true';
    }
    return false;
}
```

Add a `<select>` to a settings tab (Calendar tab in `tracker`) with three
options: `Auto (Monday)`, `עברית`, `English`. The "Auto" option writes
`languageOverride: null` so the chain falls back to Monday context. The other
two write `'he'` / `'en'`.

Render it only when `isLanguagePickerEnabled()` returns true.

### Kill switch

Removing the `VITE_ENABLE_LANGUAGE_PICKER=true` line from `.env` and
redeploying hides the picker. The override is still respected if previously
saved — if you need to nuke it, add a one-shot migration in `SettingsContext`.

---

## 9. Increment 9 — Soft Launch (RTL kept)

Set `VITE_ENABLE_LANGUAGE_PICKER=true` in production `.env`. Keep `dir='rtl'`
for English in this increment — it ships English **labels** in the existing
RTL layout. Add a one-line UX note next to the picker explaining the layout
limitation. Watch logs for the `"Language changing"` events.

This intermediate step buys you a real-user signal on translation accuracy
without taking on the layout-flip risk at the same time.

---

## 10. Increment 10 — Full LTR

Flip `dir` to follow language: `he → 'rtl'`, `en → 'ltr'`. Things that will
break and require fixes (these are real commits from the branch you can mine):

| Symptom | Fix |
|---|---|
| Calendar chevrons point wrong way | `b9fe771 fix(i18n): calendar crashes + LTR chevrons` |
| Month view crashes in English | `e092436` — don't overwrite `localizer.startOfWeek` (see §6.1) |
| Layout still feels RTL despite `dir="ltr"` | `e8fb0bc` — strip explicit `direction: rtl` from CSS, rely on `<html dir>` cascade |
| Some RTL CSS rules still apply in English | `0e223a3` — gate them on `:root[dir=rtl]` instead of unconditional |
| Filter row mis-aligned in LTR | `cf544df` |
| Dashboard period arrows wrong direction | `cf544df` |
| Hardcoded RTL wrapper in main view | `967bcdd` — use dynamic `dir` |
| Wrong day-name in calendar headers | `8aa2df5` — locale-aware day-name formatters |
| `culture` mismatch between code and registered locales | `bc936e4` — make `culture === language` |

### Intentional LTR exceptions (do NOT translate / flip)

Some surfaces are deliberately kept LTR even when the rest of the app is in
Hebrew. Don't extract their strings or remove their hardcoded `dir="ltr"` —
this is a design choice, not a bug:

| Surface | Why LTR-only |
|---|---|
| **Setup wizard** (`SettingsWizard.jsx`) | Entire onboarding is English-only by design. Hardcoded `dir="ltr"` on the root element. Strings stay in JSX, not in locale files. |
| Dashboard charts (Recharts containers) | Recharts is LTR-native; the X axis runs left→right. Tooltip content flips via `isRtl`, but the chart container stays LTR. |
| Error details modal | Stack traces and JSON dumps — technical content, LTR. |
| Column-ID display in Mapping settings | Monday column IDs are LTR identifiers. |
| Numeric date picker inputs | Date format is LTR. |

If you have an equivalent "wizard" or "onboarding" surface in your app and you
want it English-only too, follow the same pattern: skip extraction, hardcode
`dir="ltr"` on the wrapper, document the exception here.

### Worked example — diagnosing physical-property bugs

A real bug from this app's bulk-hours modal in LTR — the same shape will
appear in any modal you ported. The user reported three symptoms in one
screenshot:

1. The project picker panel was on the **right** in LTR; should be on the **left**.
2. The card's close-X was on the **left** in LTR; should be on the **right**.
3. The notes field text was right-aligned in LTR; should be left-aligned.

Root cause for all three: physical CSS properties hardcoded for the original
RTL design.

| Symptom | Original (broken in LTR) | Fix |
|---|---|---|
| Side panel position | `display: flex; flex-direction: row` on the split container — works in RTL because RTL flips visual order, breaks in LTR | Add `[dir="ltr"] .splitView { flex-direction: row-reverse }`. Keeps the panel visually on the left in both languages. |
| Card close-X position | `position: absolute; left: 8px` — `left` is in screen coordinates, doesn't flip with `dir` | Replace with `inset-inline-end: 8px`. Resolves to right in LTR, left in RTL. |
| Notes text-align | `text-align: right` | Replace with `text-align: start`. Resolves to left in LTR, right in RTL. |

The general diagnostic recipe:

```bash
# Audit one component file before merging i18n work
grep -nE 'text-align:\s*(right|left)|^\s*(left|right):\s*[0-9]|margin-(left|right)|padding-(left|right)|border-(left|right)' \
  src/components/MyModal/MyModal.module.css
```

Substitution table to apply on the matches:

| Physical | Logical replacement |
|---|---|
| `text-align: right` / `left` | `text-align: start` / `end` |
| `left: Xpx` / `right: Xpx` (positioning) | `inset-inline-start: Xpx` / `inset-inline-end: Xpx` |
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `border-left` / `border-right` | `border-inline-start` / `border-inline-end` |

Exceptions where physical stays correct:
- Decorative/visual properties on a shape that does not mirror with reading
  direction (e.g. a colored stripe meant to always be on a specific visual
  side).
- Containers explicitly forced LTR (charts, code blocks, the setup wizard).

When the layout itself needs to mirror (panel-on-left becomes panel-on-right),
no logical property alone is enough — you need `flex-direction: row-reverse`
under a `[dir="ltr"]` (or `[dir="rtl"]`) gate, depending on which dir was the
original design target.

### CSS audit checklist

Before declaring done:
- Replace `margin-left/right` and `padding-left/right` with `margin-inline-start/end`
  where layout intent is "logical".
- Replace `text-align: left/right` with `start/end` where appropriate.
- Audit `::before` / `::after` content arrows (`◀ ▶`) — they don't auto-flip.
- Verify icons that imply direction (back arrows, chevrons) flip via `dir`-aware
  CSS or a swap in JSX.
- Test forms with mixed Hebrew + English content (bidi).

---

## 11. The Long Tail — Things You Only See in Production

The branch shipped 15+ follow-up commits after increment 10. Budget for them.
Common categories:

- **Hardcoded strings missed during extraction** — toasts, celebration
  messages, validation messages buried in utility files. `dbbfd29 feat(i18n):
  translate 25 hardcoded toast messages`, `73aac6f fix(i18n): translate
  celebration toasts via t()`.
- **Date subtitles in modals** — `09548fe`. Anywhere you call
  `toLocaleDateString()` directly without passing the locale.
- **Custom date pickers** — `3da06d5 feat(i18n): locale-aware DatePickerInput
  + CustomDatePicker`.
- **Dashboard / second-tier views** — `ac951fb feat(i18n): localize Dashboard
  components + utils`. Easy to forget in the first sweep.
- **Last-modified timestamps** — `9b4d8ea`.
- **Malformed override in storage from old versions** — `83cd708 fix(i18n):
  harden useLanguageSync against malformed override`. Guard the resolver.

Add a "Hebrew literal" CI gate (a regex scan over `src/` excluding `locales/`
that fails on any Hebrew character) once you believe extraction is complete.
The branch did not ship this gate — adding it is the single highest-leverage
guardrail to prevent regressions.

---

## 12. Test Strategy — What to Build, What to Skip

### Build
- **Bilingual rendering tests** for every extracted component (~5 minutes
  each, prevent 90% of regressions).
- **Payload preservation tests** for every Monday-writing flow (the
  release-blocker net).
- **Key-symmetry CI gate** (cheap; catches every PR that adds an untranslated
  key).
- **TZ matrix in CI** for date helpers (3 timezones).
- **Hebrew snapshot baseline** for the highest-traffic components.

### Skip (until you have a reason)
- English visual snapshots — bilingual rendering tests cover the same
  surface area at lower maintenance cost.
- E2E (Playwright/Cypress) — Vitest + jsdom + the integration tests cover
  enough. Add E2E only if you ship multiple bugs the unit/integration tests
  miss.
- A bundle-size CI gate — listed in the original plan, never built. Useful but
  not blocking.

---

## 13. PR Sequencing & Review

- One increment = one PR. Each must (a) keep Hebrew identical, (b) be
  individually revertible, (c) ship green CI.
- The four scaffolding utilities (`mondayMock`, `renderWithProviders`,
  `apiPayloadCapture`, `payloadGuard`) live in increment 1 — review them
  carefully because every later test depends on them.
- Increments 2–4 are mostly mechanical; reviewers should focus on key naming
  and on payload-preservation assertions, not on the prose of the
  translations.
- Increments 5–7 carry the most architectural risk; have a second engineer
  review the calendar factory and the date helpers in particular.
- Increments 8–10 are config flips; they are short PRs but require manual QA
  in a real Monday board, not just unit tests.

---

## 14. Rollback Strategy

- Every increment is a single PR with a clean revert.
- Production language picker is gated by `VITE_ENABLE_LANGUAGE_PICKER` —
  removing it from `.env` and redeploying instantly hides the feature.
- `languageOverride` is nullable; users who never opened the picker are
  unaffected by anything you ship.
- `fallbackLng: ['he']` in i18next means a missing or broken English key
  silently shows Hebrew rather than an empty string.

---

## 15. Definition of Done

- All UI strings extracted (Hebrew literal CI gate green).
- Key-symmetry gate green; TZ matrix green; payload-preservation suite green.
- Hebrew snapshots unchanged from baseline.
- Manual QA in a real Monday board: timed event, all-day event, bulk all-day,
  drag, resize, delete, settings round-trip, picker switch — all in both
  languages.
- Telemetry shows `Language changing` events in the expected ratio after
  enabling the picker; no spike in error logs.
- Kill switch verified once in staging.

---

## Appendix A — File Inventory the Tracker Branch Added

```
src/i18n/index.js
src/i18n/locales/he/translation.json
src/i18n/locales/en/translation.json
src/i18n/__tests__/keySymmetry.test.js
src/i18n/__tests__/index.test.js

src/hooks/useLanguageSync.js
src/hooks/useLocale.js

src/utils/featureFlags.js
src/utils/payloadGuard.js
src/utils/columnValueBuilders.js
src/utils/dateTimeHelpers.js

src/constants/calendarConfig.factory.js

src/test-utils/mondayMock.js
src/test-utils/renderWithProviders.jsx
src/test-utils/renderHookWithProviders.jsx
src/test-utils/apiPayloadCapture.js
```

Plus modifications to: `MondayContext.jsx`, `SettingsContext.jsx`,
`AppContent` (call `useLanguageSync`), every component that owns visible text.

## Appendix B — Commit Cheat Sheet (mine these for context)

The 50+ commits on `feature/he-en-i18n` are reusable PR-by-PR templates. The
ten increment commits are tagged in `docs/he-en-i18n-rollout.md`. The post-
launch fixes (`192b47b`, `9f741ef`, `8aa2df5`, `994996e`, `83cd708`,
`9b4d8ea`, `bc936e4`, `c6f76c6`, `0e223a3`, `73aac6f`, `09548fe`, `b9fe771`,
`2ced264`, `e8fb0bc`, `cd2a105`, `dbbfd29`, `3da06d5`, `ac951fb`, `e092436`,
`cf544df`, `98559f8`) are the realistic "you will hit these" list — read
their diffs before you ship increment 10.
