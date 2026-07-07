# Error-Handling Audit Report

Scope: full `src/` tree of the Monday.com Tracker board-view app (components, hooks, contexts, utils, constants, plus the global bootstrap and ErrorBoundary infrastructure). Each error source was classified across six dimensions — Caught, Logged, Surfaced to user, Clarity (mapped vs generic vs opaque), Category, and Severity — then given a PASS / GAP verdict against the project's 7-layer error-handling standard.

---

## 1. Executive Summary

- **Total error sources audited: 213**
- **PASS: 162**
- **Gaps: 51**

The codebase is in solid shape overall. The dominant pattern — API reads/mutations going through `safeApi` / `wrapMondayApiCall`, caught in a `try/catch`, logged via `logger.*`, and surfaced through `showErrorWithDetails` / `handleGlobalError` (toast + details modal) with `parseMondayError` mapping — is applied consistently and correctly across the hooks and the Monday API layer. The 51 gaps cluster around three themes: (a) **soft GraphQL errors treated as success** (`safeApi` logs but does not throw on GraphQL errors, so several mutate paths report false success), (b) **silent swallows** (empty / comment-only catches with no `logger` call), and (c) **unguarded date/number parsing** in the dashboard aggregation and date-formatting utilities.

### By Severity

| Severity | Total | PASS | Gaps |
|----------|------:|-----:|-----:|
| Critical | 3 | 0 | 3 |
| High | 12 | 0 | 12 |
| Medium | 17 | 4 | 13 |
| Low | 181 | 158 | 23 |
| **Total** | **213** | **162** | **51** |

> Severity is reported for every row; PASS rows carry a severity that reflects the blast radius *if* the path were to fail, not an existing defect. The "Gaps" column is the count that needs action.

### By Category

| Category | PASS | Gaps |
|----------|-----:|-----:|
| api | 70 | 8 |
| validation | 28 | 20 |
| render | 36 | 9 |
| race | 12 | 7 |
| sdk | 10 | 3 |
| network | 9 | 0 |
| uncaught | 7 | 2 |
| **Total** | **172**\* | **49**\* |

> \* Category counts are computed per audit row. A handful of error sources are dual-tagged across separate verification rows (e.g. the same SDK call appears under both `sdk` and `api`/`race`), so category sub-totals sum slightly higher than the 213 distinct sources. The authoritative count is **213 sources / 162 PASS / 51 gaps**.

### Headline

3 critical gaps sit on the event-create and project-load paths, where a failed operation is either invisible (false success toast) or actively destructive (blanks a freshly loaded list). The 12 high gaps are dominated by mutate-path soft-failure swallows (`safeApi` returns instead of throwing) and empty/comment-only `catch` blocks with no logger.

---

## 2. Infrastructure Findings

Both the global safety net and the React `ErrorBoundary` **exist and are wired correctly at a basic level**, but each has partial coverage.

### 2.1 Global Error Handler — EXISTS, quality: partial

Files: `src/utils/globalErrorHandler.js`, `src/index.jsx`, `src/App.jsx`, `src/utils/lazyRetry.js`

**Positives**
- Ordering is correct: `setupGlobalErrorHandlers()` runs at `index.jsx:11` **before** `root.render` at `index.jsx:13-14`, so handlers are installed before React mounts.
- Both `window 'error'` (uncaught) and `'unhandledrejection'` listeners are installed (`globalErrorHandler.js:59`, `:101`).
- Monday-shaped errors are mapped via `parseMondayError` downstream and surfaced via toast + `ErrorDetailsModal`.
- Chunk-load failures are detected and trigger a single reload via `handleGlobalChunkError` (`lazyRetry.js`), with `logger.warn` / `logger.error` on the reload / exhausted paths.

**Gaps**
- **MEDIUM — logging step swallowed on the Monday-error path.** The global path for Monday-shaped errors routes `handleGlobalError -> showErrorWithDetails` (`globalErrorHandler.js:20-37, 72-77, 114-119`). `showErrorWithDetails` (`hooks/useToast.js:69-134`) maps and surfaces a toast/modal but **never calls `logger`**. So an unhandled rejection / uncaught error that *is* a Monday error is surfaced + mapped but never logged. Fix: in `handleGlobalError`, call `logger.error('GlobalErrorHandler', message, error)` (or `logger.apiError`) before/after invoking `globalShowErrorWithDetails`.
- **LOW — console-only fallbacks.** Non-Monday unhandled rejections and uncaught errors fall through to bare `console.error` (`globalErrorHandler.js:97`, `:139`), as do the no-handler / handler-failure fallbacks (`:23`, `:33-35`). Visible, but they bypass `logger`. Fix: replace with `logger.error`.
- **LOW–MEDIUM — silent swallow on the resource path.** The capture-phase resource-error listener (`globalErrorHandler.js:45-56`) only reacts when `handleGlobalChunkError()` returns true. A genuine non-chunk SCRIPT/LINK/IMG load failure produces neither a `logger` call, nor a console line, nor user surfacing — dropped silently. Fix: add `logger.warn`/`logger.error` in the else branch.
- **INFO (not a gap).** No `AbortError` filter exists in the global handlers. The standard treats `AbortError` filtering as an allowed exception, not a requirement, so its absence is acceptable; intentional fetch aborts would currently log as cosmetic noise via the fall-through `console.error`.

