# Tracker — Architecture

A React 19 / Vite 7 **Custom Object** work-hours calendar for monday.com. Users report timed and all-day work hours on a monday board, with filtering, multi-select, drag-and-drop, manager approval workflows, an analytics dashboard, and a first-install setup wizard. The UI is bilingual (Hebrew primary, English fallback) and RTL-aware, built on `@vibe/core`, `react-big-calendar`, `recharts`, and `i18next`.

## 1. Overview

- **Stack:** React 19, Vite 7, `monday-sdk-js`, `@vibe/core`, `react-big-calendar` (with drag-drop addon), `recharts`, `i18next` / `react-i18next`, `date-fns`, `lucide-react`.
- **State:** React Context only — no Redux/Zustand. Three providers: `MondayContext`, `SettingsContext`, `ProjectColorsContext`.
- **Persistence:** both settings and project colors live in **global** `monday.storage` (account/app scope, NOT monday's instance storage), namespaced by key: `customSettings_${instanceId}` and `projectColors_${instanceId}` respectively.
- **API:** Every GraphQL call routes through a single funnel, `safeApi()` in `src/utils/mondayApi/client.js`. Components/hooks import from the barrel `src/utils/mondayApi`, never from the SDK directly.
- **Errors/logging:** All errors converge at `logger.emit()`; one error produces one log record, one toast, and (on request) one details modal.
- **Layout:** ~30 component folders / 102 files following a folder-per-component convention; logic lives in 35+ custom hooks. Heavy modals and the Dashboard are lazy-loaded.

## 2. Startup & bootstrap flow

Entry is `src/index.jsx`, which runs setup synchronously, then mounts `App.jsx`:

```
index.jsx
  ├─ import init.js              (polyfill: window.global = window)
  ├─ import i18n/index.js        (i18next init: he/en, fallbackLng='he')
  ├─ setupGlobalErrorHandlers()  (window error / unhandledrejection / resource-load)
  ├─ Vibe tokens + global CSS
  └─ createRoot(...).render(<App/>)
```

Provider mount order and their async effects:

```
App.jsx (creates mondaySdk() instance at top level)
  └─ ErrorBoundary            (no context deps — catches provider startup errors)
     └─ MondayProvider        useEffect: monday.get('context') + monday.listen,
        │                      5s watchdog fallback; polls currentUser if missing
        └─ SettingsProvider    useEffect: awaits context.instanceId, loadSettings()
           │                   with 5s timeout, retries once on network failure,
           │                   runs migrations
           └─ ProjectColorsProvider  useEffect: loads colors for instanceId
              └─ AppContent     consumes all three contexts, renders view + surfaces
```

Worst-case blocking startup is ~5s (settings) + 5s (watchdog); typically < 500ms. `SettingsProvider` and `ProjectColorsProvider` are **siblings**, so one can fail without breaking the other. `ErrorBoundary` sits outside all providers intentionally.

`AppContent` responsibilities (in `App.jsx`):
- `useLanguageSync()` + `useLocale()` resolve `{dir, language}` and apply to `document.documentElement`.
- Theme resolution: `themeMode` (settings) + monday theme + `prefers-color-scheme` matchMedia fallback → `data-theme`. Mobile is always `light`.
- First-install detection: `isFirstInstall = !customSettings?.lastModifiedAt`; if true and not mobile, auto-opens `SettingsWizard` once (`autoOpenedRef` guard).
- Renders a **global error surface** (`ToastContainer` + `ErrorDetailsModal`) in *all* branches (loading / loadError / normal) so toasts queued during load still display.

## 3. State management & contexts

| Context | File | Shape / responsibility |
|---|---|---|
| `MondayContext` | `src/contexts/MondayContext.jsx` | `{ context, isMobile, currentUser{id,name}, language, dir, locale, weekStartDay, timeFormat }`. Loads SDK context once via `monday.get`/`listen` with 5s watchdog. Language resolved here from `user.currentLanguage` (settings not yet loaded — intentionally empty). |
| `SettingsContext` | `src/contexts/SettingsContext.jsx` | Holds `customSettings` (200+ keys). Exposes `updateSettings`, `resetSettings`, `reloadSettings`, `isLoading`, `loadError`. Loads/persists to **global** `monday.storage` under `customSettings_${instanceId}` (account/app scope, key-namespaced — not instance storage). Runs migrations. |
| `ProjectColorsContext` | `src/contexts/ProjectColorsContext.jsx` | `projectId → hex` map in **global** `monday.storage` keyed by `projectColors_${instanceId}` (same scope as settings). Debounced (300ms) merge of new IDs with auto-generated `stringToColor` hashes; ignores already-mapped IDs. |

**Settings persistence details:** `instanceId = context.instanceId || context.boardId || 'default'`. `loadSettings()` fires only after context is available (avoids SDK race). On timeout/`success:false`, `handleNetworkFailure` triggers one silent reload (sessionStorage `RELOAD_GUARD_KEY`), then shows `NetworkErrorScreen` on a second failure.

**Migrations** (run on load): `productsBoardId → tasksBoardId`; text-based `eventTypeMapping` → cleared (re-migrate on next dialog save); legacy `useStageField` stripped; `fieldConfig` auto-generated from `structureMode`.

**Language split (known gotcha):** `MondayContext.language` reflects monday context only and is wrong after a `languageOverride`. The authoritative language is resolved in `AppContent` via `useLanguageSync` / `useLocale`.

## 4. Component tree

Folder-per-component convention: `src/components/ComponentName/{ComponentName.jsx, ComponentName.module.css, index.js}`. Lazy-loaded items marked `(lazy)`.

```
App (ErrorBoundary → MondayProvider → SettingsProvider → ProjectColorsProvider)
└─ AppContent
   ├─ if isLoading/loadError → StopwatchLoader | NetworkErrorScreen
   ├─ SettingsWizard (lazy)        first install: Welcome → Questions → PortfolioPick → Install
   ├─ SettingsDialog (lazy)        tabs: Structure | Mapping | Additional | Calendar
   ├─ ProjectColorsDialog (lazy)
   ├─ main view:
   │  ├─ MondayCalendar  (react-big-calendar DnDCalendar)
   │  │  ├─ CalendarToolbar           (rbc toolbar slot)
   │  │  │  ├─ FilterBar               (reporters + projects dropdown)
   │  │  │  └─ MonthlyBattery          (desktop)
   │  │  ├─ CustomEvent                (per-event renderer: badges, status, lock)
   │  │  ├─ EventModal (lazy)          timed create/edit/convert
   │  │  │  ├─ TimeSelect  ├─ TaskSelect  ├─ DatePickerInput
   │  │  ├─ AllDayEventModal (lazy)     vacation/sick/reserves, days-based
   │  │  ├─ SelectionActionBar (lazy)   multi-select: duplicate/delete/clear
   │  │  ├─ ApprovalActionBar (lazy)    approve/reject selected
   │  │  ├─ ContextMenu (lazy)          right-click delete/duplicate
   │  │  ├─ MobileResizeOverlay         mobile long-press resize
   │  │  └─ UndoBanner                  undo-delete (auto-dismiss)
   │  └─ Dashboard (lazy)
   │     ├─ DashboardToolbar            range picker, granularity, Excel export
   │     ├─ DashboardFilterPanel        SearchableSelect: reporters/projects/customers
   │     ├─ DashboardStats              summary cards
   │     ├─ DashboardBarChart           hours by day/week/month
   │     ├─ DashboardEmployeeChart      by reporter
   │     └─ DashboardPieCharts          billable + internal/external
   └─ global surfaces: ToastContainer, ErrorDetailsModal, SettingsValidationDialog
```

**Conventions:** CSS Modules everywhere (`import styles from './X.module.css'`). Modals follow `if (!isOpen) return null`. Lazy modals use `React.lazy` + `Suspense fallback={null}` and are preloaded on `requestIdleCallback` after the first events load. `@vibe/core` + `lucide-react` only — no Material-UI/Chakra. All text via `i18next` (`useStableT()` memoized `t`).

## 5. Hooks & data-flow graph

`MondayCalendar.jsx` calls the master aggregator `useMondayCalendarHooks({ monday, context, customSettings, t, isMobile, calendarDate, calendarView, setCalendarDate, currentViewRange })`, which composes eight hooks. Full dependency graph:

```
                         customSettings + context
                                  │
                  ┌───────────────┴────────────────┐
                  ▼                                 ▼
        useCalendarFilter ──filterRules──►  useMondayEvents (core CRUD)
        (reporter/project)                   events[], loadEvents(start,end,rules),
                  │                          create/update/delete/updateEventPosition,
                  │                          addEvent, resolve/removePending,
                  │                          removeEventsFromState, restoreEvents
                  │                                 │ events[]
                  │                ┌────────────────┼───────────────────┐
                  ▼                ▼                ▼                   ▼
        useMonthlyHours    useCalendarSelection   useApproval      useCelebration
        breakdown[],        multiSelect (CTRL) +   approveEvent/    captureBefore →
        targetHours         approvalSelection +    reject/Multiple/ checkCelebration
        (view-aware)        contextMenu + handlers AllPending/      (confetti + toast)
                  ▲                │                Selected           ▲
                  └── refetch ─────┘                │                  │
                                                    ▼                  │
                        useEventSelection ──selectedEventIds──────────►│
                                                                       │
        useUndoState ─► useUndoDelete (4s window, 5/batch)             │
        useCalendarSwipe (mobile, RTL, 22% threshold)                  │
                                                                       │
   Error path:  safeApi/catch ─► logger.error (__loggedId dedup)       │
                 │                                                     │
                 ▼                                                     │
        useUiErrorSink ─► parseMondayError ─► createFullErrorObject ─► useToast.showToast
                                                                       (→ ToastContainer)
```

Selected critical dependencies: `loadEvents ← filterRules`; `approveMultiple ← approvalSelection + currentViewRange + filterRules`; `useDashboardData ← customSettings + currentViewRange`; `useMonthlyHours ← customSettings + currentViewRange + calendarView`; `useCalendarSelection ← events + createEvent + removeEventsFromState + undoDelete + monthlyHours.refetch`.

Hook groups (35+ in `src/hooks/`):
- **Core events:** `useMondayEvents`, `useAllDayEvents`, `useApproval`.
- **Filter/selection:** `useCalendarFilter`, `useEventSelection` (approval), `useMultiSelect` (CTRL dup/delete), `useCalendarSelection` (aggregates both + context menu).
- **Modals/UI:** `useEventModals`, `useEventDataLoader`, `useDragToDismiss` (mobile, 120px), `useFocusTrap`.
- **Summaries:** `useMonthlyHours`, `useDashboardData`, `useCelebration`.
- **Projects/tasks:** `useProjects`, `useAllBoardProjects`, `useTasks`, `useTasksMultiple`, `useColumnOptions` (base) → `useStageOptions`, `useNonBillableOptions`, `useFilterOptions`.
- **Locale/time & read-only overlays:** `useLocale`, `useLanguageSync`, `useDayOffAbsences` (Day-off vacations-board absence overlay, W4.1; wired into `MondayCalendar` with parallel `isDayOff` guards, W4.2 — see §7 "Absence source"), `useTokens`.
- **Interaction:** `useCalendarHandlers` (drag/resize/drop, min 15 min), `useCalendarSwipe`, `useBoardOwner`.
- **Errors/undo:** `useToast`, `useUiErrorSink`, `useUndoDelete`, `useUndoState`.

**Caching tiers:** `useProjects` → `sessionStorage` (30 min, keyed by settings signature); `useAllBoardProjects` → global `monday.storage` (keyed by instanceId); `useDashboardData` → 10-entry in-memory LRU + `AbortController`. Race guards via refs: `fetchIdRef`, `loadingRef`, `customFilterRulesRef`.

## 6. monday API layer

Single-funnel pattern. Decomposed modules under `src/utils/mondayApi/`, all re-exported via the barrel `index.js`:

| Module | Contents |
|---|---|
| `client.js` | `safeApi()`, `executeWithRetry()`, `MondayApiError`, query validation, retry/backoff |
| `items.js` | `createBoardItem`, `deleteItem`, `updateItemColumnValues`, `fetchItemById`, `fetchAllBoardItems`, `fetchEventsFromBoard`, `fetchActiveAssignments`, `fetchItemsStatus`, `fetchItemsLinkedIds`, `parseTimeString` |
| `boards.js` | `fetchConnectedBoardsFromColumn`, `fetchUniquePeopleFromBoard` |
| `columns.js` | `fetchColumnSettings`, `fetchStatusColumnSettings`, `parseStatusLabels`, `createColumn`, `createEventTypeStatusColumn`, `createBoardWithColumns` |
| `mirror.js` | `resolveMirrorSourceColumn` |
| `assertGraphQL.js` | `assertNoGraphQLErrors()` |

**`safeApi(monday, callerName, query, options = {})`:**
- Validates the query (suspicious patterns: undefined ids, empty arrays, null values), logs every path (`logger.apiResponse`/`logger.apiError`).
- Runs `executeWithRetry`. Retryable on code (`complexitybudgetexhausted`, `rate_limit_exceeded`, `internalservererror`, …), status (`429/500/502/503`), or message regex (rate limit, resource locked, network error, load failed). `MAX_RETRIES = 2`; delay = `extensions.retry_in_seconds` or `2^attempt` seconds.
- Returns the **raw response** (callers unwrap `res.data?.…`). Does **not** throw on GraphQL soft errors (HTTP 200 with `response.errors`) — only logs ERROR once and stamps `__softErrorLoggedId`. Throws `MondayApiError` only on hard/network errors after retries exhaust.

**Write path** uses `assertNoGraphQLErrors(response, { functionName, query, variables })` immediately after `safeApi` (e.g. `items.js`). It throws `MondayApiError` (inheriting `__softErrorLoggedId` for dedup) when `response.errors` is non-empty — turning silent write failures into real errors. Read-only queries are *not* asserted (soft errors render gracefully).

**GraphQL conventions:** Read and write the `settings` field (JSON string *or* parsed object — handle both); never use the deprecated `settings_str`. Mutations escape input via `escapeGraphQLString`; `column_values` is `JSON.stringify`-ed (double-stringified for the API quirk). `wrapMondayApiCall` was removed (Wave 4.1.5); `safeApi` is the only live wrapper, and all 27 fetcher/mutation calls migrated to it.

**`MondayApiError` shape:** `{ message, response, apiRequest: { query, variables, operationName }, errorCode, functionName, duration }`.

**Hook error pattern** (e.g. `useMondayEvents.js`): `catch` → roll back UI state → single `logger.error('hook.method', 'message', error)` → `setError('Hebrew message')` → `throw` to caller. Never double-log; never silent catch.

## 7. Domain logic

### Event types — `src/utils/eventTypeMapping.js`
`EVENT_CATEGORIES = { BILLABLE, NON_BILLABLE, ALL_DAY, INTERNAL_PROJECT, EXTERNAL_PROJECT, ROUTINE }`. Event type is stored as a **label index (string)** on `eventTypeStatusColumnId`, not text (survives label renames).

- **Timed (שעתי):** duration in hours (decimal). Normal mode → `billable` (1 index) | `nonBillable` (0+). Distinction mode → `internalProject` (1) | `externalProject` (1) | `routine` (0+).
- **All-day (יומי):** duration in days (int, min 1); sub-types (חופשה/מחלה/מילואים) stored on `allDayTypeStatusColumnId`. Exactly 1 all-day index in both modes.
- **Temporary (זמני):** flagged via `temporaryCheckboxColumnId` (boolean) — not part of the mapping.

Central dispatcher: `resolveTimedEventIndex({ isBillable, project, mapping, enableDistinction })`. With distinction off → `getTimedEventIndex(isBillable)`. With distinction on → `project.projectType ∈ {internal|external}` → `getInternalProjectIndex`/`getExternalProjectIndex`; non-billable → first routine index. **Returns `null` if mapping missing / no match — callers must guard.** Validation: `validateMapping()` (normal) vs `validateMappingDistinction()` (distinction) enforce single-use categories; helpers include `isProjectIndex`, `isAllDayIndex`, `getLabelText/Color`, `smartValidateMapping`, `isLegacyMapping`.

### Structure modes
`PROJECT_ONLY`, `PROJECT_WITH_STAGE`, `PROJECT_WITH_TASKS`, `PROJECT_WITH_TASKS_AND_STAGE`. Settings stores `fieldConfig = { task, stage, notes, billableToggle, nonBillableType, … }`; `getRequiredSettings(fieldConfig, useAssignmentsMode, projectsSourceMode)` computes which columns/boards are mandatory per mode.

### Board resolution — `src/utils/boardIdResolver.js`
`getEffectiveBoardId(customSettings, context)` three-tier fallback: `useCurrentBoardForReporting && context.boardId` → `timeReportingBoardId` → `context.boardId` (null in Custom Object mode). Helpers: `hasValidReportingBoard()`, `isCustomObjectMode()`. **No board IDs are ever hardcoded.**

### Portfolio mode — `src/utils/portfolioResolver.js`
When `projectsSourceMode === 'portfolio'`, `connectedBoardId` is the Portfolio board. There is **no global `tasksBoardId`**: `resolveTasksBoardId(monday, projectItemId)` queries the `portfolio_project_link` board_relation, reads `linked_items[0].board.id`, and caches it in-memory. `clearTasksBoardCache()` must be called when settings/portfolio structure change. `tasksProjectColumnId` is fixed to `portfolio_project_link`; `peopleColumnIds` defaults to `['portfolio_project_owner']`. `isPortfolioBoard(monday, boardId)` validates a candidate board.

### Duration — `src/utils/durationUtils.js`
Polymorphic: `parseDuration(value, eventTypeIndex, mapping)` → `{ value, unit: 'hours'|'days' }` based on `isAllDayEventType`. `formatDurationForSave` → `toFixed(2)` (hours) or rounded int (days). `calculateEndDateFromDays(start, days)` returns an **exclusive** midnight end (react-big-calendar all-day semantics); `calculateDaysDiff` uses `Math.ceil`, min 1 (DST-safe).

### Validation — `src/utils/settingsValidator.js`
`validateSettings(monday, customSettings, currentBoardId)` → `{ isValid, errors, warnings, missingSettings, missingColumns, missingBoards }`. Verifies required boards exist (skips `tasksBoardId` in portfolio mode) and that required columns exist on the reporting board (always: date/end-time/duration/project/reporter/temporary-checkbox; **all-day-type only when `absenceSource !== 'dayoff'`** — Day-off integration W4.5; conditionally per `fieldConfig`: task/stage/notes/non-billable/event-type). When `absenceSource === 'dayoff'`, the Day-off vacations-board mapping becomes required and is validated instead: `dayOffBoardId` existence + person/startDate/endDate/kind/type column existence **on the vacations board** + kind general/personal label IDs (+ approval column and approved/pending label-ID sets when `dayOffApprovalRequired`). Warns if `eventTypeStatusColumnId` is set without a mapping. Soft-fails (no exception) when `monday` is null. All six event-type labels (`['חופשה','מחלה','מילואים','שעתי','לא לחיוב','זמני']`) are required.

### Absence source (Day-off integration, W4.5 settings foundation + W4.1 overlay hook)
`absenceSource: 'tracker' | 'dayoff'` (default `'tracker'` — preserves all current behavior) selects where absences live: the legacy in-tracker all-day flow, or the Day-off vacations board (read-only overlay, source of truth per `../Day-off/CONTRACT.md`). Companion keys (all in `DEFAULT_SETTINGS`, merge-on-load back-compat): `showAbsences` (overlay display toggle, D10), `dayOffApprovalRequired` (tracker's own approval policy per D2 — when ON, pending absences render hollow and the approval mapping is required), `dayOffAppUrl` (optional deep-link to the Day-off component opened by the W4.4 absence-report button; http(s) only, never validator-required), and the manual board mapping per D9: `dayOffBoardId`, `dayOffPersonColumnId`, `dayOffStartDateColumnId`, `dayOffEndDateColumnId`, `dayOffKindColumnId` + `dayOffKindGeneralLabelId`/`dayOffKindPersonalLabelId`, `dayOffTypeColumnId`, `dayOffApprovalColumnId` + `dayOffApprovedLabelIds`/`dayOffPendingLabelIds`/`dayOffRejectedLabelIds` (rejected set is optional, W4.1 — items carrying those labels are excluded silently under an approval-required policy; an approval label matching **none** of the three sets is excluded with one aggregated loud error per load, per `CONTRACT.md` §1 rule 3). Label values are **stable monday label IDs** (never text). The mapping surface is a dedicated "absences" accordion in `MappingTab` (dialog-side validation in `useSettingsValidation` + routing in `settingsErrorMeta`, both active only when `absenceSource === 'dayoff'`).

**The overlay loader is `src/hooks/useDayOffAbsences.js` (W4.1):** `loadAbsences(start, end)` activates only when `showAbsences` is on AND the full mapping is present (mirror of the validator's required set; partial mapping → one warn, overlay stays inert — the loud surface for misconfiguration is the validator when `absenceSource==='dayoff'`). It fetches the vacations board through `safeApi` with **two** `items_page` queries merged client-side with dedupe by item id (the flat AND rule builder can't express person-OR-general): `startDate between [windowStart−366d, windowEnd]` AND (`person any_of [assigned_to_me]` | `kind any_of [generalLabelId]`), then applies a client-side inclusive overlap filter (lexicographic day keys) — the sanctioned widened-window path from `CONTRACT.md` §6.1 (coverage cap: absences longer than 366 days). Each item maps to **one multi-day all-day event** `{id: 'dayoff_'+itemId, allDay, isDayOff, readOnly, start=startDate, end=endDate+1d (exclusive), title/color from the type label (label-ID keyed), dayOffKind, isPending/isApproved per D2}` — no per-day expansion (`CONTRACT.md` §6.5). Kind resolves by label ID with the normative person-presence fallback (+aggregated drift warn). Every load **replaces** the window's data (hard-deleted cancellations vanish on re-read, `CONTRACT.md` §7).

**Calendar wiring (W4.2):** `MondayCalendar.jsx` calls `loadAbsences(start, end)` from three places — `handleRangeChange`, the initial-window load effect (react-big-calendar fires `onRangeChange` only on navigate/view-change, never on mount — without this the overlay would appear only after the first navigation), and a settings-change refetch effect keyed on every `dayOff*` mapping key + `showAbsences` + the approval policy keys. The absences merge into `enrichedEvents` as a **separate overlay** appended after the regular events, gated by `customSettings.showAbsences !== false` for instant hide on toggle-off. (The automatic Israeli-holidays layer — `useIsraeliHolidays`/`@hebcal/core`, `showHolidays` — was removed entirely in change #86, 2026-06-11: holidays now appear only as Day-off company-wide absences.) **`isDayOff` read-only guards** sit at every behavioral touchpoint: `handleEventClick`, `handleEventLongPress` (mobile), `draggableAccessor`/`resizableAccessor`, the all-day update/delete wrappers (defense-in-depth — the modal can never open for a day-off event), `useCalendarSelection.handleEventContextMenu`, `useApproval.approveAllPending` (a pending day-off absence is never bulk-approved into the reporting board's approval column), and `useCelebration`'s timed-hours counter. The day-off events deliberately do NOT pass through the regular-event enrichment (no lock/selection/context-menu injection).

**Visuals (W4.3):** `CustomEvent.jsx` renders day-off events with a `gc-event-dayoff` class (default cursor, no hover affordance, hidden dnd anchors — defense-in-depth, the W4.2 accessors already return false), colored by the absence **type label** (`eventTypeColor` — the live `label_style.color` read at fetch time by W4.1). Per D2: when the consumer's `dayOffApprovalRequired` policy is ON, a **pending** absence renders **hollow** (`gc-event-dayoff-pending` — transparent background, 2px colored border, colored text via the proven `--event-color` inline-variable pattern shared with `gc-event-temporary`) instead of the generic pending `opacity 0.5` (suppressed for day-off only); **approved** — and everything when the policy is OFF (the hook then sets no approval flags) — renders filled. CSS lives in `src/styles/calendar/components/events.css`, direction-neutral (RTL-safe) and view-agnostic (month/week/day); the 3-class pending selector deliberately outranks `.gc-event-wrapper.gc-event-allday`'s `!important` border/shadow.

**Entry redirect (W4.4, decision D5; reworked in change #85, 2026-06-11):** when `absenceSource === 'dayoff'`, `AllDayEventModal`'s vacation-type menu (the `allDayTypeStatusColumnId` label buttons) is replaced by a two-button menu — the bulk-reports button on top (unchanged, incl. its future-date notice branch and the mobile hide) and an "absence report" button below (he+en, `allDayModal.dayoffButton`/`dayoffButtonNoUrl`) that opens the Day-off component via `window.open(url, '_blank', 'noopener,noreferrer')`. The button is enabled only when the additive setting `dayOffAppUrl` (manually configured in the MappingTab absences accordion, default `''`) holds an http(s) URL; otherwise it renders disabled with a minimal inline explanation (non-http(s) values are treated as unset — same safety gate as before). Edit-mode delete/approve/reject survive untouched. The `useColumnOptions` fetch of the type labels is skipped under `'dayoff'` (hidden menu ⇒ no query; the column may legitimately be unmapped per W4.5). Defense-in-depth write gates in `useAllDayEvents.js`: `createSingleAllDayEvent` and `handleUpdateAllDayEvent` warn + return when `absenceSource === 'dayoff'` (`createMultipleReports` deliberately not gated). Default `'tracker'` keeps every current path byte-identical.

**SettingsWizard (W4.6, decision D3 untouched):** `SettingsWizard/useBoardBuilder.js` creates the Time Logs **All-day Type** sub-type status column conditionally — only when absences are internal (`absenceSource === 'tracker'` or unset); when external (`'dayoff'`) the column is skipped in **both** flows (full board build + portfolio) with a visible progress-log line, and the produced settings carry `allDayTypeStatusColumnId: null` (legal under `'dayoff'` per the W4.5 validator relaxation). `SettingsWizard.jsx` feeds `absenceSource` from the **existing** settings (`useSettings().customSettings`, default `'tracker'`) into `builder.build()` — it is not a wizard question; since `updateSettings` merges, a wizard re-run under `'dayoff'` preserves the `dayOff*` mapping. MonthlyBattery (`useMonthlyHours`) is deliberately untouched per frozen decision D3 — once absences stop landing on Time Logs the battery naturally measures worked hours only (comms item at cutover).

### Calendar config — `src/constants/calendarConfig.jsx`
View factories `createWorkWeekView(workDays, weekStartDay, culture)`, `createThreeDayView(culture)`; `roundToNearest15Minutes()`; `timeOptions15Minutes`, `durationOptions15Minutes`; `CALENDAR_DEFAULTS`; `formats` for the localizer. Work week is Sunday–Thursday.

## 8. Error handling & logging pipeline

All errors converge at `logger.emit()` (`src/utils/logger.js`) → ring buffer (size 150) → fan-out to sinks.

```
 (1) try/catch in API/components ─► showErrorWithDetails / logger.error / logger.apiError
 (2) window.onerror / unhandledrejection ─► globalErrorHandler.handleGlobalError ─► logger.error
 (3) React render throw ─► ErrorBoundary.componentDidCatch ─► logger.error('ErrorBoundary')
        │
        ▼
   logger.emit(record)
     ├─ normalize timestamp
     ├─ log-once: if object already has __loggedId → mark duplicate; else stamp __loggedId + correlationId
     ├─ renderToConsole(record)        (prod: ERROR-only; window.enableDebugLogs() to widen)
     ├─ pushToBuffer(record)           (ring buffer, FIFO, 150)
     └─ if !duplicate → dispatchToSinks(record)   (try/catch per sink)
        │
        ▼
   useUiErrorSink  (registered via addSink; replays ≤5 ERROR records on mount)
     ├─ filter level==='ERROR'; SKIP module==='ErrorBoundary'  (fallback UI is sole display)
     ├─ inSinkRef loop-guard
     ├─ parseMondayError → createFullErrorObject
     └─ showToast(userMessage, 'error', AUTO_CLOSE_MS=6000, details)
        └─ useToast: client-side fingerprint dedup (DEDUP_WINDOW_MS=2000) → ToastContainer
                                                          └─ onShowDetails → ErrorDetailsModal
```

- **Net result:** one error = one log record = one sink dispatch = one toast (+ optional modal). Two orthogonal dedups: `__loggedId` (log-once) and toast fingerprint (2s).
- **`errorHandler.js`** (`parseMondayError`, `createFullErrorObject`, `extractOperationName`) maps monday error codes / HTTP statuses to a Hebrew `ERROR_MESSAGES` dict (`userMessage`, `canRetry`, `actionRequired`); fallback `אירעה שגיאה לא צפויה`. `HTTP_STATUS_TO_ERROR_CODE` maps 400/401/403/429/500/502/503/504.
- **`globalErrorHandler.js`** also handles **chunk-load** failures via `lazyRetry` (one-time refresh, downgraded to warn, no toast) and calls `event.preventDefault()` so no unhandled rejection reaches the browser console.
- **`ErrorBoundary`** distinguishes chunk-load (refresh UI) from render bugs (retry UI + optional details modal via `onError`); never propagates; hides stack traces from the user (stack lives only in the modal).
- **`ErrorDetailsModal`** shows three tabs (error / api / json) with copy-to-clipboard.
- **`showErrorWithDetails`** (in `useToast`) is a log-only facade: it logs only if `error.__loggedId` is unset (ownership belongs to the catch closest to source), then the UI sink renders the toast. Do **not** add an adjacent `logger.error` — that double-displays.
- **ESLint contract:** `no-console: error`; every `catch` must call `logger.*` / `throw` / `showErrorWithDetails` (no silent or empty catches; only allowed silent path is `if (e.name === 'AbortError') return;`); `logger.js` and tests are exempt.

## 9. Key conventions & gotchas

1. **Single API funnel:** never call the SDK directly; import from `src/utils/mondayApi` (barrel), not from `client.js`.
2. **`safeApi` doesn't throw on soft errors** — write paths must call `assertNoGraphQLErrors`; reads tolerate soft errors.
3. **`settings` not `settings_str`** in all GraphQL; parse defensively (string or object).
4. **No hardcoded board IDs** — always `getEffectiveBoardId(customSettings, context)`.
5. **Event type = label index string**, never text. `resolveTimedEventIndex` can return `null` — guard it.
6. **Language split:** `MondayContext.language` is stale after override; trust `useLocale`/`useLanguageSync`.
7. **Two distinct multi-selects:** `useEventSelection` (approval) vs `useMultiSelect` (CTRL dup/delete) — unified only in `useCalendarSelection`.
8. **Approval enabled iff** `enableApproval && approvalStatusColumnId && mapping`; transitions are manager-only.
9. **All-day end dates are exclusive** (midnight boundary) for react-big-calendar; monday date columns expect **UTC**.
10. **Portfolio cache is in-memory only** — invalidate via `clearTasksBoardCache()` on settings change.
11. **Lazy modals use `fallback={null}`** (no spinner); preloaded on idle after first events load.
12. **Global error surface renders in every branch** so toasts queued during load/error still appear.
13. **Task creation is 3-step** (create → fetch existing → update with all IDs).
14. **Undo-delete:** 4s window, batches of 5, commits on unmount.
15. **Pagination cursors live ~60s;** `CursorException` triggers a one-shot full-fetch retry (`useMonthlyHours`).
16. **No `console.log`** — `logger.*` only; production logs ERROR only (widen with `window.enableDebugLogs()`).
17. **Tests:** Vitest + jsdom, colocated `__tests__/` (e.g. `FilterBar/__tests__/`, `components/__tests__/HebrewSnapshots.test.jsx`).

## 10. File map

| Path | Role |
|---|---|
| `src/index.jsx` | Entry: i18n, global error handlers, Vibe tokens, mounts `App` |
| `src/init.js` | `window.global = window` polyfill |
| `src/App.jsx` | Provider tree + `AppContent` (view switch, theme/lang, global surfaces) |
| `src/MondayCalendar.jsx` | Main calendar view; DnDCalendar + modals + toolbars + overlays |
| `src/contexts/MondayContext.jsx` | SDK context, isMobile, language/dir/locale |
| `src/contexts/SettingsContext.jsx` | `customSettings` load/persist/migrate |
| `src/contexts/ProjectColorsContext.jsx` | project→color map (debounced, persisted) |
| `src/i18n/index.js` | i18next init, `resolveLanguage` |
| `src/hooks/useMondayCalendarHooks.js` | Master aggregator (8 hooks) |
| `src/hooks/useMondayEvents.js` | Core event CRUD + pagination |
| `src/hooks/useAllDayEvents.js` | All-day create/update |
| `src/hooks/useApproval.js` | Manager approval workflow |
| `src/hooks/useCalendarFilter.js` | Reporter/project filter → GraphQL rules |
| `src/hooks/useCalendarSelection.js` | Unified select + context menu |
| `src/hooks/useEventSelection.js` / `useMultiSelect.js` | Approval vs CTRL selection |
| `src/hooks/useEventModals.js` / `useEventDataLoader.js` | Modal state + lazy edit-data load |
| `src/hooks/useMonthlyHours.js` / `useDashboardData.js` | Summaries (LRU/abort) |
| `src/hooks/useProjects.js` / `useAllBoardProjects.js` | Projects (cached) |
| `src/hooks/useTasks.js` / `useTasksMultiple.js` | Tasks per project |
| `src/hooks/useColumnOptions.js` / `useStageOptions.js` / `useNonBillableOptions.js` / `useFilterOptions.js` | Status/dropdown loaders |
| `src/hooks/useCalendarHandlers.js` / `useCalendarSwipe.js` / `useDragToDismiss.js` / `useFocusTrap.js` | Interaction/gesture |
| `src/hooks/useLocale.js` / `useLanguageSync.js` / `useTokens.js` | Locale/theme |
| `src/hooks/useDayOffAbsences.js` | Read-only absence overlay loader from the Day-off vacations board (W4.1) |
| `src/hooks/useToast.js` / `useUiErrorSink.js` / `useUndoDelete.js` / `useUndoState.js` / `useCelebration.js` / `useBoardOwner.js` | Toast/undo/misc |
| `src/utils/mondayApi/client.js` | `safeApi`, retry, `MondayApiError` |
| `src/utils/mondayApi/items.js` `boards.js` `columns.js` `mirror.js` | Fetchers/mutators |
| `src/utils/mondayApi/assertGraphQL.js` | `assertNoGraphQLErrors` |
| `src/utils/mondayApi/index.js` | Barrel export |
| `src/utils/logger.js` | `emit()` convergence, ring buffer, sinks |
| `src/utils/errorHandler.js` | `parseMondayError`, `createFullErrorObject` |
| `src/utils/globalErrorHandler.js` | Global trap + chunk-retry |
| `src/utils/eventTypeMapping.js` | Event-type catalog + `resolveTimedEventIndex` |
| `src/utils/eventTypeValidation.js` | Legacy validation, `parseStatusColumnLabels` |
| `src/utils/durationUtils.js` | Polymorphic duration parse/format |
| `src/utils/boardIdResolver.js` | `getEffectiveBoardId` |
| `src/utils/portfolioResolver.js` | Portfolio board resolution (cached) |
| `src/utils/settingsValidator.js` | `validateSettings`, `getRequiredSettings` |
| `src/constants/calendarConfig.jsx` | View factories, formats, defaults |
| `src/components/CalendarToolbar.jsx` | rbc toolbar slot |
| `src/components/FilterBar/` | Reporter/project filter dropdown |
| `src/components/EventModal/` | Timed event modal |
| `src/components/AllDayEventModal/` | All-day event modal |
| `src/components/SettingsDialog/` (+ Structure/Mapping/Additional/CalendarTab) | Settings form |
| `src/components/SettingsWizard/` (+ steps/) | First-install wizard |
| `src/components/Dashboard/` (+ Toolbar/FilterPanel/Stats/BarChart/EmployeeChart/PieCharts) | Analytics view |
| `src/components/SelectionActionBar/` `ApprovalActionBar/` `ContextMenu/` | Action surfaces |
| `src/components/CustomEvent/` `MobileResizeOverlay/` `UndoBanner/` `MonthlyBattery/` | Calendar UI |
| `src/components/TimeSelect/` `TaskSelect/` `DatePickerInput/` `ConfirmDialog/` `ProjectColorsDialog/` | Inputs/dialogs |
| `src/components/ErrorBoundary/` `ErrorDetailsModal/` `Toast/` `SettingsValidationDialog/` `StopwatchLoader/` `NetworkErrorScreen.jsx` | Error/status surfaces |
| `src/styles/calendar/index.css` | react-big-calendar overrides |
