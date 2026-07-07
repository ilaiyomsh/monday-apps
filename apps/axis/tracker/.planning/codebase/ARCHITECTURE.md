# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** React Component with Hooks, Context-based Global State, Monday.com API Layer

**Key Characteristics:**
- React 18 with Vite bundler
- react-big-calendar for calendar UI with drag-and-drop support
- Custom React Context (`SettingsContext`) for global configuration
- Monday SDK integration via GraphQL API
- Modular hooks system for business logic isolation
- Centralized error handling and logging
- Hebrew (RTL) interface with localization support

## Layers

**Presentation Layer (React Components):**
- Purpose: User interface rendering and interaction handling
- Location: `src/components/`, `src/MondayCalendar.jsx`
- Contains: Modal components, event displays, forms, dialogs
- Depends on: Hooks, Context, Utilities
- Used by: React DOM rendering

**Business Logic Layer (Custom Hooks):**
- Purpose: Event CRUD operations, data fetching, state management
- Location: `src/hooks/`
- Key hooks: `useMondayEvents`, `useProjects`, `useTasks`, `useToast`, `useEventModals`, `useCalendarHandlers`, `useEventDataLoader`
- Depends on: API Layer, Context, Utilities
- Used by: Components for data and state operations

**Global State Layer (React Context):**
- Purpose: Centralized application settings, persistent configuration
- Location: `src/contexts/SettingsContext.jsx`
- Contains: Structure modes, column IDs, board configuration, settings persistence via Monday Storage
- Accessed by: All components and hooks via `useSettings()` hook
- State persisted to: `monday.storage.instance`

**API Layer (Monday GraphQL Integration):**
- Purpose: All communication with Monday.com API, GraphQL queries/mutations
- Location: `src/utils/mondayApi.js`
- Contains: Query builders, item CRUD, board fetching, column operations, pagination
- Error handling: Wrapped in `MondayApiError` with context tracking
- Logging: All API calls logged via `logger` utility

**Utilities Layer:**
- Purpose: Shared functions, type conversions, error handling, logging
- Location: `src/utils/`
- Key files: `logger.js`, `errorHandler.js`, `durationUtils.js`, `mondayColumns.js`, `dateFormatters.js`
- Focused: No external dependencies, pure functions

**Constants Layer:**
- Purpose: Configuration, calendar setup, holidays
- Location: `src/constants/`
- Contains: Calendar localizer, time formats, Hebrew holiday dates

## Data Flow

**Event Creation Flow:**

1. User clicks calendar slot → `useEventModals.openEventModal()` triggered
2. Modal renders (`EventModal.jsx`) with empty form
3. User selects project/task/stage from dropdowns (via `useProjects`, `useTasks`, `useStageOptions`)
4. User submits form → `onCreate()` handler calls `useMondayEvents.createEvent()`
5. `createEvent()` → calls `createBoardItem()` in `mondayApi.js`
6. API returns new item ID → event added to local state via `addEvent()`
7. Toast notification shown via `useToast.showSuccess()`
8. Modal closes, calendar reloads range

**Event Update Flow:**

1. User clicks event → `useEventModals.openEventModalForEdit()` triggered
2. `useEventDataLoader.loadEventDataForEdit()` fetches full item data from Monday
3. Modal renders with pre-filled data (`eventToEdit`)
4. User modifies form → on submit calls `useMondayEvents.updateEvent()`
5. `updateEvent()` → calls `updateItemColumnValues()` in `mondayApi.js`
6. Local state updated, calendar re-renders
7. Success message shown

**Drag/Resize Flow:**

1. User drags event → react-big-calendar triggers `onEventDrop()` or `onEventResize()`
2. `useCalendarHandlers.onEventDrop()` validates move (all-day to all-day, timed to timed)
3. Calls `useMondayEvents.updateEventPosition(event, newStart, newEnd)`
4. `updateEventPosition()` → calls `updateItemColumnValues()` with new dates
5. Optimistic update: local state changed before API response
6. If API fails, error shown and event reverts

**Settings Save Flow:**

1. User opens Settings Dialog
2. `SettingsContext.updateSettings()` called with new values
3. Settings merged with existing state
4. Persisted to Monday storage via `monday.storage.instance.setItem()`
5. All components re-render with new settings via Context

**State Management:**

- **Global State:** `SettingsContext` - persisted settings, column IDs, board IDs
- **Component Local:** `MondayCalendar` component holds modal state, event list, visible date range
- **Hook State:** Each hook manages its own data (projects, tasks, toasts, modals)
- **Calendar Events:** Loaded into memory, rendered by react-big-calendar
- **No Redux/Zustand:** Context + hooks sufficient for this app's complexity

## Key Abstractions