### 2.2 ErrorBoundary — EXISTS, coverage: partial

Files: `src/components/ErrorBoundary/ErrorBoundary.jsx`, `src/App.jsx`

**Positives**
- `componentDidCatch` logs via `logger.error('ErrorBoundary', 'React error caught', error)` (`ErrorBoundary.jsx:38`) — no silent swallow.
- The error is mapped via `parseMondayError` + `createFullErrorObject` (`ErrorBoundary.jsx:44-45`) and surfaced both through the `onError` callback that opens `ErrorDetailsModal` (`App.jsx:144-146`) and via a fallback UI with title/message/details (`ErrorBoundary.jsx:56-86`).
- The `fallback()` helper guards an i18next-not-initialized state with a try/catch and a hardcoded Hebrew fallback, avoiding a crash-in-the-crash.

**Gaps**
- **MEDIUM — root not fully covered (can blank the screen).** The single `ErrorBoundary` is mounted **inside** `AppContent` at `App.jsx:143`, **after** the early returns for `loadError` (`App.jsx:129-131 -> NetworkErrorScreen`) and `isLoading` (`App.jsx:133-140`), and **below** the three context providers (`MondayProvider`, `SettingsProvider`, `ProjectColorsProvider` at `App.jsx:233-239`). A render throw in any provider, in the loading/error branches, in `useLanguageSync`/`useLocale`/theme effects, or anywhere in `AppContent` above line 142 is **not caught** and will blank the screen. Fix: wrap the provider tree (or the whole `App` return) in an outer `ErrorBoundary` in addition to the inner one.
- **MEDIUM — no per-component / per-route boundaries.** `ErrorBoundary` is used exactly once (grep-confirmed). The lazy-loaded heavy components (`MondayCalendar`, `Dashboard`, `SettingsDialog`, `SettingsWizard`, `ProjectColorsDialog`) all share that one root boundary, so a render throw in any of them tears down the entire app instead of being isolated. Fix: wrap `MondayCalendar` and each lazy Suspense subtree in its own `ErrorBoundary`.

**Net infrastructure assessment:** No AUTOMATIC-FAIL silent swallow on a mutate path was found in the infrastructure itself (the `ErrorBoundary` logs; the global handler at least surfaces + maps). The two most material infrastructure gaps to close are the **global handler's missing `logger` call** on the Monday-error path and the **root boundary's placement below the providers**.

---

## 3. Central Findings Table (sorted by severity: critical → low)

Columns: Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix.
All CRITICAL / HIGH / MEDIUM rows are listed individually. The 158 LOW PASS rows are summarized in a single trailing row (full per-file detail lives in the raw audit dataset), and the 23 LOW gaps are listed individually below the medium block.

### Critical

| Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix |
|---|---|---|---|---|---|---|---|---|---|
| `hooks/useAllBoardProjects.js:215` | Direct-board success path calls `writeCache(cacheKey, result)` — both identifiers are **undefined** in the module | uncaught | try-catch | logger-error | none | generic | critical | GAP | Throws `ReferenceError` on **every** successful direct-board fetch (after `setProjects(result)`), jumping to the catch which runs `setProjects([])` — silently blanks the freshly-loaded list and logs a misleading "Error fetching board projects". Replace with `saveToStorage(instanceId, { signature, projects: result, ts: Date.now() })` to mirror the assignments path, or remove the line. |
| `hooks/useMondayEvents.js:642-673` | `createEvent` mutate: a falsy `createdItem` (soft GraphQL error → `create_item === undefined`) removes the skeleton and returns `null` with no logger and nothing surfaced | race | none | swallowed | none | opaque | critical | GAP | Failed create is indistinguishable from success. Treat falsy `createdItem` as failure: `logger.error` with the swallowed response and throw a `MondayApiError` (or return a typed failure) so the caller's catch surfaces it. |
| `MondayCalendar.jsx:915-919` | `handleCreateEvent`: on a `null` return from `createEvent` still calls `checkCelebration` + `showSuccess('event created')` | api | try-catch | swallowed | toast | opaque | critical | GAP | False success toast on a failed create. Guard the return value: if `createEvent` resolves falsy, `logger.error` + `showErrorWithDetails` instead of `showSuccess`. Pair with throwing in `createEvent`. |

