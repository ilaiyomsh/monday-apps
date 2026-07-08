# Tech Debt Audit — tracker

**Generated:** 2026-05-06
**Scope:** `/Users/ilaish/monday_app/apps/tracker/tracker/` (181 source files, 26,206 LOC)
**Branch:** `feature/he-en-i18n`

---

## Executive summary

1. **`.env` is committed to git** (`.gitignore` doesn't list it) — contains tunnel subdomain, app ID, build URL. Not catastrophic (no API keys), but a leak waiting to happen.
2. **`build.zip` (970KB binary) is tracked in git** — repo is being bloated on every build.
3. **70 npm vulnerabilities** (2 Critical, 34 High) — all transitive via `@mondaycom/apps-cli` and `react-big-calendar`. CLI ones don't ship to prod; `lodash-es` does.
4. **6 god files growing unchecked.** `MondayCalendar.jsx` is now **1,910 LOC** (was 1,551 per ARCHITECTURE.md, was 993 per CLAUDE.md — both stale). Same drift in 5 other files.
5. **All architecture/refactoring docs (`ARCHITECTURE.md`, `REFACTORING_ROADMAP.md`, `TASKS_PLAN.md`, `CLAUDE.md`) are stale.** They cite file sizes from 4+ months ago that have since grown 30–60%. README.md is still the Monday quickstart boilerplate.
6. **Two competing API wrappers** (`wrapMondayApiCall` with retry, `safeApi` without) used inconsistently — most calls go through `safeApi` which has no 429 backoff, despite a documented concurrency issue (`docs/api-concurrency-issue.md`) that's still unfixed.
7. **`@mondaycom/apps-sdk` is a declared dependency but not imported anywhere.** Same for `eslint-config-react-app` (devDep). `react-scripts` is referenced by `eject` script but not installed.
8. **75 unused exports + 12 unused files** flagged by `knip`. Most are `default` exports paired with named exports — consumers use the named, leaving dead defaults.
9. **No tests for the largest files.** `MondayCalendar.jsx`, `MappingTab.jsx` (1,535 LOC), `EventModal.jsx`, `AllDayEventModal.jsx` (1,212 LOC), and `mondayApi.js` (1,420 LOC) have zero or near-zero test coverage. Smaller utils are well-tested. The high-churn × low-coverage intersection is exactly where bugs hide.
10. **Debug code in production paths.** `mondayApi.js:1253` has `console.error('DEBUG_MIRROR_SETTINGS', ...)` (with eslint-disable). `App.jsx:25` exposes `window.__monday` "temporary" debug handle that ships to users.

---

## Architectural mental model

This is a **Monday.com Board View** that renders a Hebrew RTL calendar (with English LTR mode behind a feature flag) for reporting work hours. The app is structurally a single-feature React 18 + Vite SPA with Monday SDK for I/O, no backend of its own. Storage is `monday.storage` (instance + global keyspace, with retry/timeout because mobile flakes), and all data fetches go through GraphQL via `monday-sdk-js`.

The architecture nominally has clean layers (entry → App.jsx providers → MondayCalendar → modals/hooks/utils), but the **real layering is collapsed at the top:** `MondayCalendar.jsx` (1,910 LOC) imports 25 hooks, owns 19 useState, runs 15 useEffect, and defines 26 inline handlers. It's the calendar view, the modal orchestrator, the swipe gesture handler, the multi-select coordinator, and the settings-validation banner all in one. Every new feature lands here. That growth is the dominant tech debt: at the current rate it gains ~300 LOC every 4 months, and it has no tests.

A second concentration is the settings dialog (`MappingTab.jsx` is 1,535 LOC, `AdditionalTab.jsx` is 786) which mixes column-discovery API calls, status-label parsing, mirror-source resolution, and form rendering in single components. The codebase has the right *categories* (hooks/utils/components), but inside those categories several files have outgrown the abstraction.

A current force pulling at the codebase is the **i18n migration** (Increments 1–10, the most-recent ~50 commits). It's gradually adding English support but has produced consistency rot: hardcoded Hebrew strings still leak in `MondayCalendar.jsx:1248,1274`, and language sourcing has moved through three abstractions (`monday.context.user.currentLanguage` → `customSettings.languageOverride` → `i18n.language`).

---

## Findings

| ID | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|----------|-----------|----------|--------|-------------|----------------|
| F001 | Security | `.env` (root) | Critical | S | `.env` is committed to git. Contains `APPID`, `TUNNEL_SUBDOMAIN`, `ZIP` URL. `.gitignore` doesn't list it. | Add `.env` to `.gitignore`, run `git rm --cached .env`, commit. Optional: rotate the tunnel subdomain since it's been in git history since 2024-12-07. |
| F002 | Dependency | `build.zip` (root, 970KB) | High | S | Built artifact tracked in git. `.gitignore` lists `code.tar.gz` but not `build.zip`. Updated on every deploy → repo bloat. | Add `build.zip` to `.gitignore`, run `git rm --cached build.zip`, commit. |
| F003 | Dependency | `package.json:25` | High | S | `@mondaycom/apps-sdk` declared as dependency but no `import` of it anywhere in `src/` (verified via `grep -rn "@mondaycom/apps-sdk" src/`). The app uses only `monday-sdk-js`. | Remove from `dependencies`. |
| F004 | Dependency | `package.json` (transitive) | High | M | 70 vulnerabilities (3 low / 31 mod / 34 high / 2 critical) per `pnpm audit`. Most are in `@mondaycom/apps-cli`'s dependency tree (build-time only). `react-big-calendar > lodash-es` ships to prod. | Update `react-big-calendar` to a version with patched `lodash-es` (≥4.18.1). Bump `@mondaycom/apps-cli` to clear the rest. |
| F005 | Architectural | `src/MondayCalendar.jsx:145-1910` | Critical | L | God component: 1,910 LOC, 19 useState, 15 useEffect, 40 useCallback/useMemo, 26 inline handlers, imports 25 custom hooks. Owns calendar render, modal state, swipe gestures, multi-select, drag/drop, holiday integration, approval flow, undo banner. | Extract: (1) swipe handlers + finger-following logic into `useCalendarSwipe`, (2) approval handlers into `useApprovalActions` (or extend `useApproval`), (3) modal orchestration into `useModalOrchestrator`. Target: ~600 LOC. |
| F006 | Architectural | `src/components/SettingsDialog/MappingTab.jsx:21-1535` | High | L | 1,535 LOC single component with 48 hook calls. Handles people/task/status column discovery (4 separate fetch functions), status-label loading, mirror-column resolution, project-type mapping, billable-type mapping, structure-tab cross-validation. | Split into: `MappingTab` (orchestrator), `useColumnDiscovery` (the 4 fetch* functions), `MappingTab.EventTypeSection`, `MappingTab.ProjectTypeSection`, `MappingTab.AssignmentsSection`. |
| F007 | Architectural | `src/utils/mondayApi.js:1-1420` | High | L | 1,420 LOC, 33+ exports. Mixes: error class, retry logic, two API wrappers (`wrapMondayApiCall` + `safeApi`), validation, pagination helpers, board CRUD, item CRUD, status parsing, mirror resolution, people-extract. | Split: `mondayApi/client.js` (wrappers + error class), `mondayApi/items.js`, `mondayApi/boards.js`, `mondayApi/columns.js`, `mondayApi/statusLabels.js`. Re-export from a barrel for backward compat. |
| F008 | Architectural | `src/components/AllDayEventModal/AllDayEventModal.jsx:1-1212` | High | L | 1,212 LOC modal handling vacation/sick/reserves create/edit + bulk reporting + future-time warning + sub-type selection. | Extract: `AllDayBulkPicker` (date range selection), `AllDaySubtypeSelector` (status mapping → labels), `useAllDayValidation`. |
| F009 | Architectural | `src/hooks/useMondayEvents.js:48-929` | High | M | 929 LOC hook. 27 hook calls, manages CRUD + pagination + optimistic updates + filter rules + employee cost + 6 `eslint-disable react-hooks/exhaustive-deps` (refs as deps). | Extract: `useEventCRUD` (create/update/delete), `useEventPagination` (cursor handling), `useEventFilters` (rule conversion). Keep top-level `useMondayEvents` as composition. |
| F010 | Architectural | `src/components/EventModal/EventModal.jsx:1-871` | High | M | 871 LOC, has grown 60% since CLAUDE.md (552). 25 hook calls. Handles timed event create/edit/convert (from temporary), 5 modes implicit in props. | Extract `useEventModalState` for the form state machine; extract sub-sections (project/task/stage/notes/billable) as composed components. |
| F011 | Architectural | `src/components/SettingsDialog/AdditionalTab.jsx:1-786` | Medium | M | 786 LOC. **Not mentioned in CLAUDE.md or ARCHITECTURE.md** — added since last audit. Same column-discovery duplication as MappingTab. | Pull common discovery logic into `useColumnOptions` (which already partially exists at `src/hooks/useColumnOptions.js`). |
| F012 | Architectural | `src/components/SettingsWizard/useBoardBuilder.js:1-762` | Medium | M | 762 LOC custom hook for first-install wizard. Contains GraphQL with deprecated `settings_str` (lines 211, 224 — see CLAUDE.md "never use settings_str"). | Migrate `settings_str` → `settings`. Split board-creation, column-creation, column-mapping into smaller hooks. |
| F013 | Consistency | `src/utils/mondayApi.js:196` vs `:271` | High | M | Two API wrappers with different return shapes: `wrapMondayApiCall` returns `{response, duration}` and **retries on 429**; `safeApi` returns raw response and **does not retry**. 19 callers use `wrapMondayApiCall` (all internal to `mondayApi.js`). 31+ callers use `safeApi` (everything else). | Pick one. Recommendation: extend `safeApi` to share the retry logic of `wrapMondayApiCall`, then replace `wrapMondayApiCall` internally. The documented concurrency issue (`docs/api-concurrency-issue.md`) goes unaddressed for `safeApi` callers today. |
| F014 | Performance / Errors | `docs/api-concurrency-issue.md` | High | M | Documented issue: on calendar mount, `useMondayEvents.loadEvents` + `useProjects` + `useFilterOptions` + others fire `items_page` queries simultaneously → 429. The doc's note "No retry → user must refresh" is still accurate for `safeApi` paths. `wrapMondayApiCall` retries; `safeApi` does not. | Either (a) add retry to `safeApi`, (b) implement the request-queue pattern from the doc, or (c) stagger startup by gating non-critical hooks behind `useEffect` chains. |
| F015 | Consistency | `README.md` | Medium | S | README is the Monday quickstart boilerplate ("This is the Quickstart React example Monday app"). Doesn't describe the actual product. | Rewrite to describe the calendar app (Hebrew RTL time-tracking, structure modes, settings flow). Many onboarding pointers exist in CLAUDE.md/ARCHITECTURE.md — distill to README. |
| F016 | Doc drift | `ARCHITECTURE.md:22-25` | Medium | S | Says "88 source files, 16,371 LOC". Reality (verified 2026-05-06): 181 files, 26,206 LOC. MondayCalendar listed as 1551, actually 1910. mondayApi listed as 1037, actually 1420. | Either regenerate (it claims to be auto-generated), or remove the size table and link to a CI-generated artifact. |
| F017 | Doc drift | `CLAUDE.md` | Medium | S | "Key Files by Size" table cites: MondayCalendar 993, mondayApi 878, AllDayEventModal 954, MappingTab 1103. Actual sizes are 1910, 1420, 1212, 1535 respectively. AdditionalTab (786) and useBoardBuilder (762) aren't listed at all. | Remove the size table or refresh; link to a `pnpm run loc` script if you want it kept current. |
| F018 | Doc drift | `REFACTORING_ROADMAP.md`, `TASKS_PLAN.md` | Low | S | Both dated 2026-01-19. Cite "MondayCalendar.jsx (1551 lines)". Some tasks (e.g., QW-1 "Delete duplicate setEvents at lines 279-280") appear resolved — `useMondayEvents.js:457` only has one `setEvents(mappedEvents)` call. | Either resolve+archive (`docs/archive/2026-Q1-refactoring/`) or refresh to current state. |
| F019 | Errors / Silent failure | `src/components/SettingsDialog/MappingTab.jsx:191` | High | S | `.catch(() => {})` swallows error from `safeApi('MappingTab.getProjectBoardId', ...)` — if the project board ID can't be extracted, the user sees no error and the project-type column simply never loads. | Replace with `.catch((err) => { logger.error('MappingTab', 'Failed to extract project board ID from assignments', err); showErrorWithDetails(err, ...); })`. |
| F020 | Errors / Debug code | `src/utils/mondayApi.js:1252-1253` | High | S | `// eslint-disable-next-line no-console` followed by `console.error('DEBUG_MIRROR_SETTINGS', ...)` — debug log left in production code path. Runs on every mirror-column resolution. | Remove. The structured `logger.debug('resolveMirrorSourceColumn', ...)` two lines above already covers it. |
| F021 | Errors / Debug code | `src/App.jsx:25` | High | S | `if (typeof window !== 'undefined') window.__monday = monday;` — comment says "DEBUG: temporary expose for console diagnostics". Ships to all users. Lets anyone with devtools call internal Monday SDK with elevated app context. | Gate behind `if (import.meta.env.DEV)` or remove. |
| F022 | Architectural / Dead code | (12 files, knip output) | Medium | S | Unused files: `src/components/StageSelect/StageSelect.jsx` + 8 `index.js` files + `docs/deshboard_layuot.jsx` (note typo) + `src/components/Dashboard/DashboardMultiSelect.jsx` + `src/components/SettingsDialog/StructureOption.jsx`. Not imported anywhere in the live tree. | Delete. (StageSelect/index.js re-exports a component that's already unused per knip — both can go.) |
| F023 | Architectural / Dead code | `src/utils/mondayApi.js` (multiple exports) | Medium | S | 13 exports unused per knip: `parseTimeString`, `fetchColumnSettings`, `fetchAllBoardItems`, `fetchEventsFromBoard`, `findProjectLinkColumn`, `createTask`, `fetchCurrentUser`, `fetchItemById`, `fetchProjectById`, `createColumn`, `createBoardWithColumns`, `fetchStatusColumnSettings`, `fetchUniquePeopleFromBoard`. Some have actual implementations (50–100 LOC each). | Audit each — `fetchCurrentUser` may be intentionally exported for future use; `createTask`/`createColumn` may be wizard-only and become live again. Delete confirmed-dead. |
| F024 | Architectural / Dead code | (18 hook files) | Low | S | 18 hooks export both `default` and a named export with the same value (e.g., `useAllDayEvents.js` exports `useAllDayEvents` named and `default`). All callers use named imports. The default exports are dead. | Drop the `export default` lines. Leaves named exports only. |
| F025 | Type / Contract debt | (entire `src/`) | Medium | L | 0 PropTypes anywhere. 475 JSDoc tags exist (~20% coverage). Component props have no runtime or type-checker enforcement. Already burned by it: `useBoardBuilder.js:211/224` uses deprecated `settings_str`, no validator catches that contract drift. | Either add PropTypes incrementally for the public-API surfaces (modal `props`, top-level component `props`), or commit to TypeScript migration. Don't half-do JSDoc — pick a level and apply it consistently. |
| F026 | Test debt | (high-churn × no-coverage intersection) | High | L | The 6 largest files (≥800 LOC) collectively have **near-zero test coverage**: `MondayCalendar.jsx` (none), `MappingTab.jsx` (none), `mondayApi.js` (only retry test, 6.6KB out of 55KB source), `AllDayEventModal.jsx` (only payload test for the hook), `EventModal.jsx` (none), `AdditionalTab.jsx` (none), `useBoardBuilder.js` (none). Meanwhile the 70 commits in the last 6 months are concentrated on these same files. | Write integration tests for: (a) MondayCalendar render with each structure mode, (b) MappingTab field validation flow, (c) EventModal create-with-each-event-type. Don't aim for line coverage — aim for the user flows. |
| F027 | Consistency | `src/components/SettingsWizard/useBoardBuilder.js:211,220,224` | Medium | S | Uses `settings_str` despite CLAUDE.md rule "Never use `settings_str` — Use `settings` field in GraphQL queries". Comment at line 220 acknowledges: `// Note: using settings_str here (not settings) — the typed settings field isn't [available right after creation]`. May be a real platform constraint, or may be inertia. | Verify with Monday API: is `settings` actually unavailable on freshly-created columns? If yes, comment must explain the *why* clearly. If no, migrate to `settings`. |
| F028 | i18n | `src/MondayCalendar.jsx:1248,1274` | Medium | S | Two hardcoded Hebrew toast strings in a file that already imports `useTranslation`: `showError('${result.failed} דיווחים נכשלו באישור')`. Survives because no payloadGuard rule blocks Hebrew in toasts. | Move to `i18n/locales/he/common.json` + `en/common.json`, call via `t()`. The rest of the file is migrated. |
| F029 | i18n | (20 components) | Low | M | 20 components don't import `useTranslation`: most are presentational (`StopwatchLoader`, `MonthlyBattery`, icon-only `ApprovalActionBar`) and may genuinely have no strings. But `SettingsValidationDialog`, `MobileResizeOverlay`, `ErrorDetailsModal`, `Toast`, `UndoBanner` likely have user-facing text. | Audit each — if they have visible strings, complete the i18n migration. If they're truly text-free, no action. |
| F030 | Architectural / Migration | `src/contexts/SettingsContext.jsx:236-269` | Low | S | Settings load includes 7+ lines of legacy migration: `productsBoardId → tasksBoardId`, `eventTypeLabelColors → eventTypeLabelMeta`, `useStageField` deletion, etc. Each migration is fine; the cumulative load is ~30 LOC of one-shot migrations that have presumably run for every existing instance by now. | Add a `settingsSchemaVersion` field. After all instances have run the migration once, gate the migration block behind `if (savedSettings.settingsSchemaVersion < N)` and eventually delete. |
| F031 | Performance / CSS | `src/components/SettingsWizard/SettingsWizard.module.css:1-1465` | Low | M | 1,465 LOC CSS module for a 3-step wizard. `AllDayEventModal.module.css` is 1,148 LOC. CSS generally doesn't grow unbounded for behavioral reasons — these likely have copy-pasted blocks across step variants. | Audit for: (a) duplicated rules across `.step-1`/`.step-2`/`.step-3`, (b) old rules from removed sub-components, (c) overly specific selectors that could become utility classes. |
| F032 | Errors | `src/utils/mondayColumns.js:74,94,112` | Low | S | Three `// לוג שגיאה קריטי - נשאר פעיל גם בפרודקשן` blocks (logging-then-rethrow). Comment is fine but repeated 3 times. | Extract a tiny helper `logCriticalAndRethrow(module, message, error)` if the pattern recurs. |
| F033 | Test debt | `.github/workflows/test.yml` | Low | S | CI runs tests on push/PR with TZ matrix (good) but doesn't run `pnpm audit`, `npx knip`, or any lint step. If lint exists (`eslintConfig: react-app` in package.json) — it's never enforced. | Add `pnpm exec eslint src/ --ext .js,.jsx` step. Optional: add `pnpm audit --prod --audit-level=high` to fail on prod-shipping high-severity vulns. |
| F034 | Documentation | `docs/api-calls-full-mapping.md`, `docs/reporting-board-api-calls.md` | Low | S | Two docs from March/April mapping the API surface. With `mondayApi.js` having grown ~60% since, these may already be partially stale. No date stamps to verify. | Either delete (commit history is the source of truth) or add "Last verified: YYYY-MM-DD" headers and a CI check that the doc was updated when `mondayApi.js` is touched. |
| F035 | Consistency / Storage | `src/contexts/SettingsContext.jsx:191-208` | Low | M | Reads from BOTH `monday.storage.getItem(globalKey)` AND `monday.storage.instance.getItem('customSettings')`, races them, prefers global, falls back to instance. Comment notes it's for "תאימות לאחור" (backward compatibility). 8-attempt × 500ms retry loop on top. | After migration period: drop the instance fallback. Keep the retry loop (legitimate workaround for mobile flake) but extract it into `monday.storage.getWithRetry()` helper for reuse. |

---

## Top 5 — if you fix nothing else, fix these

### 1. F001 — Get `.env` out of git, audit history for leaks
```bash
echo ".env" >> .gitignore
git rm --cached .env
git commit -m "chore: stop tracking .env"
```
Then check `git log -p -- .env` for any historical commits that included secrets (the current contents are non-sensitive, but a prior commit may not have been). If leaked, rotate the tunnel subdomain.

### 2. F005 — Decompose `MondayCalendar.jsx` (1,910 LOC)
The file gains ~300 LOC every 4 months. At current rate it'll cross 2,500 LOC by year-end. Pick one extraction at a time, smallest first:

**Step 1 (smallest):** Lines 257–329 (swipe gesture / finger-following) → `src/hooks/useCalendarSwipe.js`. Self-contained, 70 LOC, no shared state with the rest of the file.

**Step 2:** Lines 1233–1310 (approval handlers — `handleApproveSelected`, `handleApproveAllInWeek`, `handleApproveEvent`, `handleRejectEvent`) → extend `useApproval` hook.

**Step 3:** All-day handlers (lines 1086–1140) → already moved to `useAllDayEvents` in CLAUDE.md, but `MondayCalendar.jsx:1086+` still has thin wrappers — verify they're necessary or just delete.

Don't attempt a wholesale split. Extract, ship, observe, repeat.

### 3. F013 + F014 — Unify the API wrappers, fix the documented 429 issue
```javascript
// src/utils/mondayApi.js — extend safeApi to share wrapMondayApiCall's retry logic
export const safeApi = async (monday, callerName, query, options = {}) => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await _safeApiOnce(monday, callerName, query, options);
        } catch (error) {
            if (attempt < MAX_RETRIES && isRetryableError(error)) {
                await sleep(getRetryDelay(error, attempt + 1));
                continue;
            }
            throw error;
        }
    }
};
```
Then delete `wrapMondayApiCall` and migrate its 19 internal callers to `safeApi`. This closes the gap that's been documented in `docs/api-concurrency-issue.md` for months.

### 4. F019 + F020 + F021 — Stop the bleeding on silent failures and debug code
Three small fixes, ~5 minutes each:
- `MappingTab.jsx:191`: replace `.catch(() => {})` with proper error handling
- `mondayApi.js:1253`: delete the `console.error('DEBUG_MIRROR_SETTINGS', ...)` line
- `App.jsx:25`: gate `window.__monday` behind `import.meta.env.DEV`

### 5. F026 — Cover the god files with at least one integration test each
Don't aim for unit-test coverage on a 1,910 LOC component. Aim for **one Cypress-style or RTL integration test per top-level user flow:**
- "Create a timed event end-to-end"
- "Create an all-day vacation"
- "Open settings → change structure mode → verify mapping tab updates"
- "Drag an event to a new time"

These are the flows that break when one of the god files is touched. They're feasible to write because the components are already isolated by props (no internal state coupling beyond context).

---

## Quick wins

Low effort × Medium+ severity:

- [ ] **F001** — Add `.env` to `.gitignore`, untrack
- [ ] **F002** — Add `build.zip` to `.gitignore`, untrack
- [ ] **F003** — Remove `@mondaycom/apps-sdk` from `dependencies`
- [ ] **F019** — Fix silent `.catch(() => {})` at `MappingTab.jsx:191`
- [ ] **F020** — Delete `console.error('DEBUG_MIRROR_SETTINGS', ...)` at `mondayApi.js:1253`
- [ ] **F021** — Gate `window.__monday` at `App.jsx:25` behind dev check
- [ ] **F022** — Delete 12 unused files (knip-flagged)
- [ ] **F024** — Drop 18 dead `default` exports from hooks
- [ ] **F015** — Rewrite README.md (Monday boilerplate is misleading)
- [ ] **F028** — Move 2 hardcoded Hebrew strings in `MondayCalendar.jsx:1248,1274` to i18n
- [ ] **F033** — Add ESLint step to CI

---

## Things that look bad but are actually fine

These were considered as findings and rejected after looking closer.

- **`MondayCalendar.jsx`'s 19 useState calls.** Each is for a distinct UI concern (calendar date, view, selected event, modal flags, undo state, etc.). Consolidating into a `useReducer` would compress the lines but not the complexity. The real problem isn't the count of useState — it's the count of *responsibilities* (F005). Don't conflate.
- **Heavy `useCallback` / `useMemo` saturation.** `react-big-calendar` re-renders aggressively when callback identity changes; the memoization is intentional and load-bearing. The 14 `react-hooks/exhaustive-deps` disables in `useMondayEvents.js` all have explanatory comments about ref-based access — they're not lazy disables.
- **Two separate API wrappers existing simultaneously is debt (F013) — but `safeApi` itself is a reasonable split.** Its docstring at `mondayApi.js:271` makes the design choice explicit: "Drop-in replacement for monday.api() ... Doesn't throw on GraphQL soft errors — only logs them." That's a legitimate choice for callers who want to inspect the raw response. The fix isn't to delete `safeApi`; it's to add retry to it.
- **8-attempt × 500ms retry loop in `SettingsContext.jsx:212`.** Looks paranoid, but the comment cites a real bug: "iframe remount + localStorage flag יצרו לולאה" (mobile causes a remount loop). The retry was the fix. Leave it.
- **No PropTypes anywhere (F025) is a *real* finding for new code, but consider:** the project has 475 JSDoc tags and a `.d.ts`-free JS-only stack. Half-introducing PropTypes on a few components and not others would be worse than the current state. Either commit fully (TypeScript migration) or accept that JSDoc + integration tests is the contract layer.
- **The patch at `patches/react-big-calendar+1.19.4.patch`** (guard against horizontal resize directions in DnD addon) looks like the kind of hack people grow paranoid about, but it's a clean, narrow fix for an upstream bug, with a clear PATCH comment. `patch-package` is the right tool. Leave it.
- **Comment density in Hebrew throughout the codebase.** This is the project standard per CLAUDE.md ("Comments are in Hebrew"). Not debt.
- **`monday.storage.instance` + `monday.storage` global dual-write (F035).** Looks redundant but is intentional: instance storage doesn't survive mobile feature-ID changes; global storage does. The dual-write is a backward-compat shim — eventually removable, but the cost of keeping it is one extra write per save.
- **3,042 LOC across 4 SettingsDialog files.** Big, but each tab has a coherent responsibility. The real god file is *MappingTab* alone (F006); the others (StructureTab 251, CalendarTab, SettingsDialog 470) are reasonable.

---

## Open questions for the maintainer

1. **`useBoardBuilder.js`'s `settings_str` (line 211)** — the comment says the typed `settings` field "isn't [available]" right after column creation. Is this still true on Monday's API as of 2026-05? CLAUDE.md says never use `settings_str`; this file does. Need confirmation before migrating.

2. **The 13 unused exports in `mondayApi.js`** (e.g., `fetchCurrentUser`, `createTask`, `fetchItemById`) — are they kept intentionally for future features (wizard expansion, integrations), or are they leftover from removed code paths? Knip can't tell intent.

3. **`docs/api-concurrency-issue.md`** is dated and undated (no header). Is the 429 issue still occurring in production, or did the `wrapMondayApiCall` retry close it for the critical paths? If users no longer hit it, F014 drops to Low severity.

4. **`@mondaycom/apps-sdk`** is in `dependencies` but not imported. Is it pulled in implicitly by the Monday platform at runtime (i.e., expected to be present even if not imported)? If yes, leave it; if no, remove (F003).

5. **`REFACTORING_ROADMAP.md` and `TASKS_PLAN.md` from January 2026** — should these be archived as historical artifacts, refreshed against current state, or merged into this audit's findings? Some tasks (e.g., QW-1 about duplicate `setEvents` in `useMondayEvents.js:279-280`) appear already resolved; the line numbers don't match anymore.

6. **`languageOverride` migration** — App.jsx:40 has a comment noting `useMondayContext.dir` was *wrong* and got replaced by `useLocale`. Are there still callers of `useMondayContext().dir`? (Quick check: the comment says it "ignores languageOverride and causes a split between text (he) and direction (ltr)". Worth a `grep` to confirm no stragglers.)

7. **Test target** — given the manual `pnpm test:tz:matrix` script, timezones are clearly a known concern. Is there an explicit test coverage goal (% of files? lines? user flows?), or is the current "test what bites" approach intentional?