**CalendarEvent:**
- Purpose: Unified event representation across timed and all-day events
- Examples: `src/hooks/useMondayEvents.js`, `src/utils/mondayColumns.js`
- Pattern: Polymorphic duration handling - `duration` is hours for timed events, days for all-day events
- Fields: `id`, `title`, `start`, `end`, `allDay`, `eventType`, `projectId`, `taskId`, `notes`, `durationDays`

**Structure Modes (STRUCTURE_MODES):**
- Purpose: Support multiple board hierarchy configurations
- Location: `src/contexts/SettingsContext.jsx`
- Options: `PROJECT_ONLY`, `PROJECT_WITH_STAGE`, `PROJECT_WITH_TASKS`
- Impact: Determines which fields render in modals, which columns are required in settings

**Event Type Categories:**
- Purpose: Distinguish between timed (שעתי) and all-day (יומי) events
- File: `src/utils/durationUtils.js`
- All-day types: `חופשה` (vacation), `מחלה` (sick), `מילואים` (reserves)
- Timed: Default work hour reports
- Impact: Duration unit (hours vs days), modal appearance, date calculations

**Monday Columns Mapping:**
- Purpose: Abstract Monday column configuration from business logic
- File: `src/utils/mondayColumns.js`
- Pattern: Settings store column IDs, utilities parse column values
- Mapping: `dateColumnId`, `durationColumnId`, `projectColumnId`, `taskColumnId`, `reporterColumnId`, `eventTypeStatusColumnId`, `nonBillableStatusColumnId`, `stageColumnId`, `notesColumnId`

## Entry Points

**Application Root:**
- Location: `src/index.jsx`
- Triggers: React DOM render, Monday SDK initialization
- Responsibilities: Mount root component, setup global error handlers

**App Component:**
- Location: `src/App.jsx`
- Triggers: After index.jsx mounts
- Responsibilities: Wrap app in SettingsProvider, manage settings dialog state, mount MondayCalendar, setup global error handler

**MondayCalendar Component:**
- Location: `src/MondayCalendar.jsx` (1551 lines - main view)
- Triggers: After App renders
- Responsibilities: Calendar UI rendering, event handlers, modal coordination, hooks orchestration

**Event Creation:**
- Timed: `EventModal.jsx` → `useMondayEvents.createEvent()`
- All-day: `AllDayEventModal.jsx` → `useMondayEvents.createEvent()`

**Event Editing:**
- Timed: `EventModal.jsx` + `useEventDataLoader` → `useMondayEvents.updateEvent()`
- All-day: `AllDayEventModal.jsx` → `useMondayEvents.updateEvent()`

## Error Handling

**Strategy:** Centralized error parsing with user-friendly Hebrew messages

**Patterns:**

1. **API Layer Errors** (`src/utils/mondayApi.js`):
   - All API calls wrapped in `wrapMondayApiCall()` function
   - Errors converted to `MondayApiError` with full context
   - Contains: response, apiRequest, errorCode, functionName, duration

2. **Error Parsing** (`src/utils/errorHandler.js`):
   - `parseMondayError()` extracts error details from GraphQL/HTTP responses
   - `ERROR_MESSAGES` maps error codes to Hebrew user messages
   - Returns: userMessage, errorCode, canRetry, actionRequired, fullDetails

3. **Global Error Handler** (`src/utils/globalErrorHandler.js`):
   - Catches unhandled errors and promise rejections
   - Calls `showErrorWithDetails()` to display error modal with details
   - Error details modal copyable as JSON

4. **Component Error Boundary** (`src/components/ErrorBoundary/ErrorBoundary.jsx`):
   - Catches rendering errors in React component tree
   - Displays fallback UI with error details

5. **Toast System** (`src/hooks/useToast.js`):
   - `showErrorWithDetails(error, context)` displays error toast + details modal
   - `showError(message)` simple error notification
   - `showWarning(message)`, `showSuccess(message)` for other states

## Cross-Cutting Concerns

**Logging:**
- Tool: Custom `logger` utility in `src/utils/logger.js`
- Pattern: Functional approach - `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
- Special: `logger.api()`, `logger.apiResponse()`, `logger.apiError()` for API tracing
- Control: Production shows ERROR only, development shows all levels
- Dynamic: `window.enableDebugLogs()` in console enables full logs in production

**Validation:**
- Settings validation: `src/utils/settingsValidator.js` - checks required column IDs
- Event data validation: Done in modals before submission
- Monday API validation: Automatic via schema (API returns errors for invalid data)

**Authentication:**
- Handled by Monday SDK via embedded view
- Current user fetched via Monday API: `query { me { name } }`
- Context provides boardId, userId
- Column filters based on "assigned_to_me" using people columns

**Date/Time Handling:**
- Library: `date-fns` for manipulation
- Localization: Custom Hebrew messages for react-big-calendar
- Time format: 24-hour (00:00 to 23:59)
- Timezone: Local (user's browser)
- Special: All-day events use inclusive start, exclusive end

---

*Architecture analysis: 2026-01-25*