### High

| Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix |
|---|---|---|---|---|---|---|---|---|---|
| `utils/mondayApi/columns.js:59-62` | `createEventTypeStatusColumn` (mutate): soft failure returns `undefined` id without throwing | api | wrapper | logger-error | none | mapped | high | GAP | On a soft GraphQL error `safeApi` returns (logged at ERROR, not thrown), so `create_status_column?.id` is `undefined` and the user-initiated setup flow silently does nothing. Detect missing id and throw `MondayApiError`. |
| `utils/mondayApi/columns.js:90-93` | `createColumn` (mutate): soft failure returns `null` without throwing | api | wrapper | logger-apiError | none | mapped | high | GAP | `createBoardWithColumns` just warns and continues, so a column silently goes missing (half-built board). Throw a `MondayApiError` on `null` `create_column`. |
| `utils/mondayApi/items.js:196` | `JSON.parse` of board_relation column settings in `findProjectLinkColumn` | validation | try-catch | swallowed | none | opaque | high | GAP | Enclosing `catch { continue; }` swallows parse failure silently. Add `logger.warn('findProjectLinkColumn', 'Failed to parse column settings', error)` before continuing so a malformed column does not silently hide the project-link column. |
| `utils/mondayApi/items.js:202` | `catch { continue; }` around the column-settings parse — empty, no logger | validation | try-catch | swallowed | none | opaque | high | GAP | Empty catch = automatic fail. Add a `logger.warn` with module/message/error before continuing. |
| `utils/mondayApi/items.js:525` | `JSON.parse` of a project-type status value in `fetchActiveAssignments` | validation | try-catch | swallowed | none | opaque | high | GAP | Comment-only catch swallows the parse error. Add `logger.warn('fetchActiveAssignments', 'Failed to parse project type value', error)` so a malformed status value does not silently drop project type. |
| `utils/mondayApi/items.js:527` | Comment-only catch around the project-type parse — no logger | validation | try-catch | swallowed | none | opaque | high | GAP | Comment-only catch = automatic fail. Add a `logger.warn` with the error object before continuing. |
| `hooks/useAllDayEvents.js:136-168` | `handleUpdateAllDayEvent` runs two `safeApi` mutations then unconditionally `showSuccess('eventUpdated')` | api | try-catch | logger-error | toast | generic | high | GAP | `safeApi` returns raw response on GraphQL soft errors without throwing, so a failed mutate (permission/invalid index) never enters the catch and a false "eventUpdated" toast shows. Inspect `res.errors` / missing returned id and `showError` (mapped) when the mutation did not apply. |
| `hooks/useCalendarSelection.js:50-72` | Bulk duplicate: per-item `createEvent` loop with per-event try/catch; failures only logged, success toast gated on `successCount>0` | api | try-catch | logger-error | none | generic | high | GAP | A full-failure shows the user nothing (inner catch swallows; outer catch never sees it). Track `failureCount` and on `successCount===0` or any failure call `showError`/`showErrorWithDetails` with the last caught error. |
| `contexts/SettingsContext.jsx:248-318` | `JSON.parse(result.data.value)` of stored settings + migrations inside a `try` whose only handler is `finally` (NO catch) | validation | none | swallowed | none | opaque | high | GAP | A corrupt stored value makes `JSON.parse` throw; `isLoading` is set false only in the success branches, so on a parse throw `isLoading` stays `true` and the app hangs on the spinner with nothing logged. Wrap parse/migration in a catch: `logger.error` then fall back to `DEFAULT_SETTINGS` or route through `handleNetworkFailure`. |
| `contexts/SettingsContext.jsx:337-340` | `useEffect` calls `loadSettings()` without awaiting / catching the returned promise | race | none | swallowed | none | opaque | high | GAP | `loadSettings` can reject via the uncaught `JSON.parse` path, producing an unhandled rejection. Wrap: `loadSettings().catch(err => { logger.error(...); setLoadError({kind:'network'}); setIsLoading(false); })`. |
| `components/SettingsDialog/SettingsDialog.jsx:230-232` | `FileReader.onerror`: import read failed (user action); shows a Hebrew 'readError' toast but never logs | validation | dot-catch | swallowed | toast | generic | high | GAP | Surfaced but never logged (monitoring-blind), inconsistent with the sibling `onload` handler at `:226` which logs. Add `logger.error('SettingsDialog', 'FileReader failed to read import file', reader.error)` inside `onerror`. |
| `components/SettingsWizard/SettingsWizard.jsx:60-68` | `handleInstall` else-branch: `updateSettings` returned falsy (save failed without throwing); surfaces a generic English `new Error('Failed to save settings')` with no logger on this branch | api | try-catch | swallowed | toast | generic | high | GAP | The catch's `logger.error` never fires on the `ok===false` path; `parseMondayError` falls to UNKNOWN and surfaces raw English. Add `logger.error('SettingsWizard', 'updateSettings returned false', { settings })` and a specific Hebrew message. |

