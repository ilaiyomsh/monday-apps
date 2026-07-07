# Wave 2 Plan — Integration Tests (F026)

> **Status:** plan, awaiting build kickoff. See `STATUS.md` Wave 2 queue for sub-task tracking.
> Per-task contracts (In-scope / Out-of-scope / Verification baseline) live in `STATUS.md`. This file is the rationale + design context.

---

## Context

Wave 1 (hygiene + ESLint CI gate) landed at merge `c2bd8b2` on `chore/tech-debt-sweep`. The destination is Wave 4 — splitting the 6 god-files (`MondayCalendar.jsx` 1910 LOC, `MappingTab.jsx` 1535, `mondayApi.js` 1420, `AllDayEventModal.jsx` 1212, `EventModal.jsx` 871, `AdditionalTab.jsx` 786). All six currently have **zero integration coverage**. The existing 700-passing suite is unit-level (utils, hook payloads, presentational components). No test exercises a full user flow end-to-end. Splitting any of these files without a safety net would be reckless.

Wave 2 builds that safety net. Per `ROADMAP.md` §2.1, six integration tests cover the golden user flows before any Wave 4 PR opens. Each Wave 4 extraction PR re-runs these six tests as proof that no flow regressed.

Wave 2 is **F026 only**. F013 + F014 (API-wrapper unification + 429 retry) are Wave 3, planned separately.

---

## Approach — 7 task branches

Mirrors the Wave-1.4 pattern: scaffold first (the hardest task), then one PR per test. Each follows the contract in `STATUS.md` with In-scope / Out-of-scope / Verification baseline, branches off `chore/tech-debt-sweep`, gets reviewed, merges, and promotes the next row.

| # | Sub-task | Branch | Test file added |
|---|----------|--------|-----------------|
| 2.1.0 | Integration harness + smoke | `tech-debt/wave-2.1.0-integration-harness` | `src/__tests__/integration/calendar.smoke.test.jsx` |
| 2.1.1 | Create timed event | `tech-debt/wave-2.1.1-create-timed` | `…/createTimedEvent.test.jsx` |
| 2.1.2 | Create all-day vacation | `tech-debt/wave-2.1.2-create-allday` | `…/createAllDayEvent.test.jsx` |
| 2.1.3 | Drag event to new time | `tech-debt/wave-2.1.3-drag-event` | `…/dragEvent.test.jsx` |
| 2.1.4 | Filter by reporter | `tech-debt/wave-2.1.4-filter-reporter` | `…/filterByReporter.test.jsx` |
| 2.1.5 | Change structure mode | `tech-debt/wave-2.1.5-structure-mode` | `…/structureModeSwitch.test.jsx` |
| 2.1.6 | Convert temporary to billable | `tech-debt/wave-2.1.6-convert-temporary` | `…/convertTemporary.test.jsx` |

