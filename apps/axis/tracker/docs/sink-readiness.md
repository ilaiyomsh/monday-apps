# Logger Sink-Readiness Report

> **עדכון 2026-06-02 — המסמך משקף את מצב ה-*לפני*.** מאז ה-rollout (change #10) ומימוש
> ה-UI sink (`ui-sink-plan.md` Phase 1, קומיטים `24f1f33`+`e24e831`+`ffeba27`) שני הצירים סגורים:
> (A) קיים chokepoint יחיד — `emit` + `addSink`, וה-`useUiErrorSink` צורך ממנו record מובנה;
> (B) כל מקורות השגיאה מגיעים ל-logger — `showErrorWithDetails` הוא facade לוג-בלבד,
> ה-delegate הגלובלי הוסר, וכל אתרי הרישום מעבירים `Error`. הדוח נשמר כתיעוד היסטורי של נקודת המוצא.

**Question:** Is every error source mapped so it would reach a future centralized sink?

**Answer:** **No.** Neither axis is satisfied today.

---

## 1. Verdict

**No — the logger is not sink-ready, and coverage is incomplete.** The question splits into two independent axes, and the codebase fails both:

- **(A) ARCHITECTURE — can a sink attach in one place to a structured payload?** No. There is **no single chokepoint**. The closest shared helper, `logWithColor` (logger.js:92–101), funnels only 6 of the methods, and even those leak: `logger.error` emits a *second*, direct `console.error` for the stack trace (logger.js:169), while `api`/`apiResponse`/`apiError` (logger.js:177–236) and `initDone`/`initSummary` (logger.js:276–306) bypass `logWithColor` entirely with raw `console.group`/`console.log`/`console.error`. A sink wired to `logWithColor` would silently miss **all API errors, all init logs, and every stack trace**. The payload is **partial**: methods receive `(module, message, data/error)` plus a level string, but the timestamp is baked into a formatted `he-IL` string via `formatMessage`, and there is no single `record` object carrying `{level, module, message, error, timestamp, context}` together that a sink could consume.

- **(B) COVERAGE — does every error source flow through `logger`?** No. Of **510** classified error sources, **199** never reach `logger` today: **28 print only to `console`** (dark-console) and **171 are silently swallowed** (dark-swallowed). The biggest structural gaps are `useToast.showErrorWithDetails` — the *primary* user-facing error-surfacing path, which never calls `logger` at all — and the four bare `console.error` fallbacks in `globalErrorHandler.js`, the catch-all for every unhandled rejection and uncaught error. Because `handleGlobalError` delegates exclusively to `showErrorWithDetails`, **globally-caught Monday-API failures are shown to the user but invisible to any logger sink.**

Bottom line: even after wiring a sink, you would capture roughly **61%** of error sources (311/510). The remaining **~39%** need refactoring on both axes before "every error reaches the sink" is true.

---

## 2. Architecture Findings

The two architecture analyses (A and B) **agree on every material point**. Reconciliation:

### `hasSinkChokepoint`: **false** (both agree)
No function exists that every log call passes through. A sink would have to be attached in *at least* five places today (`logWithColor` + the four `console.group`/`console.log` bypass methods + the side `console.error` in `error`), or — better — behind one new `emit()` chokepoint.

### Per-method console exits (both analyses identical)

| Method | Exit | Lines | Funnels through `logWithColor`? |
|--------|------|-------|---------------------------------|
| `debug` | `logWithColor → console.log` | 132–137 | yes (DEBUG-gated) |
| `info` | `logWithColor → console.log` | 142–147 | yes (INFO-gated) |
| `warn` | `logWithColor → console.log` | 152–157 | yes (WARN-gated) |
| `error` | **mixed** | 162–172 | partial — `logWithColor` at :165 **plus a separate `console.error('Stack trace:', …)` at :169** |
| `api` | `console.group` | 177–187 | **no — bypasses** |
| `apiResponse` | `console.group` | 192–202 | **no — bypasses** |
| `apiError` | `console.group` | 213–236 | **no — bypasses; also has NO level gate (always fires)** |
| `functionStart` | `logWithColor → console.log` | 241–250 | yes (DEBUG-gated) |
| `functionEnd` | `logWithColor → console.log` | 255–264 | yes (DEBUG-gated) |
| `initDone` | `console.log` direct | 276–287 | **no — bypasses; always emits even in PROD** |
| `initSummary` | `console.log` direct | 293–306 | **no — bypasses; always emits even in PROD** |
| `setLevel` | `console.log` direct | 108–116 | n/a (breadcrumb, not an error path) |

**Key consequence:** the error-rendering path itself (`logger.error` → `logWithColor` line 97/99, plus the stack `console.error` at 169) is **dark-console** — it only writes to console; nothing forwards. A remote sink must be wired *inside* `emit`, not at any current exit.

### `structuredPayload`: **partial** (both agree)
`apiError`/`safeApi` do pass a rich context bag `{query, rawResponse, queryWarnings}`, and `createFullErrorObject` (errorHandler.js) builds a detailed error object. But at the would-be sink point there is **no uniform record**: `level`/`module`/`message` arrive pre-formatted into an `he-IL` localized string with freeform `data`, and the timestamp is a localized `toLocaleTimeString` string, not machine-parseable epoch/ISO. A sink today would receive "a formatted string + a loose data blob," not `{level, module, message, error, timestamp, context}`.

### Parallel bypass paths (dark relative to a logger sink)
Both analyses confirm these route around `logger`:

1. **`useToast.showErrorWithDetails`** (useToast.js:69–134) — the main user-facing error-surfacing path. Calls `parseMondayError` + `createFullErrorObject` + `showToast`, but **never imports or calls `logger`**. Confirmed: no `logger` import in the file.
2. **`globalErrorHandler.js:21–25`** — no handler set → bare `console.error('Global error (no handler set):', error)`.
3. **`globalErrorHandler.js:32–37`** — handler itself throws → bare `console.error('Error in global error handler:', …)` + `console.error('Original error:', …)`.
4. **`globalErrorHandler.js:97`** — generic `unhandledrejection` → bare `console.error('Unhandled promise rejection:', error)`.
5. **`globalErrorHandler.js:139`** — generic uncaught `error` → bare `console.error('Uncaught error:', error)`.
6. **`globalErrorHandler` Monday-API branches** route to `handleGlobalError → showErrorWithDetails`, which does not log — so unhandled Monday-API rejections/errors are surfaced to UI but bypass `logger` entirely.

`globalErrorHandler.js` imports **no `logger`** at all.

### Confirmed wrapper funnels (these DO reach `logger`)
Both analyses agree the wrapper layer is healthy:

- **`safeApi`** (mondayApi/client.js:234) — the **sole** live SDK wrapper. Logs on every failure path: `logger.apiError` on throw (:278), `logger.error('API', …)` on non-throwing GraphQL soft-errors (:256), `logger.warn` on retry (:270); also `logger.api` pre-call and `logger.apiResponse` post-call. **Every Monday API call routes through `safeApi`, so all API failures reach `logger`.**
- **`ErrorBoundary.componentDidCatch`** (ErrorBoundary.jsx:37–38) — `logger.error('ErrorBoundary', 'React error caught', error)` fires first, before `setState`/`onError`. Render-time React throws inside the boundary reach `logger`.
- **`validateQuery`** (client.js:59) — `logger.error('QueryValidation', …)` on suspicious query patterns; runs inside `safeApi`.

**Critical correction (both analyses):** `wrapMondayApiCall` was **deleted in Wave 4.1.5** (see comments at client.js:10, index.js:5, items.js:4). It is **no longer a funnel** — `safeApi` is the only live API wrapper. Any older reference to `wrapMondayApiCall` as a funnel is stale.

**Net:** API + React-render errors *would* reach a sink once `logger` forwards. The dark surface is everything that routes through `showErrorWithDetails` / `globalErrorHandler` / direct `console.*`, plus the swallowed soft-failures.

---

## 3. Coverage Stats

| Reachability | Count | Share |
|--------------|-------|-------|
| **reaches** (flows through `logger`) | **311** | 61.0% |
| **dark-console** (prints to `console` only) | **28** | 5.5% |
| **dark-swallowed** (no output at all) | **171** | 33.5% |
| **TOTAL error sources** | **510** | 100% |

**Total dark (would NOT reach a sink): 199 (39.0%).**

### Breakdown by category (dark rows)

The dark sources cluster by category and root cause as follows:

- **validation** — by far the largest dark bucket. Dominated by silent NaN/Invalid-Date coercion in date/time/duration utilities (`dateFormatters.js`, `durationUtils.js`, `dateFilterUtils.js`, `dateTimeHelpers.js`, `colorUtils.js`, `dashboardAggregation.js`) and pure builders that `throw` *before* the API wrapper (`columnValueBuilders.js`, `payloadGuard.js`, `mondayColumns.js`). Most are `dark-swallowed`; none of these utility modules import `logger`.
- **uncaught** — DOM event-listener / timer / observer callbacks outside React's render path (`DatePickerInput.jsx`, `useFocusTrap.js`, `useTokens.js`, `MobileResizeOverlay.jsx`, `useMultiSelect.js`, `UndoBanner.jsx`) and the empty-`catch(_){}` swallows for `sessionStorage` guards (`SettingsContext.jsx`) and haptics (`CustomEvent.jsx`, `MobileResizeOverlay.jsx`). Split between `dark-swallowed` and the `console`-only global handler fallbacks.
- **sdk** — the entire `ProjectColors` storage subsystem logs via `console.warn`/`console.log` only (`useAllBoardProjects.js`) → the bulk of the **28 dark-console** rows live here; plus `MondayContext.listen` and `holidayUtils` module-load (`dark-swallowed`).
- **api** — almost all `reaches` via `safeApi`; the few dark ones are inner per-column `JSON.parse` `catch{}` swallows (`MappingTab.jsx:309–315/322–329`, `items.js:194–203/522–530`) and the local duration-parse fallback (`useMonthlyHours.js:198–205`, `useDashboardData.js:247–255`).
- **render** — mostly `reaches` (render throws bubble to `ErrorBoundary`); dark ones are render math that yields NaN without throwing (`MonthlyBattery.jsx`, `dropdownAnchor.js`) and the `useSettingsValidation` consumers reachable from `App.jsx:39` **outside** the boundary.
- **network** — `lazyRetry` chunk handling reaches; the i18n `.init()` un-`.catch`'d promise (`i18n/index.js`) and the non-chunk resource-failure branch (`globalErrorHandler.js:45–56`) are dark.
- **uncaught (global)** — `globalErrorHandler.js` fallbacks are the highest-severity dark-console rows (severity high→critical).
- **race / uncaught (fire-and-forget)** — mostly `reaches` because the underlying hook self-logs; remaining dark ones are synchronous throws in non-async ops of `useCalendarSelection.js`.
- **test-utils** — multiple `dark-swallowed` rows, but **n/a severity**: never bundled in production.

---

## 4. Dark-Site Table

Every source that is **not** mapped to `logger` (dark-console + dark-swallowed), sorted by `severityIfDark` (critical → high → medium → low → n/a). Locations are abbreviated to file + line; all paths are under `/Users/ilaish/monday_app/apps/tracker/tracker`.

| Location | Operation | Category | Output today | Reachable? | Severity | Note |
|----------|-----------|----------|--------------|------------|----------|------|
| src/index.jsx:13 | `createRoot(getElementById('root'))` can throw before React mounts | render | console | dark-console | **critical** | Top-level throw before ErrorBoundary exists; window 'error' → `console.error` :139, never logger |
| globalErrorHandler.js:59–98 | `unhandledrejection`: non-Monday rejections | uncaught | console | dark-console | **critical** | Catch-all for generic async rejections → `console.error` :97; Monday branch → toast, no logger |
| globalErrorHandler.js:101–140 | window 'error': non-Monday uncaught errors | uncaught | console | dark-console | **critical** | Generic uncaught → `console.error` :139; Monday branch → toast, no logger |
| globalErrorHandler.js:21–25 | `handleGlobalError`: no handler registered yet | uncaught | console | dark-console | **high** | Early-init global error → bare `console.error`, never logger |
| globalErrorHandler.js:32–37 | `handleGlobalError`: the handler itself throws | uncaught | console | dark-console | **high** | Two bare `console.error` in catch, never logger |
| globalErrorHandler.js:20–37 | `handleGlobalError` success path → `showErrorWithDetails` only | uncaught | none | dark-swallowed | **high** | Matched/Monday errors go to UI toast; nothing calls logger |
| App.jsx:107–109 | `setGlobalErrorHandler(showErrorWithDetails)` wiring | uncaught | none | dark-swallowed | **high** (medium per A) | Registers a no-logger handler; globally-caught rejections reach UI but not logger |
| SettingsContext.jsx:251 | `JSON.parse(result.data.value)` of stored settings (no catch) | validation | none | dark-swallowed | **high** | Parse throw rejects loadSettings; lands in global handler → no logger; `setIsLoading` stuck true |
| MobileResizeOverlay.jsx:162–182 | `handleEnd` (native touchend listener) → `onCommit/onMove` persist | uncaught | none | dark-swallowed | **high** | Native window listener outside ErrorBoundary; no try/catch, no `.catch`; sync throw / rejected promise both dark |
| dateFormatters.js:11–16 | `toMondayDateFormat` UTC getters on null/Invalid Date | validation | none | dark-swallowed | **high** | TypeError on null; NaN string sent to Monday API; module has no logger |
| dateFormatters.js:23–28 | `toMondayTimeFormat` UTC getters | validation | none | dark-swallowed | **high** | Same — unguarded; feeds date+time write payloads |
| durationUtils.js:29–33 | `calculateDaysDiff` `getTime()` on null/Invalid Date | validation | none | dark-swallowed | **high** | TypeError / NaN day count into duration+save logic; no logger in module |
| columnValueBuilders.js:97–104 | `assertNoTranslatedLabels` throw before write | validation | none | dark-swallowed | **high** | Data-integrity guard fires pre-API (outside wrapper); emits nothing to logger |
| mondayColumns.js:184–218 | `buildColumnValues` throw on missing params / `format()` RangeError | validation | none | dark-swallowed | **high** | No logger; no production logging caller (shadowed by local copy in useMondayEvents) |
| payloadGuard.js:44–73 | `assertNoForbiddenStrings` throws on leaked translated string | validation | none | dark-swallowed | **high** | Throws with no logger; only test callers exist |
| SettingsWizard.jsx:59–68 | `updateSettings` returns false (storage write failed) | validation | logger | reaches* | **high** | *Marked reaches: the false originates from `updateSettings`' own logged catch; else-branch is toast-only |
| index.jsx:14 | `root.render(<App/>)` render-time errors | render | wrapper | reaches* | **high** | *Inside ErrorBoundary reaches; throws *above* the boundary fall to global handler `console.error` |
| useUndoDelete.js:39–66 / :61–66 | `commitDelete` outer/batch deletion failure | api | logger | reaches* | **high** | *`logger.error` :49/:63 — reaches; listed because of high severity |
| DashboardStats.jsx:19–21 | destructure `stats` with no null guard | render | wrapper | reaches | high | Render TypeError bubbles to ErrorBoundary → reaches (not dark) |
| DashboardFilterPanel.jsx:131 | `formatPeriodLabel` `format()` RangeError at render | render | wrapper | reaches | high | Render throw → ErrorBoundary → reaches (not dark) |
| MondayContext.jsx:151–153 | `useMondayContext` throws outside provider | uncaught | none | dark-swallowed | **high** | Top consumer (App.jsx:38) is *above* the logging boundary; throw unlogged |
| MondayContext.jsx:56–58 | `monday.get('context')` rejection | sdk | logger | reaches | high | `.catch → logger.error` — reaches (not dark) |
| columnValueBuilders.js:23–28 | `buildStatusColumnValue` throw on NaN/bad index | validation | none | dark-swallowed | medium | Pre-API write gate; no logger; caller-dependent |
| columnValueBuilders.js:42–44 | `buildEventTypeColumnValue` throw on invalid mapping | validation | none | dark-swallowed | medium | Same — outside `safeApi` scope |
| columnValueBuilders.js:51–55 | `buildEventTypeColumnValue` throw: category not in mapping | validation | none | dark-swallowed | medium | Same |
| columnValueBuilders.js:57–65 | `buildEventTypeColumnValue` throw: index mismatch | validation | none | dark-swallowed | medium | Same |
| items.js:194–203 | `findProjectLinkColumn` per-column `JSON.parse` `catch{continue}` | validation | swallowed-catch | dark-swallowed | medium | Empty catch; per-column parse failure silently skipped; can mask the only candidate |
| items.js:522–530 | `fetchActiveAssignments` `JSON.parse(typeCol.value)` `catch` (comment-only) | validation | swallowed-catch | dark-swallowed | medium | Malformed project-type silently → `projectType=null`; no logger |
| mondayColumns.js:124–174 | `mapItemToEvent` drops item when `startDate` null (returns null) | validation | none | dark-swallowed | medium | Silent drop; a sink never knows an item was omitted |
| mondayColumns.js:229–257 | `buildFetchEventsQuery` `format()` RangeError on Invalid Date | validation | none | dark-swallowed | medium | No try/catch, no logger; no production importer |
| dateFilterUtils.js:38–72 | `buildDateFilterRule` `new Date(...)` → `format()` RangeError | validation | none | dark-swallowed | medium | Unguarded; module has zero logger/console |
| dateFilterUtils.js:92–116 | `getEffectiveDateRange` same Invalid-Date risk | validation | none | dark-swallowed | medium | Same |
| dateFilterUtils.js:146–169 | `formatPeriodLabel` render-time `format()` RangeError | render | none | dark-swallowed | medium | Module never logs |
| dashboardAggregation.js:96–99 | `groupByGranularity` 'day' `format()` on Invalid Date | render | none | dark-swallowed | medium | Only `!date` guard; throws into Dashboard render uninstrumented |
| dashboardAggregation.js:287–332 | `aggregateAll` granularity loop `format()` / NaN keys | render | none | dark-swallowed | medium | Same; pure fn, no logger |
| durationUtils.js:43–48 | `calculateEndDateFromDays` Invalid Date / NaN shift | validation | none | dark-swallowed | medium | Silent Invalid Date into all-day end date |
| durationUtils.js:58 | `parseDuration` `parseFloat||0` masks garbage duration | validation | none | dark-swallowed | medium | Data-quality fail; no logger |
| durationUtils.js:89 | `formatDurationForSave` `toFixed(2)` on non-number | validation | none | dark-swallowed | medium | TypeError on save path; no logger in module |
| dateTimeHelpers.js:109–126 | `toMondayDateString/DateTimeString` return '' on Invalid Date | validation | none | dark-swallowed | medium | Empty value written to Monday date column silently |
| editLockUtils.js:58–62 | `isEventLocked` NaN daysDiff → silent unlock | validation | none | dark-swallowed | medium | Lock bypass on edit-guard path; no logger |
| holidayUtils.js:11 | `Location.lookup('Jerusalem')` at module load | sdk | none | dark-swallowed | medium | Module-init throw aborts eval; logger imported but not called here |
| holidayUtils.js (useIsraeliHolidays.js:71) | `fetchIsraeliHolidays` sync throw in useCallback | uncaught | none | dark-swallowed | medium | No try/catch; throw propagates un-logged within hook |
| i18n/index.js:19–30 | `i18next.init()` promise never awaited / no `.catch` | sdk | none | dark-swallowed | medium | Init rejection → global handler `console.error`, never logger |
| useToast.js:69–134 | `showErrorWithDetails`: `parseMondayError`/`createFullErrorObject` throw | uncaught | none | dark-swallowed | medium | Central surfacing path; no logger import; original + formatting error both dark |
| useMondayEvents.js:671–673 | `createEvent` soft early-return on falsy API item | validation | none | dark-swallowed | medium | Created-but-empty response → silent null; catch only fires on throw |
| useAllBoardProjects.js:32/33 | `loadFromStorage` getItem/`JSON.parse` failure | sdk/validation | console | dark-console | medium | `console.warn` only; cache load failure invisible to logger |
| useAllBoardProjects.js:100–104/:101 | assignments-mode missing board/column early-return | validation | console | dark-console | medium | `console.warn` + `setProjects([])`; no logger |
| useAllDayEvents.js:118–121 | invalid `allDayTypeIndex`/typeName early-return | validation | none | dark-swallowed | medium | Toast only, no logger; surrounding catch not reached |
| useAllDayEvents.js:211–212 | `report.startTime/endTime` `split(':').map(Number)` NaN | validation | none | dark-swallowed | medium | NaN→`setHours`→Invalid Date silently corrupts event times |
| useApproval.js:61–64 | `updateApprovalStatus` missing config returns false | validation | none | dark-swallowed | medium | Silent no-op; false counted as "failed" but nothing logged |
| useApproval.js:106–108 | `approveMultiple` no `approvedIdx` returns `{0,0}` | validation | none | dark-swallowed | medium | Silent bulk-approve no-op (unlike :85 which logs) |
| useCalendarSelection.js:85–97 | `handleDeleteSelected` sync throw in non-async ops | uncaught | none | dark-swallowed | medium | No try/catch; sync throw → window.onerror → no logger (refetch async self-logs) |
| useCalendarSelection.js:112–121 | `handleContextMenuDelete` sync throw | uncaught | none | dark-swallowed | medium | Same pattern; sync path dark |
| MondayContext.jsx:61 | `monday.listen('context', cb)` no error handling | sdk | swallowed-catch | dark-swallowed | medium | Listen/callback throw emits nothing to logger |
| EventModal.jsx:321–428 | `handleCreate` async onClick → `onCreate/onUpdate/onConvert` | uncaught | none | dark-swallowed | medium | No try/catch; throw/reject not caught by ErrorBoundary; nothing logs here |
| DatePickerInput.jsx:127 | `format(date,…)` RangeError at render | render | wrapper | reaches | medium | Bubbles to ErrorBoundary → reaches (not dark) |
| DatePickerInput.jsx:76–111 | `MutationObserver` callback DOM mutation | uncaught | none | dark-swallowed | medium | Microtask outside React; ErrorBoundary can't catch; no logger |
| settingsValidator (various) | board/column existence checks | api | wrapper | reaches | medium | safeApi + local catch log — reaches (not dark) |
| globalErrorHandler.js:45–56 | resource (SCRIPT/LINK/IMG) load failure, non-chunk branch | network | none | dark-swallowed | medium | If `handleGlobalChunkError` returns false, nothing logged here |
| dashboardAggregation.js (other) | week-branch / hours NaN, bar consolidation | render/validation | none | dark-swallowed | low | NaN keys/totals render silently; no logger |
| MondayCalendar.jsx:1061–1119 | `handleStartTimeChange/EndTimeChange/DateChange` NaN time/date parse | validation | none | dark-swallowed | low | `split(':').map(Number)` NaN → Invalid Date into pendingSlot; no logger |
| MondayCalendar.jsx:369–385 | lazy modal preload `import()` fire-and-forget | network | none | dark-swallowed | low | Only `logger.debug` success; chunk reject uncaught at this site |
| MondayCalendar.jsx:252–264 | `scrollToEight` rAF DOM query | render | none | dark-swallowed | low | Throw inside rAF/timeout callback, no logger |
| App.jsx:61–89 | theme apply effect (`matchMedia`/`setAttribute`) | render | none | dark-swallowed | low | Effect-phase throw not reliably caught; no logger |
| AllDayEventModal.jsx:136–148/591–603/625–726/739–758 | `parseTime`/duration/`handleCreate` NaN shaping + Enter dispatch | validation/uncaught | none | dark-swallowed | low | In-component NaN/undefined shaping silent; only downstream persistence logs |
| CalendarToolbar.jsx:57–65 | click-outside `mousedown` listener | render | none | dark-swallowed | low | Throw → global showErrorWithDetails, no logger |
| ConfirmDialog.jsx:53–55 | `onClick={onConfirm}` sync throw | uncaught | none | dark-swallowed | low | No try/catch at presentational layer |
| CustomEvent.jsx:138 | `navigator.vibrate?.(15)` in `catch(_){/*ignore*/}` | uncaught | swallowed-catch | dark-swallowed | low | Comment-only empty catch; cosmetic haptic |
| MobileResizeOverlay.jsx:175 | `navigator.vibrate?.(10)` empty catch | uncaught | swallowed-catch | dark-swallowed | low | Same |
| MobileResizeOverlay.jsx:63–81/120–160 | `computeRect`/`handleMove` native touch listeners | render | none | dark-swallowed | low | Divide-by-zero NaN / listener throw; no logger |
| DatePickerInput.jsx:28–46/57–66/122–125 | scroll/resize/mousedown/today listeners | uncaught | none | dark-swallowed | low | Uncaught DOM listener exceptions; no logger |
| DashboardFilterPanel.jsx:150/155 | `onDateFromChange/onDateToChange` `format()` in event handler | validation | none | dark-swallowed | low | Event-handler throw not caught by ErrorBoundary; no logger |
| DashboardPieCharts.jsx:157–161 | Recharts Pie `onClick` handler | uncaught | none | dark-swallowed | low | Defensive, but throw in event handler dark |
| DashboardToolbar.jsx:23–56 | button `onClick` callbacks | uncaught | none | dark-swallowed | low | Parent-callback throw uncaught; no logger |
| ErrorDetailsModal.jsx:34–43/45–59 | clipboard `writeText` `catch → console.error` | uncaught | console | dark-console | low | No logger import; copy failure invisible to sink |
| ErrorToast.jsx:19–31 | clipboard `writeText` `catch → console.error` | uncaught | console | dark-console | low | No logger import |
| EventModal.jsx:832–845 | manager approve/reject inline `onClick` | uncaught | none | dark-swallowed | low | Sync throw not caught; no logger |
| FilterBar.jsx:73–90 | `toggleReporter/Project` `parseInt` NaN to parent | validation | none | dark-swallowed | low | NaN to callback; no logger |
| StructureTab.jsx:26–103 | field-config / toggle event handlers | validation | none | dark-swallowed | low | Event-handler throws not caught by boundary; no logger |
| MultiSelect.jsx / SearchableSelect.jsx:17–21 | dropdown position in scroll/resize listeners + effect | render | none | dark-swallowed | low | Listener/effect throws not caught; no logger |
| useSettingsValidation.js:78–84/175–180/184–192/203–228 | `computeSettingsErrors` render-time validation | validation | none | dark-swallowed | low | Consumed at App.jsx:39 *outside* the boundary → throw unlogged |
| settingsErrorMeta.js:48–128 | pure error-key mapping helpers | validation | none | dark-swallowed | low | `Object.keys(errors)` TypeError if null; no logger, App-level path uncovered |
| AdditionalTab.jsx:575–580 | `editLockDays` `parseInt`/`isNaN` early-return | validation | none | dark-swallowed | low | Silent bad-keystroke ignore; no logger |
| CalendarTab.jsx:13/33–35/145–179 | dayLabels index, weekStart/hours-target `parseInt`/`parseFloat||0` | validation/render | none | dark-swallowed | low | Soft typo→0 target silently; no logger |
| MappingTab.jsx:309–315/322–329 | per-column `JSON.parse` `catch → false` | validation | swallowed-catch | dark-swallowed | low | Column silently dropped from picker; inner catch never logs |
| MappingTab.jsx:544–558/758–780 | mapping-object rebuild handlers | validation | none | dark-swallowed | low | Soft mutate; event-handler throw not caught; no logger |
| SettingsDialog.jsx:230–232 | `reader.onerror` → `showErrorWithDetails` only | uncaught | none | dark-swallowed | low | Async FileReader error → toast-only, no logger |
| SettingsDialog.jsx:397–398 | footer `new Date(...).toLocale*` Invalid Date | render | none | dark-swallowed | low | 'Invalid Date' text, no throw, no logger (cosmetic) |
| ProjectColorsTab / useAllBoardProjects breadcrumbs | `console.warn`/`console.log` storage subsystem | sdk | console | dark-console | low | Multiple console-only rows (save failure :44/:45, skip-fetch :162, breadcrumbs) |
| useAllBoardProjects.js:75 | `await loadFromStorage` | network | console | dark-console | low | Inner `console.warn` only |
| useAllDayEvents.js:222–223 | `parseFloat(report.hours)||0` NaN→0 | validation | none | dark-swallowed | low | Zero-length event silently; no logger |
| useCalendarFilter.js:49–54 | `parseInt(id)` NaN into GraphQL filter | validation | none | dark-swallowed | low | Wrong/empty filter; downstream query failure logged elsewhere |
| useCalendarHandlers.js:57–77 | `onDragStart` RAF + mouseup/touchend listeners | uncaught | none | dark-swallowed | low | Listener/RAF throw → window.onerror → no logger |
| useCalendarSelection.js:100–109 | `handleEventContextMenu` field reads | render | none | dark-swallowed | low | Sync handler throw → no logger |
| useDashboardData.js:233–235/247–255 | item date `isNaN` drop / duration `JSON.parse` `catch` fallback | validation | none/swallowed-catch | dark-swallowed | low | Silent item drop / `parseFloat` recovery; no logger (outer catch reaches separately) |
| useFocusTrap.js:28–38/40–67/75–77 | focus timer / keydown / cleanup `.focus()` | uncaught | none | dark-swallowed | low | Timer/listener/detached-node throws; no logger in file |
| useTokens.js:54–64/69–77 | `getComputedStyle` read / MutationObserver callback | render/uncaught | none | dark-swallowed | low | No logger; observer throw → global console.error |
| useMondayEvents.js:75–79 | `monday.listen('filter', cb)` failure path | sdk | none | dark-swallowed | low | Only `logger.debug` success; registration/callback failure dark |
| useMultiSelect.js:19–51 | global keydown/keyup/blur listeners | uncaught | none | dark-swallowed | low | Sync listener throw → global console.error, not logger |
| useProjects.js:28–36/38–40/239–243/310–314 | `readCache`/`writeCache` empty catches, `JSON.parse` skip, eager-merge effect | validation/render | swallowed-catch/none | dark-swallowed | low | Empty `catch{}` / comment-only; cache+parse failures silent |
| useToast.js:33 | `showToast` id gen + setState | render | none | dark-swallowed | low | No logger import; marginal source |
| useMonthlyHours.js:198–205 | duration `JSON.parse` `catch` → `parseFloat||0` (no log) | validation | swallowed-catch | dark-swallowed | low | Silent 0-hours; sibling event-type catch *does* log |
| SettingsContext.jsx:213–217/303/315/324 | `sessionStorage` guard read/write/remove empty `catch(_)` | uncaught | swallowed-catch | dark-swallowed | low | Comment-only empty catches; nothing emitted |
| SettingsContext.jsx:337–340 | fire-and-forget `loadSettings()` (the :251 parse path) | race | none | dark-swallowed | low | Only un-logged rejection is the :251 parse throw → global handler, no logger |
| SettingsContext.jsx:475–477 | `useSettings()` throws outside provider | uncaught | none | dark-swallowed | low | No logger at throw site; depends on a boundary that may log |
| approvalMapping.js:73–78/130/136–148/168 | validator/transform null-returns + unguarded field access throw | validation | none | dark-swallowed | low | Pure helpers; no logger; throw on null label element |
| colorUtils.js:13–15/43–58/270–282 | `parseInt`(hex) NaN → wrong/`#NaN…` color | validation | none | dark-swallowed | low | NaN propagates into styling silently; no logger in file |
| errorHandler.js:229–244/254–388 | `extractOperationName` regex / `parseMondayError` field access | validation | none | dark-swallowed | low | Defensive; if it throws, module never logs (no logger import) |
| eventTypeMapping.js:66–69/403–413 | `getCategory`/resolvers soft-null; per-label skip in `createLegacyMapping` | validation | none | dark-swallowed | low | Per-label skips silent; logger only fires post-loop on aggregate |
| dropdownAnchor.js:50–52/61–76 | missing/malformed `triggerRect` → default/NaN px | render | none | dark-swallowed | low | Soft-degrade; no logger/console in module |
| mondayColumns.js:72 | `parse()` Invalid Date returned (non-throwing) | validation | none | dark-swallowed | low | NaN-date returned as-is; catch only fires on JSON.parse throw |
| items.js:21–25 | `parseTimeString` `split(':').map(Number)` NaN | validation | none | dark-swallowed | low | Invalid Date silently returned; no logger |
| logger.js:97/99 | `logWithColor` `console.log` (terminal output of all leveled logs) | uncaught | console | dark-console | low | Logger internals on the error-render path; **a sink must be wired here / in emit** |
| MonthlyBattery.jsx:17/36–50 | `Math.round`/segment width divide-by-zero NaN at render | render | none | dark-swallowed | low | NaN%/Infinity% rendered silently; no logger |
| TimeSelect.jsx:94–118/126–173 | `validateAndRoundTime` / blur-revert silent soft-fail | validation | none | dark-swallowed | low | Reverts silently; no logger |
| TaskSelect.jsx:52,91 | `setTimeout(...focus())` | uncaught | none | dark-swallowed | low | Effectively can't throw; hypothetical throw → global console.error |
| UndoBanner.jsx:25–27 | `setTimeout(() => onUndo())` | uncaught | none | dark-swallowed | low | Timer throw outside React; ErrorBoundary can't catch; no local logger |
| calendarConfig.jsx:84–87 | `generateTimeOptions15Minutes` `split(':').map(Number)` NaN | validation | none | dark-swallowed | low | Silent empty/wrong array; benign at module load |
| ErrorBoundary.jsx:16–25 | `fallback()` i18next `t()` `catch` → hardcoded Hebrew | validation | swallowed-catch | dark-swallowed | low | Comment-only catch; i18next failure never recorded |
| index.jsx:11 | `setupGlobalErrorHandlers()` at startup | uncaught | none | dark-swallowed | low | Throw during registration → before handlers wired → nothing routes |
| MondayContext.jsx:44–54 | `handleContext` benign `!res?.data` early-return | sdk | none | dark-swallowed | low | Benign null-context skip emits nothing |
| ContextMenu/index.js, CustomEvent/index.js | pure re-export barrels | render | none | dark-swallowed | n/a | No failure path; listed for completeness |
| test-utils/* (apiPayloadCapture, mondayMock, renderCalendar, renderHookWithProviders, renderWithProviders) | mock api / harness throws / `JSON.stringify` | api/sdk/validation/render | none | dark-swallowed | n/a | **Test-only — never bundled in production**; rejections go to Vitest |
| featureFlags.js:13–18, graphqlUtils.js:12–20, xorValidation.js | pure guarded config/string/validation helpers | validation | none | dark-swallowed | n/a | No realistic failure source; nothing to emit |

> Note: a handful of rows above are labeled **reaches** (DashboardStats, DatePickerInput:127, MondayContext:56, SettingsWizard:59–68, index.jsx:14, useUndoDelete) — they are included only because of their **high severity**, to make clear they are already covered via `ErrorBoundary`/`safeApi`/local `logger.error` and are *not* part of the dark gap.

---

## 5. Refactor Plan

Two workstreams, ordered by impact. **Architecture first** (so a sink can attach at all), then **coverage** (so everything flows into it). Within each, highest-leverage steps first.

### Workstream A — make `logger` sink-ready (architecture)

1. **Introduce one private `emit(record)` chokepoint** that every public method funnels through. Define the record as:
   `{ level, module, message, error: {name, message, stack, errorCode, statusCode, requestId, response}, data, context: {query, variables, rawResponse, queryWarnings, duration, functionName}, timestamp: <epoch ms / ISO> }`.
   Move all console formatting (`formatMessage`/`logWithColor`/`console.group`) *inside* `emit`; methods only build the record. **This is the single highest-impact change** — without it there is nothing for a sink to attach to.

2. **Refactor the bypassers through `emit`.** Fold `logger.error`'s side `console.error('Stack trace', …)` (:169) into `record.error.stack`; reshape `api`/`apiResponse`/`apiError` (:177–236, drop the 7-way `console.error` spray) and `initDone`/`initSummary` (:276–306) to build a record and call `emit`. Today a sink wired to `logWithColor` would miss exactly these — API errors, init, and stack traces.

3. **Add a sink registry:** `logger.addSink(fn)` / `logger.removeSink(fn)`. `emit` renders to console **and** fans the record to every registered sink. Wrap each sink dispatch in its own `try/catch` so a failing sink (network down) never throws back into app code or recurses into `logger`.

4. **Decouple sink forwarding from the console level gate.** Keep `currentLevel` gating *console* output, but forward WARN/ERROR/apiError to sinks regardless of PROD console suppression — otherwise PROD `console=ERROR` starves a telemetry sink of warn/info breadcrumbs.

5. **Add a bounded ring buffer (last ~100–200 records) + `flush()`.** Buffer *before* any sink is registered so early-init failures (Init steps, bundle-load, the :251 parse) are not lost; flush to the first sink on registration, on error, and on `visibilitychange='hidden'`/`beforeunload` via `navigator.sendBeacon` to survive page teardown.

6. **Add `AbortError` / chunk-load filtering at `emit` time.** Drop or downgrade `AbortError`, navigation aborts, and benign `handleGlobalChunkError` reloads *before* forwarding to a remote sink (noise + cost).

7. **Add a PII-redaction pass in `emit`** over `record.data`/`context`/`error.response`: scrub API tokens/signing secrets, GraphQL `variables`, people-column values, reporter user ids/emails, `account_id`, and free-text notes before any *remote* forward. The console sink can keep full detail in dev.

8. **Standardize the record shape from `createFullErrorObject` (errorHandler.js)** so `safeApi`'s `MondayApiError` and `ErrorBoundary`'s parsed object feed the same structured record. Normalize the timestamp to epoch/ISO; keep the localized `he-IL` string only for console rendering.

### Workstream B — close the coverage gap (199 dark sources)

9. **Route `showErrorWithDetails` through `logger`** (useToast.js:69–134). Have it call `logger.error`/`logger.apiError` with the parsed `fullErrorObject` before/after showing the toast. This is the **single biggest coverage win**: it is the main surfacing path *and* the global handler's delegate, so closing it also captures every globally-caught Monday-API failure.

10. **Replace the four bare `console.error` fallbacks in `globalErrorHandler.js`** (:21–25, :32–37, :97, :139) with `logger.error`, and add a `logger` import to the file. Have `handleGlobalError` itself call `logger.error` (not only delegate to `showErrorWithDetails`). These are the **critical/high** dark-console rows — the catch-all for every unhandled rejection and uncaught error.

11. **Fix the catch-less `JSON.parse` in `SettingsContext.jsx:251`** (and the fire-and-forget at :337–340): wrap in try/catch → `logger.error`, and ensure `setIsLoading(false)` runs so the loader isn't stuck. High severity, currently fully dark.

12. **Instrument the date/duration utility modules** that have *no* logger import and silently produce NaN/Invalid Date feeding Monday writes: `dateFormatters.js` (:11–28), `durationUtils.js` (:29–89), `dateFilterUtils.js`, `dateTimeHelpers.js`, `mondayColumns.js`, `dashboardAggregation.js`. Either log on the bad-value branch or `throw` and ensure a logging caller. Prioritize the **high-severity write-path** ones (`dateFormatters`, `durationUtils`, `mondayColumns.buildColumnValues`).

13. **Migrate the `ProjectColors` subsystem + clipboard catches from `console.*` to `logger.*`:** `useAllBoardProjects.js` (storage warn/breadcrumbs — the bulk of the 28 dark-console rows), `ProjectColorsContext`, `projectColorsStorage`, `ProjectColorsTab`, plus `ErrorDetailsModal.jsx`/`ErrorToast.jsx` clipboard `catch`.

14. **Eliminate silent swallows** — convert empty/comment-only `catch(_){}` and silent early-returns to at least a `logger.debug`/`warn` breadcrumb where a genuine failure is being absorbed: the per-column `JSON.parse` catches (`MappingTab.jsx:309–329`, `items.js:194–203/:522–530`), `useApproval.js` misconfig no-ops (:61–64/:106–108), `useAllDayEvents.js:118–121/:211–212`, `useMonthlyHours.js:198–205`, `useProjects.js` cache catches. Keep deliberately-benign ones (haptics, sessionStorage guards) but mark them explicitly.

15. **Cover the event-handler / listener / observer paths that React's `ErrorBoundary` cannot catch** (`DatePickerInput` observer/listeners, `MobileResizeOverlay` native touch listeners, `useFocusTrap`, `useTokens`, `useMultiSelect`, `useCalendarSelection` sync ops). Wrap their bodies in `try/catch → logger.error`, since today they surface only to `window.onerror` → `console.error`. Prioritize the **high-severity** `MobileResizeOverlay.jsx:162–182` (persist-on-resize).

16. **Re-home the validation consumers that run outside the boundary** (`useSettingsValidation`/`settingsErrorMeta` reachable from `App.jsx:39`): either wrap `AppContent`'s body in a boundary or guard+log the validation call so a throw isn't an unlogged app crash.

17. **Skip test-utils** (`apiPayloadCapture`, `mondayMock`, `renderCalendar`, `renderHookWithProviders`, `renderWithProviders`) — confirmed test-only, never bundled in production; their rejections correctly go to the Vitest runner.

**Expected outcome:** Steps 1–8 make the sink attachable to a uniform structured record. Steps 9–11 alone convert the highest-impact dark surface (the global handler + the main toast path + the stuck-loader parse). Steps 12–16 close the long tail. After all of it, "every production error source reaches the sink" becomes true.