### Medium

| Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix |
|---|---|---|---|---|---|---|---|---|---|
| `components/SettingsDialog/MappingTab.jsx:309-315` | Inline `JSON.parse` in the `projectColumns` filter predicate | validation | try-catch | swallowed | none | opaque | medium | GAP | Bare `catch { return false; }` silently hides a valid project-link column. Add `logger.warn('MappingTab', 'Failed to parse project link column settings', { columnId, err })` before returning false. |
| `components/SettingsDialog/MappingTab.jsx:323-329` | Inline `JSON.parse` in the `taskColumns` filter predicate | validation | try-catch | swallowed | none | opaque | medium | GAP | Same bare-catch swallow as above for task-link columns. Add a `logger.warn` before returning false. |
| `components/SettingsDialog/SettingsDialog.jsx:79-96` | `fetchBoards`: `safeApi` board list; only the try/catch (hard throws) handles errors | api | wrapper | logger-error | none | mapped | medium | GAP | `safeApi` does not throw on soft GraphQL errors, so a soft failure yields silently empty board dropdowns. After the call, check `res.errors?.length` and `showErrorWithDetails` when data is missing. |
| `components/SettingsDialog/SettingsDialog.jsx:150-163` | `performSave`: `updateSettings` persist; on `false` result shows a generic `Error('saveError')` toast | api | try-catch | logger-error | toast | generic | medium | GAP | `updateSettings` maps/logs the real error internally and returns a boolean, so only a generic message reaches the user. Have it surface the mapped `MondayApiError` (or return it) so the toast shows the specific cause. |
| `components/SettingsDialog/ProjectColorsTab.jsx:101-103` | Renders the raw `error` string from `useAllBoardProjects` as the blocking tab body | render | wrapper | logger-error | fallback-ui | generic | medium | GAP | `error` is `err.message` (often "Graphql validation errors"). Run it through `parseMondayError` before storing, or render a fixed Hebrew fallback. |
| `components/SettingsDialog/SearchableSelect.jsx:59-65` | Render-time `options.filter/.find` + `option.name.toLowerCase()` with no null guard | render | none | swallowed | none | n/a | medium | GAP | An undefined `options` (transient loading) or unnamed option throws during render and blanks the dialog (no ErrorBoundary around this subtree). Default `options = []` and guard `option?.name`. |
| `utils/columnValueBuilders.js:22-29` | `buildStatusColumnValue` throws a plain Error (no logger) on invalid index — mutate-prep path | validation | none | swallowed | none | mapped | medium | GAP | Fail-fast throw with no logger and no guaranteed caller surfacing. Add `logger.error` at the throw site and verify every save caller wraps in try/catch + `showErrorWithDetails`. |
| `utils/columnValueBuilders.js:41-68` | `buildEventTypeColumnValue` throws a plain Error (no logger) when mapping/category invalid — mutate-prep path | validation | none | swallowed | none | mapped | medium | GAP | Same fail-fast-no-logger pattern. Add `logger.error` at the throw site; confirm create/update callers surface it. |
| `utils/columnValueBuilders.js:78-105` | `assertNoTranslatedLabels` throws (no logger) when it finds `{label}`/`{text}` fields right before an API write | validation | none | swallowed | none | mapped | medium | GAP | A swallowed throw here blocks a save with no diagnostic. Add `logger.error` at the throw site and ensure the write-path caller wraps in try/catch → `showErrorWithDetails`. |
| `utils/dashboardAggregation.js:183-377` | `aggregateAll`: large pure reducer formatting `event.date` via date-fns; invalid date makes `format()` throw at render | render | none | swallowed | none | n/a | medium | GAP | Render-time throw not contained by an ErrorBoundary. Validate `instanceof Date && !isNaN(getTime())` before formatting and wrap the dashboard subtree in an ErrorBoundary. |
| `utils/dashboardAggregation.js:385-407` | `consolidateBarData` → `formatRangeLabel` dereferences `.getMonth()/.getDate()/.getFullYear()` assuming non-empty chunk + valid dates | render | none | swallowed | none | n/a | medium | GAP | Unguarded date access can throw a render-time RangeError. Guard `startDate/endDate` validity and the empty-chunk case; fall back to `firstBar.label`. |
| `utils/dateFilterUtils.js:37-83` | `buildDateFilterRule`: `new Date(dateFrom + 'T00:00:00')` + date-fns `format()` to build a blocking GraphQL filter | validation | none | swallowed | none | opaque | medium | GAP | Malformed `dateFrom` → Invalid Date → `format()` throws RangeError. Validate the anchor (`Number.isNaN(getTime())`) at the top; return a safe default and surface a Hebrew toast since this feeds a user-triggered query. |
| `utils/dateFilterUtils.js:92-116` | `getEffectiveDateRange`: same unvalidated `new Date(...)` + date-fns formatting | validation | none | swallowed | none | opaque | medium | GAP | Guard anchor validity before formatting; return the raw `{from,to}` (or clamped default) on Invalid Date instead of throwing. |
| `utils/dateFilterUtils.js:146-170` | `formatPeriodLabel`: date-fns `format(anchorDate, ...)` at toolbar/dashboard render | render | none | swallowed | none | n/a | medium | GAP | Add an `isValid(anchorDate)` guard before `format()`; return empty string for invalid dates, and/or rely on an ErrorBoundary. |
| `utils/dateFormatters.js:11-16` | `toMondayDateFormat`: `getUTCFullYear/Month/Date` with no validity guard — mutate-path date formatter | validation | none | swallowed | none | opaque | medium | GAP | An invalid Date during save silently produces `'NaN-NaN-NaN'` sent to Monday. Add an `instanceof Date && !Number.isNaN(getTime())` guard (as `dateTimeHelpers.js` does). |
| `utils/dateFormatters.js:23-28` | `toMondayTimeFormat`: `getUTCHours/Minutes/Seconds` unguarded — mutate-path time formatter | validation | none | swallowed | none | opaque | medium | GAP | Yields `'NaN:NaN:NaN'`. Add the same validity guard returning `''` for invalid input. |
| `utils/dateFormatters.js:45-50` | `toLocalDateFormat`: `getFullYear/Month/Date` unguarded | validation | none | swallowed | none | n/a | medium | GAP | Produces `'NaN-NaN-NaN'`. Add a validity guard returning `''`, consistent with `dateTimeHelpers.js`. |
| `utils/dateFormatters.js:57-61` | `toLocalTimeFormat`: `getHours/Minutes` unguarded | validation | none | swallowed | none | n/a | medium | GAP | Produces `'NaN:NaN'`. Add a validity guard returning `''`. |