The flows match `ROADMAP.md` §2.1 verbatim. The 7-PR split (vs. ROADMAP's "one full week") is a methodology choice — small reviews scale better than one giant PR; revertability is per-test.

---

## 2.1.0 — Scaffolding (must land first)

The hardest task in the wave. Get `MondayCalendar` to render under jsdom + the existing `monday-sdk-js` mock with no network, no real timers, no real DnD.

- **New:** `src/test-utils/renderCalendar.jsx` — composition over `renderWithProviders` that mounts `<App />` with seeded settings (`STRUCTURE_MODES.PROJECT_ONLY`, mapping pre-filled), pinned `vi.setSystemTime(new Date('2026-05-07T09:00:00+03:00'))`, Monday SDK mock pre-loaded with one project, one reporter, one stage label, and an empty event list.
- **New:** `src/test-utils/INTEGRATION_TESTS.md` — short usage notes (which seeded IDs are stable, which are random, async settling rules).
- **Extend:** `src/test-utils/mondayMock.js` — add operation-name-keyed responses (current substring matcher is fragile for `useMondayEvents`'s paginated queries) and factories `mockBoardWithItems()`, `mockProjectsResponse()`, `mockReportersResponse()`, `mockEmptyEventsResponse()` (cursor: null on first page — must terminate pagination).
- **One smoke test:** `src/__tests__/integration/calendar.smoke.test.jsx` — `await renderCalendar()` and assert the calendar grid is in the DOM with the seeded reporter visible. Proves the harness works without committing to any of the 6 flows.

**Verification:** lint stays at 34, tests `701/702`, build clean.

---

## 2.1.1 → 2.1.6 — Tests (one per PR)

Each ~2-hour add once 2.1.0 lands. Per-test detail:

- **2.1.1 — Create timed event:** click time slot → `EventModal` opens → fill project + duration → save → assert (a) `createBoardItem` payload shape via `apiPayloadCapture.js`, (b) the new event renders. Reuse: `eventTypeMapping.resolveTimedEventIndex`.
- **2.1.2 — Create all-day vacation:** trigger all-day creation → `AllDayEventModal` → `חופשה` → save → assert payload uses `formatDurationForSave` for days unit and `calculateEndDateFromDays` for the exclusive end. Reuse: `durationUtils`.
- **2.1.3 — Drag event:** seed one timed event → simulate drag to new slot → assert `updateEventPosition` called with new start/end. Risk: jsdom does not synthesize HTML5 DnD — fall back to invoking the `onEventDrop` prop directly via the `Calendar` instance. Either path proves `useCalendarHandlers.onEventDrop` chain. Document the choice in the contract.
- **2.1.4 — Filter by reporter:** open `FilterBar` → select reporter → assert `loadEvents` is called with `filterRules` containing a person-column rule for that reporter ID. Reuse: `useCalendarFilter.filterRules`, `useFilterOptions`.
- **2.1.5 — Change structure mode:** open `SettingsDialog` → `StructureTab` → switch `PROJECT_ONLY` → `PROJECT_WITH_STAGE` → assert `MappingTab` now renders the `stageColumnId` field. Reuse: `STRUCTURE_MODES` from `SettingsContext.jsx`, `getRequiredSettings` from `settingsValidator.js`.
- **2.1.6 — Convert temporary to billable:** seed a `זמני` event → click → `EventModal` opens in convert mode → choose project/billable → save → assert update payload changes event-type status from `זמני` to `שעתי` and writes the project link. Reuse: `eventTypeMapping.resolveTimedEventIndex`, `TEMPORARY_EVENT_LABEL`.

---

## Critical files

**Touched (test-only):**
- `src/test-utils/mondayMock.js` — extend in 2.1.0.
- `src/test-utils/renderCalendar.jsx` — new in 2.1.0.
- `src/test-utils/INTEGRATION_TESTS.md` — new in 2.1.0.
- `src/__tests__/integration/*.test.jsx` — six new files (one per PR 2.1.1–2.1.6) plus the smoke test in 2.1.0.

**Read-only references during builds:**
- `src/MondayCalendar.jsx`, `src/components/EventModal/EventModal.jsx`, `src/components/AllDayEventModal/AllDayEventModal.jsx`, `src/components/SettingsDialog/{SettingsDialog,StructureTab,MappingTab}.jsx`, `src/components/FilterBar/FilterBar.jsx`.
- `src/hooks/{useMondayEvents,useAllDayEvents,useCalendarHandlers,useCalendarFilter,useFilterOptions}.js`.
- `src/utils/{mondayApi,durationUtils,eventTypeMapping}.js` for assertion shapes.

**Tracking docs (per Wave-1 contract):**
- `tech-debt/STATUS.md` — Wave 2 queue + 7 per-task specs (added in this plan branch).
- `tech-debt/ANALYSIS.md` F026 — one structured `**Fix applied (Wave 2.1.x):**` entry per merged sub-task.
- `tech-debt/ROADMAP.md` — only if a sub-task deviates from §2.1's intent. No strategic change expected.

---

## Reuse — DO NOT reinvent

Already in repo, all consumed by the harness:
- `createMondayMock()` — `src/test-utils/mondayMock.js:17` — full SDK mock with `vi.fn()` spies, context, listeners, GraphQL response map, global + instance storage.
- `renderWithProviders` / `renderHookWithProviders` — `src/test-utils/` — wire `SettingsProvider`, `MondayProvider`, i18n, theme.
- `apiPayloadCapture.js` — captures GraphQL request payloads for assertion-by-shape.
- `src/setupTests.js` — global jsdom setup, logger silencer, i18n init.
- Vitest, RTL v16, `@testing-library/user-event`, `@testing-library/jest-dom`, jsdom — installed.

The harness in 2.1.0 exists so 2.1.1–2.1.6 are each a ~2-hour add, not a ~6-hour fight with the framework.

---

## Risks to flag

1. **`react-big-calendar` + jsdom DnD:** native HTML5 drag events are not synthesized by jsdom. 2.1.3 may need to bypass synthetic events and call `onEventDrop` directly. Acceptable — we test `useCalendarHandlers` logic, not RBC's DnD library.
2. **Async settling on paginated queries:** `useMondayEvents` issues cursor pagination. The mock must respond `cursor: null` on first page or tests hang. Bake into 2.1.0.
3. **Hebrew text matching:** assertions on user-facing labels (e.g., `חופשה`) must use locale-aware queries — `renderCalendar()` defaults to `he` to match production.
4. **Time-zone determinism:** harness pins to `Asia/Jerusalem` via `vi.setSystemTime`. Lint CI already runs only on the `Asia/Jerusalem` matrix entry; integration tests should run on all three TZ matrix entries to flush date-boundary bugs.
5. **Coverage drift in Wave 4:** tests should assert the **flow contract** (which mock fn was called with what shape), not internal call sequences. Keeps tests resilient when god-files split.

---

## Verification — end-to-end

After each sub-task lands on `chore/tech-debt-sweep`:

```bash
pnpm exec eslint src/ --ext .js,.jsx --max-warnings 34   # exit 0
pnpm run test:run                                         # 700 prior + N new; pre-existing featureFlags failure unchanged
pnpm run build                                            # clean
```

After all 7 sub-tasks merged:
- `pnpm run test:run` reports 707/708 passing (700 prior + 1 smoke + 6 integration).
- `src/__tests__/integration/` contains 7 test files.
- `tech-debt/ANALYSIS.md` F026 has 7 `**Fix applied (Wave 2.1.x):**` entries.
- Wave 4 unblocked: each god-file has at least one integration test exercising its primary flow.

**Manual smoke (per UI-flow PR, optional but recommended):** run `pnpm start`, perform the flow the test claims to cover. If the test passes but the manual flow breaks, the test asserts the wrong thing — fix before merge.

---

## Out of scope for Wave 2

- F013 + F014 (API wrappers + 429 retry) — Wave 3.
- Any Wave 4 god-file extraction — blocked behind this entire wave.
- New ESLint rules; ratcheting `--max-warnings` below 34.
- Cypress, Playwright, or any other test runner — RTL + jsdom is the established choice.
- Coverage of non-golden flows (delete, undo, bulk-create) — out of scope until Wave 4 reveals which ones the extractions actually risk.
