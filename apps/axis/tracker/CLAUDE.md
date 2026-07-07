# CLAUDE.md — Tracker

> Structured per the Axis unified template (`../CLAUDE-template.md`). Decisions: `../STANDARDS.md`.
> Sections 1–7 are the mandatory core; section 8 holds Tracker's unique characteristics.

> ⚠️ **NEXT TASK — change #121 (Axiom browser logging): CODE-COMPLETE, PAUSED 2026-07-02.** At the **start of every session** in this project, ask the user (one short question, in Hebrew) whether/when to resume this work — before starting anything else. What remains: user creates the `axis-prod` dataset + `tracker-ingest` token in Axiom → preview verification → deploy → CSP canary → revoke drill → `/close_change`. Full resume runbook, work summary, and the app-core rollback snapshot: **[`../axiom-logging-handoff/`](../axiom-logging-handoff/README.md)** (start at `NEXT-STEPS.md`). Remove this banner when #121 closes.

> ⚠️ **OPEN INVESTIGATION — auto-reload bug (change #103, started 2026-06-22).** The calendar reloads itself (2–3× in a row) after rendering. A fix + a **temporary `[RELOAD-DIAG]` diagnostic** are **live in production** and the diagnostic **must be removed before closing**. Full write-up, current findings, how to read the logs, proposed solution, and the cleanup checklist: **[`docs/auto-reload-investigation.md`](docs/auto-reload-investigation.md)**. Read it before touching `lazyRetry.js`, `MondayCalendar.jsx` (preload), `SettingsContext.jsx` (silent reload), or `index.jsx`.

---

## 1. App Description
Monday.com **Custom Object** app — a Hebrew (RTL) calendar interface for reporting work hours. Runs standalone (no `context.boardId`); the user picks a reporting board in settings. Can also be opened from a board context (fallback). Reports timed work events and all-day leave (vacation/sick/reserves) against monday boards via the GraphQL API.
App ID: `10684862`

## 2. Purpose & Usage
For employees of service companies to log billable/non-billable hours and leave directly on a calendar inside monday. Used by reporters to fill timesheets; supports per-user filtering, project/task hierarchies, and internal/external project distinction. All user-facing text and comments are in Hebrew.

## 3. Technologies
- React `19.2` · Vite `7.3` · Language: **JavaScript (JSX)**  *(standard #1 ✓ aligned; #2 — TypeScript not required, Tracker stays JS)*
- `monday-sdk-js@0.5.7` (client API) · `@mondaycom/apps-cli@4.10.5` (deploy CLI)  *(standard #3 ✓ aligned)*
  - `@mondaycom/apps-sdk` is **not used** — it's the server-side SDK; Tracker is a client app (Custom Object). Correct as-is.
- `@vibe/core` · `react-big-calendar` (patched) · `i18next` + `react-i18next` · `date-fns` · `exceljs` · `recharts`
- **`@axis/app-core`** (`link:../Services/axis-app-core`) — shared Axis infrastructure (standard #17). Tracker currently consumes only the **storage primitives** (`resolveInstanceId`, `withTimeout`, `ATTEMPT_TIMEOUT_MS`) in `SettingsContext`; consumed as TS source via a Vite alias + `resolve.dedupe: ['react','react-dom']` (see `vite.config.js`). The rest of Tracker's infra (logger, error pipeline, MondayContext, bootstrap) stays **local by design** — its record/listener shapes are test-locked and app-core cannot reproduce them. See §8 “@axis/app-core consumption”.

## 4. Constants
- **No hardcoded board IDs** — all board/column targeting is configurable via settings (see §8 Settings). Always resolve via `getEffectiveBoardId()`.
- Event-type labels (`utils/eventTypeValidation.js`): `REQUIRED_EVENT_TYPE_LABELS = ['חופשה','מחלה','מילואים','שעתי','לא לחיוב','זמני']`, `TEMPORARY_EVENT_LABEL = 'זמני'`.
- All-day types (`utils/durationUtils.js`): `ALL_DAY_EVENT_TYPES = ['חופשה','מחלה','מילואים']`.
- `STRUCTURE_MODES`, `EVENT_CATEGORIES`, `CATEGORY_LABELS` (`contexts/SettingsContext.js`, `utils/eventTypeMapping.js`).
- Settings storage: **global `monday.storage`**, key `customSettings_${instanceId}` (see §6 Settings Management — not instance storage). Work week: **Sunday–Thursday** (Israel).

## 5. Deploy
```bash
# Development
pnpm start            # stop + server (port 8301) + tunnel
pnpm run server       # dev server only
pnpm run expose       # mapps tunnel:create -p 8301
pnpm run stop         # kill dev processes
```
**Deploy** — via the mapps skill ship procedure (one gated confirmation question; it rebuilds and force-pushes internally): `/Users/ilaish/monday_app/apps/.claude/skills/mapps/scripts/ship.sh`. Plain `pnpm run deploy` / `mapps code:push` are blocked by a PreToolUse hook — do not attempt them directly.
`.env` conventions: `VITE_*` (client, inlined at build). The liveUrl is stable across deploys (`mapps code:status`).

---

## 6. Technical Standards

### MondayAPI  *(#4)*
Implements the `Monday-api-service` contract pattern: **all** monday API calls route through a single funnel — `src/utils/mondayApi.js`, wrapping `safeApi` (`utils/mondayApi/client.js`). Components never call the SDK directly.
- Key functions: `createBoardItem`, `deleteItem`, `updateItemColumnValues`, `fetchProjectsForUser`, `fetchItemById`, `fetchCurrentUser`, `fetchActiveAssignments`, `fetchConnectedBoardsFromColumn`, `fetchUniquePeopleFromBoard`, `fetchItemsStatus`, `MondayApiError`.
- `safeApi(monday, callerName, query, options)` is the SINGLE live wrapper — logs every path (pre-call, response, soft-error, retry, throw) but does **not** throw on GraphQL soft-errors; mutate-path callers must inspect `res.errors`/missing ids themselves.
- GraphQL columns: see `monday-api/references/column-formats.md` for the current `settings` field rules. See §8.
- **Decision (#4): deferred** — Tracker's wrapper predates `Monday-api-service`; reconcile method names with the shared contract later (the service is still early-stage).

### Logging  *(#5)*
Use `logger` (`src/utils/logger.js`) — never `console.log` (ESLint `no-console: error`).
```javascript
import logger from './utils/logger';
logger.debug/info/warn/error('Module', 'msg', data);
logger.api('fn', query, variables); logger.apiResponse('fn', res, ms); logger.apiError('fn', error);
logger.functionStart('fn', params); logger.functionEnd('fn', result);
```
Production: ERROR only. Enable in prod console: `window.enableDebugLogs()`.
- **Decision (#5): deferred** — console-only today; migrate to the unified logger → Axiom gradually later (existing-app path).

### Error Handling  *(#6 — Tracker is the reference model for the standard)*
Stack: `ErrorBoundary` (render-throws) + `globalErrorHandler` (`utils/globalErrorHandler.js`: window.onerror + unhandledrejection) + a **UI sink** (`hooks/useUiErrorSink.js`, registered in `AppContent`) that turns every ERROR log record into exactly one toast (with `errorDetails` for `ErrorDetailsModal`). Early init errors replay from the ring buffer on mount (cap 5).

```javascript
try {
    await someApiCall();
} catch (error) {
    // showErrorWithDetails is a log-only facade (log-once); display is done by the UI sink.
    // Do NOT add an adjacent logger.error — that double-displays.
    showErrorWithDetails(error, { functionName: 'myFunction' });
}
```
**One error = one log record = one toast.** The canonical (richest) record is owned by the catch closest to the source: `safeApi` for monday API errors, `globalErrorHandler` for uncaught, `ErrorBoundary` for render throws. `showErrorWithDetails` de-dupes against `error.__loggedId`.

Every `catch` must do exactly one of: call `logger.*`, re-`throw`, or `showErrorWithDetails`. Only allowed silent path: `if (e.name === 'AbortError') return;`. Errors wrap in `MondayApiError` (`response`, `apiRequest`, `errorCode`, `functionName`, `duration`).

### I18n  *(#7)*
`i18next` + `react-i18next` configured. User-facing text is Hebrew.
- **Decision (#7): deferred** — adopt the shared ESLint rule banning Hebrew string literals outside `t(...)` only **after** migrating remaining hardcoded Hebrew into translation bundles.

### Settings Management  *(#8 — must document)*
- Mechanism: **global `monday.storage`** (account/app scope) via `SettingsContext` (React Context), under key `customSettings_${instanceId}` where `instanceId = context.instanceId || context.boardId || 'default'`. **Not** `monday.storage.instance` — isolation between boards is by the namespaced key, not monday's built-in instance scoping. (Same pattern everywhere: project colors use `projectColors_${instanceId}` and the `useAllBoardProjects` cache also use global `monday.storage`. Nothing in the app uses instance storage.)
- **Storage primitives are shared (#17):** `SettingsContext` builds the key via `resolveInstanceId()` and wraps the `getItem` read in `withTimeout(..., ATTEMPT_TIMEOUT_MS, 'storage.getItem')` — all imported from `@axis/app-core`. These are byte-identical to the previous inline code (same `instanceId` order, same 5 s timeout, same `'storage.getItem timeout'` message the load classifier matches). Everything else in `SettingsContext` (the full `DEFAULT_SETTINGS` schema, load-time migrations, single-attempt + one silent-reload guard, `lastModifiedBy` injection, optimistic update + rollback, `validateStorageResponse`) is **local** — it is Tracker-specific and stays here.
- Schema & keys: board config, structure mode, column mappings, project-type distinction — fully enumerated in §8 Settings.
- Validation: `utils/settingsValidator.js` — `validateEventTypeColumn(settings)` (all 6 labels), `getRequiredSettings(fieldConfig, useAssignmentsMode, projectsSourceMode, absenceSource)` — `allDayTypeStatusColumnId` is required only when `absenceSource !== 'dayoff'` (W4.5).

### Testing  *(#10)*
`Vitest` (jsdom, `src/setupTests.js`). 82 test files, 949 tests (count drifts — re-check with `pnpm run test:run`). The Day-off-integration defaults (`absenceSource='tracker'` & friends) are test-locked in `contexts/__tests__/SettingsContext.dayoffDefaults.test.jsx` (W4.8) — changing a default is a behavior change for every existing install and must fail there first.
```bash
pnpm test            # watch
pnpm run test:run    # CI
pnpm run test:tz:matrix   # TZ-aware: Asia/Jerusalem, UTC, America/New_York
```
- **Decision (#10):** coverage target **100% — aspirational, not CI-blocking**. Report coverage; do not fail the build on it.

### ESLint  *(#9)*
`eslintConfig` in `package.json` (extends `react-app`). Shared core rules present:
- **catch-block rule** (`no-restricted-syntax`): every `catch` must `logger.*` / `throw` / `showErrorWithDetails`. Plus `no-console: error`, `no-empty` (no empty catch).
- **Decision (#9): deferred** — add the shared **Hebrew-in-`t()`** rule together with #7 (after i18n migration); flat-config migration deferred with it.

---

## 7. Workflow

### Before All
- Identify the area: most logic lives in `hooks/` (data) and `components/` (UI); API in `utils/mondayApi.js`; settings in `contexts/SettingsContext.js`.
- Don't break: the single-funnel API (`safeApi`), the one-error-one-toast contract, board-ID resolution (`getEffectiveBoardId()`), and structure-mode guards.
- Run `pnpm run test:run` before and after.

### Change Classification
Classify the change — **behavior change / bug fix / new component** — and open it via `change-tracker` (`/new_change`).  *(standard #13)*

### After All
- Run tests (`pnpm run test:run`, and `test:tz:matrix` for date/time logic).
- **Structural change → update `ARCHITECTURE.md`** (exists; generated from the codebase).  *(standard #14)*
- Close the change via `change-tracker` (`/close_change`). Changes/bugs are documented there, not in this file.

---

## 8. Tracker-Specific (optional sections)

### @axis/app-core consumption (standard #17)
Tracker is a mature, heavily-tested app; its migration onto the shared package is **deliberately conservative — zero behavior change, no storage migration.** An audit of all 60+ infra consumers (and an adversarial review) established what can and cannot be delegated:

| Concern | Decision | Why |
|---|---|---|
| **Settings storage primitives** | **DELEGATED** → `resolveInstanceId`, `withTimeout`, `ATTEMPT_TIMEOUT_MS` from `@axis/app-core`, used in `SettingsContext` | Byte-identical to the prior inline code; plain functions (no React) → no dual-React risk. |
| Logger (`utils/logger.js`) | **KEEP local** | `logger.test.js` hard-asserts record shapes app-core's `createLogger` can't produce (`kind`, 3-arg `api`/`apiResponse` packed into `record.context`, `getLevel`/`isDebug`, he-IL grouping, `initDone`/`functionStart`…). Delegating breaks ~70 tests. |
| Global error handler / `ErrorBoundary` / `errorHandler` / `useUiErrorSink` | **KEEP local** | Tests assert exact listener count, module names, and the `{error,apiRequest,request}` full-error object + one-toast contract. app-core's versions require a `logger` prop and emit different shapes. |
| MondayContext | **KEEP local (for now)** | app-core's `useMondayContext` is **not** a superset — it lacks `weekStartDay`/`timeFormat`/`useMobile`, derives `currentUser` without Tracker's `query{me}` fallback, and adds a required `logger` prop + a 2nd `monday.get('context')` that would break the "context loaded once" test. A wrapper is possible but fragile; deferred as an opt-in follow-up. |
| Bootstrap (`index.jsx`/`init.js`) | **KEEP local** | Controls `@vibe/core/tokens`-before-CSS + i18n side-effect ordering and the zero-arg `setupGlobalErrorHandlers()`; app-core `bootstrapApp` defaults `strict:true` (StrictMode would double the single context load). |

**Wiring:** `@axis/app-core` is aliased to its TS source in `vite.config.js` with `resolve.dedupe: ['react','react-dom']` (so app-core's own React copy can never cause an "Invalid hook call") and `test.server.deps.inline` (so Vitest transforms the TS). **Do not** delegate any KEEP-marked concern without first enriching app-core to an exact superset and re-running all 855 tests.

### Architecture — Entry Flow
```
index.html → src/index.jsx → src/init.js (Monday SDK) → App.jsx → MondayCalendar.jsx
```
> Sizes drift; for current counts: `find src -name '*.js*' -not -path '*/__tests__/*' | xargs wc -l | sort -rn | head`.

### Component Tree
```
App.jsx
├─ SettingsProvider
│  └─ AppContent
│     ├─ MondayCalendar
│     │  ├─ CalendarToolbar → FilterBar
│     │  ├─ DnDCalendar (react-big-calendar)
│     │  ├─ EventModal (timed) / AllDayEventModal (vacations/sick/reserves)
│     │  └─ CustomEvent (tooltip renderer)
│     ├─ SettingsDialog (StructureTab / MappingTab / FiltersTab)
│     ├─ ToastContainer
│     └─ ErrorDetailsModal
```
State: **SettingsContext** (global, → global `monday.storage` keyed by `instanceId`) + local `useState` (no Redux/Zustand).

### Event Types
**Timed (שעתי):** work hours with start/end/duration; Projects (פרויקטים) or Routine (שוטף); with `enableProjectTypeDistinction` → Internal (פנימי)/External (חיצוני); Temporary (זמני) placeholders. Via `EventModal`.
**All-Day (יומי):** חופשה / מחלה / מילואים; duration in days; supports bulk reporting. Via `AllDayEventModal`.
```javascript
import { isAllDayEventType, ALL_DAY_EVENT_TYPES } from './utils/durationUtils';
import {
    EVENT_CATEGORIES, CATEGORY_LABELS, DISTINCTION_CATEGORY_LABELS,
    resolveTimedEventIndex,  // central resolver: isBillable + project type + distinction mode
    smartValidateMapping, isProjectIndex,
} from './utils/eventTypeMapping';
```
**Project Type Distinction:** when on, event type auto-resolves from project's `projectType` (status/mirror); uses `internalProject`/`externalProject`/`routine`; `resolveTimedEventIndex()` replaces `getTimedEventIndex()`.

### Structure Modes
`STRUCTURE_MODES` (in `contexts/SettingsContext`): `PROJECT_ONLY`, `PROJECT_WITH_STAGE`, `PROJECT_WITH_TASKS`, `PROJECT_WITH_TASKS_AND_STAGE`.

### Board ID Resolution
`utils/boardIdResolver.js` → `getEffectiveBoardId`, `hasValidReportingBoard`, `isCustomObjectMode`.
1. `useCurrentBoardForReporting=true` AND `context.boardId` → context.boardId
2. `timeReportingBoardId` set → that
3. fallback → `context.boardId`

### Key Hooks
- `useMondayEvents(monday, context)` → events, loading, loadEvents, createEvent, updateEvent, deleteEvent, updateEventPosition, addEvent. Cursor pagination; `rulesToGraphQL()`.
- `useAllDayEvents` → handleCreate/Update/Delete all-day; bulk via `calculateEndDateFromDays()`.
- `useCalendarFilter` → selected reporter/project ids, filterRules, hasActiveFilter.
- `useFilterOptions` → reporters, filterProjects (+loading); from employees/reporting board.
- `useEventDataLoader` → lazy full event data on edit (linked_items + fallback).
- `useProjects` → projects by `peopleColumnIds` (assignments-mode aware).
- `useTasks` → fetchForProject, createTask.
- `useNonBillableOptions` / `useStageOptions` → status-column option loaders.
- `useDayOffAbsences(monday)` → absences, loading, loadAbsences(start,end), clearAbsences. Read-only overlay from the Day-off vacations board (W4.1); one multi-day all-day event per board item (`isDayOff`, `readOnly`, exclusive end); active only when `showAbsences` + full `dayOff*` mapping. Wired into `MondayCalendar` (W4.2): loaded on range change + initial window + settings-change refetch, merged into `enrichedEvents` as a read-only overlay, with `isDayOff` guards at every behavioral touchpoint (click/long-press/drag/resize/delete/update/context-menu/approve-all/celebration). The automatic Israeli-holidays layer (`@hebcal/core`, `showHolidays`) was removed entirely (change #86, 2026-06-11) — holidays appear only as Day-off company-wide absences.
- `useEventModals` → modal states + temporary-event convert mode.
- `useToast` → showSuccess/Error/Warning, **showErrorWithDetails(error, ctx)**, removeToast.

### API details
GraphQL columns: see `monday-api/references/column-formats.md` for the current `settings` field rules. Parse with `JSON.parse()` or `parseStatusLabels()` / `parseStatusColumnLabels()`. SDK error shape: `error.message='Graphql validation errors'`, `error.data={errors:[...]}` (preserved through `safeApi` → `MondayApiError.response`). `wrapMondayApiCall` was removed (Wave 4.1.5) — only `safeApi`.

### Settings (full schema)
**Board config:** `projectsSourceMode` ('board'|'portfolio'), `connectedBoardId`, `tasksBoardId`, `useCurrentBoardForReporting`, `timeReportingBoardId`, `useAssignmentsMode`, `assignmentsBoardId`, `assignmentPersonColumnId`, `assignmentStartDateColumnId`, `assignmentEndDateColumnId`, `assignmentProjectLinkColumnId`.
**Portfolio mode** (`projectsSourceMode==='portfolio'`): tasks board is per-project via `resolveTasksBoardId()` (`utils/portfolioResolver.js`); `tasksProjectColumnId` fixed to `'portfolio_project_link'`; project type from `projectTypeColumnId` directly; `peopleColumnIds` defaults `['portfolio_project_owner']`; orthogonal to assignments mode; skips tasksBoardId validation.
**Filter config:** `filterProjectsBoardId`, `filterEmployeesBoardId`, `filterEmployeesColumnId`.
**Column mappings:** `dateColumnId` (date), `durationColumnId` (numbers, hours/days), `projectColumnId`/`taskColumnId` (board_relation), `reporterColumnId` (people), `eventTypeStatusColumnId` (status), `nonBillableStatusColumnId` (status), `stageColumnId` (status), `notesColumnId` (text), `endTimeColumnId` (date).
**Project type distinction:** `enableProjectTypeDistinction`, `projectTypeColumnId`, `projectTypeMapping` (`{labelText:'internal'|'external'}`), `projectTypeSourceBoardId`, `projectTypeSourceColumnId`.
**Absence source (Day-off integration W4.5):** `absenceSource` (`'tracker'`(default)`|'dayoff'`), `showAbsences`, `dayOffApprovalRequired` (D2 policy), `dayOffAppUrl` (optional http(s) deep-link to the Day-off component, opened by the W4.4 absence-report button), and the manual vacations-board mapping (D9): `dayOffBoardId`, `dayOffPersonColumnId`, `dayOffStartDateColumnId`, `dayOffEndDateColumnId`, `dayOffKindColumnId` + `dayOffKindGeneralLabelId`/`dayOffKindPersonalLabelId`, `dayOffTypeColumnId`, `dayOffApprovalColumnId` + `dayOffApprovedLabelIds`/`dayOffPendingLabelIds`/`dayOffRejectedLabelIds` (stable label IDs, never text — see `../Day-off/CONTRACT.md`; the rejected set is optional — under an approval-required policy those items are silently excluded, and an approval label matching no set fails loudly). With `absenceSource='dayoff'`, `allDayTypeStatusColumnId` is no longer required, and the in-tracker all-day entry redirects to Day-off (W4.4/D5, reworked in change #85): the modal's type menu becomes two buttons — bulk reports on top, an absence-report button below that opens `dayOffAppUrl` in a new tab (disabled with an inline note when unset); `createSingleAllDayEvent`/`handleUpdateAllDayEvent` are gated (bulk reports stay). The overlay loader is `hooks/useDayOffAbsences.js` (W4.1).

### Component Patterns
Folder: `src/components/ComponentName/{ComponentName.jsx, ComponentName.module.css, index.js}`. CSS Modules. Modal pattern: `if (!isOpen) return null;` + overlay click-to-close.

### Calendar Configuration
`src/constants/calendarConfig.jsx` → `localizer`, `hebrewMessages`, `formats`, `WorkWeekView`, `roundToNearest15Minutes`, `timeOptions15Minutes`. Work week Sunday–Thursday.

### Duration Handling
`utils/durationUtils.js` → `isAllDayEventType`, `parseDuration` (→ {value, unit:'hours'|'days'}), `formatDurationForSave`, `calculateEndDateFromDays` (exclusive end), `calculateDaysDiff`.

### Data Flow
```
MondayCalendar.jsx
├─ useSettings() → global settings        ├─ useEventModals() → modal states
├─ useProjects() → projects               ├─ useAllDayEvents() → all-day handlers
├─ useCalendarFilter() → filter rules      └─ useEventDataLoader() → lazy edit data
├─ useFilterOptions() → dropdowns
├─ useMondayEvents(settings+rules) → events (filters applied via GraphQL)
└─ CalendarToolbar → FilterBar (reporters, filterProjects, onChange callbacks)
```

### Monday SDK Context
Centralized `MondayContext` provider loads SDK context once: `const { context, isMobile } = useMondayContext();` (or `useMobile()`). When planning a feature needing platform info, **check the SDK context first**; if missing, ask / check docs before a custom solution.

### Common Pitfalls
1. No `console.log` — use `logger`. 2. All user messages in Hebrew. 3. Validate structure mode before task/stage access. 4. Monday API expects **UTC** for date columns. 5. react-big-calendar uses **exclusive** end for all-day. 6. Always `getEffectiveBoardId()`, never hardcode boards. 7. Check `useAssignmentsMode` before assuming project source. 8. All 6 event-type labels must exist. 9. Column formats: follow `monday-api/references/column-formats.md` (never `settings_str`). 10. With distinction on, use `resolveTimedEventIndex()`.

### Manual Test Pass
Load calendar & navigate weeks → create timed (project/task/stage) → create all-day (חופשה/מחלה/מילואים) → bulk all-day → edit (verify lazy load) → drag → resize → delete → filter by reporter/project → change settings (Structure/Mapping/Filters tabs) and verify.

### Files to Know
| Purpose | Files |
|---------|-------|
| Entry | `index.jsx`, `App.jsx` |
| Main view | `MondayCalendar.jsx` |
| Monday context | `contexts/MondayContext.jsx` |
| Settings | `SettingsDialog/`, `SettingsContext.jsx` |
| Event forms | `EventModal/`, `AllDayEventModal/` |
| Filtering | `FilterBar/`, `hooks/useCalendarFilter.js`, `hooks/useFilterOptions.js` |
| API | `utils/mondayApi.js`, `utils/mondayApi/client.js` |
| Board resolution | `utils/boardIdResolver.js`, `utils/portfolioResolver.js` |
| Event hooks | `hooks/useMondayEvents.js`, `useAllDayEvents.js`, `useEventDataLoader.js` |
| Data hooks | `hooks/useProjects.js`, `useNonBillableOptions.js`, `useStageOptions.js` |
| Event type mapping | `utils/eventTypeMapping.js` |
| Validation | `utils/settingsValidator.js`, `utils/eventTypeValidation.js` |
| Utilities | `utils/durationUtils.js`, `utils/errorHandler.js`, `utils/globalErrorHandler.js` |
| Error UI | `hooks/useUiErrorSink.js`, `ErrorDetailsModal/` |
| Config | `constants/calendarConfig.jsx` |