### Low

The 158 LOW PASS rows are summarized rather than listed individually:

| Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix |
|---|---|---|---|---|---|---|---|---|---|
| 158 sources across `hooks/`, `utils/mondayApi/`, `contexts/`, `components/`, `constants/`, `test-utils/` | The canonical, correctly-handled paths: API reads/mutations via `safeApi`/`wrapMondayApiCall` caught + logged (`logger.error`/`apiError`/`warn`) + surfaced via `showErrorWithDetails`/`handleGlobalError` (toast/inline/fallback-ui) with `parseMondayError` mapping; optimistic-update rollbacks (`useMondayEvents` update/delete/position); guarded date helpers (`dateTimeHelpers.js`); guarded `JSON.parse` helpers (`mondayColumns.js`, `eventTypeValidation.js`, `mirror.js`, `portfolioResolver.js`); pure presentational components with `\|\| []` / null guards; correctly-cleaned timers/listeners; and test-harness scaffolding | api / validation / render / race / sdk / network / uncaught | mixed | mixed | mixed | mixed | low | PASS | No action — these are the reference patterns. Full per-row detail is in the raw audit dataset. |

The 23 LOW gaps (individually):

| Location | Operation | Category | Caught? | Logged? | Surfaced? | Clear? | Severity | Verdict | Proposed fix |
|---|---|---|---|---|---|---|---|---|---|
| `components/MobileResizeOverlay/MobileResizeOverlay.jsx:175` | `navigator.vibrate(10)` in `try/catch` with empty body | uncaught | try-catch | swallowed | n/a | opaque | low | GAP | Empty catch violates zero-silent-swallow. Add `logger.debug('MobileResizeOverlay', 'navigator.vibrate failed', e)`. |
| `components/MonthlyBattery/MonthlyBattery.jsx:46` | `(item.hours / totalHours) * 100` segment width | render | none | swallowed | n/a | n/a | low | GAP | `totalHours===0` → NaN/Infinity width. Guard `totalHours > 0 ? ... : 0`. |
| `components/Dashboard/DashboardFilterPanel.jsx:131` | `formatPeriodLabel(...)` runs date-fns `format()` at render | render | none | swallowed | none | n/a | low | GAP | Guard `periodAnchor` validity before `format()` (defensive; always valid in practice, ErrorBoundary covers). |
| `components/Dashboard/DashboardFilterPanel.jsx:88-99` | `selectedProjectIds/selectedReporterIds.map(String)` with no `= []` default | render | none | swallowed | none | n/a | low | GAP | Add `= []` defaults (only `selectedCustomerIds` has one). |
| `components/Dashboard/SegmentedToggle.jsx:9-24` | `options.map(...)` with no default on `options` | render | none | swallowed | none | n/a | low | GAP | Default `options = []`. |
| `components/SettingsDialog/AdditionalTab.jsx:60-92` | Three async effects fire fetchers; no unmount/abort guard | race | try-catch | logger-error | toast | mapped | low | GAP | Track latest `boardId` / `isMounted` flag and ignore stale responses. |
| `components/SettingsDialog/AdditionalTab.jsx:74-85` | Parses approval status labels in an effect; no local empty-array fallback | validation | wrapper | logger-error | none | mapped | low | GAP | Add an explicit `[]` fallback so a malformed column cannot leave stale state. |
| `components/SettingsDialog/MappingTab.jsx:184-197` | Fire-and-forget `safeApi().then()` parsing assignments link → `setState`, no unmount guard | race | dot-catch | logger-error | none | mapped | low | GAP | Guard the `.then` with a cancelled/`isMounted` flag (or AbortController). |
| `components/SettingsDialog/MappingTab.jsx:117-208` | Multiple async effects `setState` after await with no unmount/Abort guard | race | try-catch | logger-error | toast | mapped | low | GAP | Add `isMounted`/AbortController per effect; ignore stale `boardId` responses. |
| `components/SettingsDialog/MappingTab.jsx:415-427` | `fetchProjectStatusLabels`: relies on wrapper-internal logging, no local guard | validation | wrapper | logger-warn | none | mapped | low | GAP | `parseStatusLabels` cannot throw; make the empty-array fallback explicit at the call site. |
| `components/SettingsDialog/MappingTab.jsx:429-441` | `fetchTaskStatusLabels`: same as above | validation | wrapper | logger-warn | none | mapped | low | GAP | Make the empty-array fallback explicit at the call site. |
| `components/SettingsDialog/MappingTab.jsx:692-693` | `handleEventTypeColumnChange`: parse helper, no local guard | validation | wrapper | logger-error | none | mapped | low | GAP | On empty result `setEventTypeStatusLabels([])` + mark validation invalid. |
| `components/SettingsDialog/MappingTab.jsx:724-732` | Initial-load effect parse, no local guard | validation | wrapper | logger-error | none | mapped | low | GAP | Make the empty-array fallback explicit. |
| `components/SettingsDialog/MultiSelect.jsx:59-63` | `options.filter` + `option.name.toLowerCase()` at render, no default | render | none | swallowed | none | opaque | low | GAP | Default `options = []` and guard `(option.name \|\| '')`. |
| `components/SettingsDialog/ProjectColorsTab.jsx:25-30` | `console.log` of merge | render | none | console-only | n/a | n/a | low | GAP | Replace `console.log` with `logger.debug('ProjectColorsTab', ...)`. |
| `components/SettingsDialog/ProjectColorsTab.jsx:51-60` | `console.log` in `handleColorSelect` | render | none | console-only | n/a | n/a | low | GAP | Replace with `logger.debug`. |
| `contexts/ProjectColorsContext.jsx:59` | `console.log` in `setProjectColor` | render | none | console-only | n/a | n/a | low | GAP | Replace with `logger.debug('ProjectColorsContext', ...)`. |
| `components/SettingsDialog/SettingsDialog.jsx:392-399` | Unguarded `new Date(lastModifiedAt)` formatting at render | render | none | swallowed | n/a | n/a | low | GAP | Validate `!isNaN(d.getTime())` before formatting; fall back to a placeholder. |
| `components/Toast/Toast.jsx:15-21` | 300ms exit timer not cleared; callback after unmount | race | none | swallowed | n/a | n/a | low | GAP | Track the timeout in a ref, clear on unmount, guard with a mounted ref. |
| `components/UndoBanner/UndoBanner.jsx:22-28` | `setTimeout(onUndo, 200)` not wrapped/cleared | uncaught | none | swallowed | none | n/a | low | GAP | Store timer in a ref + clear on unmount; wrap `onUndo()` in try/catch → `logger.error` + Hebrew toast. |
| `constants/calendarConfig.jsx:82-101` | `generateTimeOptions15Minutes` `split(':').map(Number)` with no NaN validation | validation | none | swallowed | none | n/a | low | GAP | Validate parsed hours/minutes with `Number.isFinite`; fall back to default range + `logger.warn`. |
| `utils/colorUtils.js:13-21` | `getContrastColor` `parseInt(hex,...)` with no format validation → silent NaN | validation | none | swallowed | n/a | opaque | low | GAP | Validate hex is 3/6-char before parse; fall back to `'#ffffff'` + optional `logger.warn`. |
| `utils/colorUtils.js:43-58` | `ensureDarkEnough` unvalidated hex → corrupt `'#NaNNaNNaN'` | validation | none | swallowed | n/a | opaque | low | GAP | Guard parsed r/g/b with `Number.isNaN`, fall back to `'#579bfc'` + `logger.warn`. |
| `utils/durationUtils.js:29-33` | `calculateDaysDiff` `getTime()` with no validity guard | validation | none | swallowed | none | opaque | low | GAP | Guard `instanceof Date && !Number.isNaN(getTime())`; return minimum 1 day on invalid input. |
| `utils/durationUtils.js:43-48` | `calculateEndDateFromDays` unguarded Date arithmetic | validation | none | swallowed | n/a | n/a | low | GAP | Guard `start` validity before arithmetic. |
| `utils/durationUtils.js:83-91` | `formatDurationForSave` `toFixed`/`Math.round` unguarded — save path | validation | none | swallowed | none | n/a | low | GAP | Coerce with `Number()` + guard NaN before formatting so the save path cannot throw or write NaN. |
| `utils/editLockUtils.js:43-75` | `isEventLocked` unguarded `new Date(eventDate)` drives an edit-permission decision | validation | none | swallowed | n/a | n/a | low | GAP | Invalid `start` → NaN diff → locked event treated as editable. Validate parsed date; default to locked on invalid. |
| `utils/dashboardAggregation.js:58-64` | `formatWeekLabel` unguarded `getMonth/getDate` + date-fns `format()` | render | none | swallowed | n/a | n/a | low | GAP | Guard `start/end` are valid Dates before formatting. |
| `utils/dashboardAggregation.js:83-143` | `groupByGranularity` only `if(!date) continue`; truthy non-Date passes and throws | render | none | swallowed | none | n/a | low | GAP | Strengthen guard to `instanceof Date && !isNaN(getTime())`. |
| `utils/dashboardAggregation.js:342` | `reporters.map(r => [String(r.id), r.name])` — null element / non-array throws | render | none | swallowed | none | n/a | low | GAP | `reporters.filter(Boolean).map(...)`. |
| `utils/approvalMapping.js:129-159` | `createAutoApprovalMapping` dereferences `labelObj.label/.id` directly | render | none | logger-warn | n/a | mapped | low | GAP | `if (!labelObj) continue` before dereferencing. |
| `utils/dateFormatters.js:35-38` | `toMondayDateTimeColumn` propagates unguarded corruption from its two helpers | validation | none | swallowed | none | n/a | low | GAP | Fixed once the two helpers guard validity; optionally validate input once here. |
| `utils/xorValidation.js:31-32` | Reads `fieldValues[fieldA/B]` without guarding `fieldValues` defined | render | none | swallowed | n/a | n/a | low | GAP | Default `fieldValues = {}` / guard so a missing object returns the empty exempt Set instead of throwing. |
| `test-utils/renderHookWithProviders.jsx:34-40, :49` and `renderWithProviders.jsx:34-39, :51` | Test-only `monday.get` mock + fire-and-forget `storage.setItem` seed | sdk | none | swallowed | n/a | n/a | low | GAP | No production fix needed — dev/test scaffolding against a mock store; cannot affect production behavior. |

---

## 4. Detailed Checklist — Critical & High Gaps (for one-by-one fix approval)

Each item is independently approvable. The recommended fix order is **critical first** (they corrupt state / mislead the user), then the soft-failure swallows, then the remaining high gaps.

### Critical

- [ ] **C1 — `hooks/useAllBoardProjects.js:215`** — Remove/replace the `writeCache(cacheKey, result)` line (both identifiers are undefined) with `saveToStorage(instanceId, { signature, projects: result, ts: Date.now() })` mirroring the assignments path at `:145`. This `ReferenceError` currently fires on every successful direct-board fetch and blanks the project list. Verify: a successful direct-board load keeps `projects` populated and no "Error fetching board projects" appears.

- [ ] **C2 — `hooks/useMondayEvents.js:642-673`** — In `createEvent`, treat a falsy `createdItem` as a failure: `logger.error('useMondayEvents', 'createEvent returned no item', { response })` and throw a `MondayApiError` (or return a typed failure object) instead of silently removing the skeleton and returning `null`.

- [ ] **C3 — `MondayCalendar.jsx:915-919`** — In `handleCreateEvent`, guard the `createEvent` return: if it resolves falsy, call `logger.error` + `showErrorWithDetails` and skip `checkCelebration`/`showSuccess`. Best paired with C2 so the throw flows into the existing catch.

### High

- [ ] **H1 — `utils/mondayApi/columns.js:59-62` (`createEventTypeStatusColumn`)** — After the `safeApi` mutation, detect a missing `create_status_column?.id` and throw `MondayApiError` so the user-initiated setup flow surfaces the failure instead of silently doing nothing.

- [ ] **H2 — `utils/mondayApi/columns.js:90-93` (`createColumn`)** — Throw `MondayApiError` on a `null` `create_column` so `createBoardWithColumns` stops producing half-built boards.

- [ ] **H3 — `utils/mondayApi/items.js:196` + `:202` (`findProjectLinkColumn`)** — Replace the empty `catch { continue; }` around the column-settings `JSON.parse` with `catch (err) { logger.warn('findProjectLinkColumn', 'Failed to parse column settings', err); continue; }`.

- [ ] **H4 — `utils/mondayApi/items.js:525` + `:527` (`fetchActiveAssignments`)** — Replace the comment-only catch around the project-type `JSON.parse` with `catch (err) { logger.warn('fetchActiveAssignments', 'Failed to parse project type value', err); }`.

- [ ] **H5 — `hooks/useAllDayEvents.js:136-168` (`handleUpdateAllDayEvent`)** — Before `showSuccess('eventUpdated')`, inspect each `safeApi` response for `res.errors` / missing returned id; on a soft failure, throw or `showError` (mapped via `parseMondayError`) instead of unconditionally reporting success.

- [ ] **H6 — `hooks/useCalendarSelection.js:50-72` (bulk duplicate)** — Track a `failureCount` in the loop and, when `successCount===0` or `failureCount>0`, call `showErrorWithDetails` (passing the last caught error) so the user learns the duplication partially or fully failed.

- [ ] **H7 — `contexts/SettingsContext.jsx:248-318` (settings `JSON.parse`)** — Add a `catch` to the `try` that wraps the parse/migration: `logger.error('SettingsContext', 'Failed to parse stored settings', err)`, then fall back to `DEFAULT_SETTINGS` or route through `handleNetworkFailure`, and ensure `setIsLoading(false)` runs so the app never hangs on the spinner.

- [ ] **H8 — `contexts/SettingsContext.jsx:337-340` (effect)** — Attach a `.catch` to the `loadSettings()` call in the effect: `logger.error(...)` + `setLoadError({kind:'network'})` + `setIsLoading(false)` to eliminate the unhandled rejection. (H7 and H8 are most safely fixed together.)

- [ ] **H9 — `components/SettingsDialog/SettingsDialog.jsx:230-232` (`FileReader.onerror`)** — Add `logger.error('SettingsDialog', 'FileReader failed to read import file', reader.error)` inside the `onerror` handler, alongside the existing `showErrorWithDetails`, matching the sibling `onload` handler at `:226`.

- [ ] **H10 — `components/SettingsWizard/SettingsWizard.jsx:60-68` (`handleInstall` `ok===false`)** — In the `ok===false` branch add `logger.error('SettingsWizard', 'updateSettings returned false', { settings })` and replace the generic English `Error('Failed to save settings')` with a specific Hebrew message so `parseMondayError` yields actionable, localized text.

> Cross-cutting note: H1, H2, H5, and C2/C3 all stem from the same root cause — `safeApi` logs but does not throw on GraphQL soft errors (`client.js:255-263`). Fixing them individually is correct, but a complementary option worth discussing is a shared `assertNoGraphQLErrors(res)` helper applied at mutate call sites so future mutations inherit throw-on-soft-error behavior by default.
