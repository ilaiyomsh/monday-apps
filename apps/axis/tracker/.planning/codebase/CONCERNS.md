# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

**UTC vs Local Time Inconsistency:**
- Issue: Mixed use of UTC and local time formatting without clear boundaries. `toMondayDateFormat()` uses UTC (`getUTCFullYear`, `getUTCMonth`) while `toLocalDateFormat()` uses local time (`getFullYear`, `getMonth`), but the distinction and correct usage in all code paths is unclear.
- Files: `src/utils/dateFormatters.js`, `src/MondayCalendar.jsx`, `src/hooks/useMondayEvents.js`, `src/utils/mondayColumns.js`
- Impact: Potential date misalignment between UI display and Monday API submissions, especially for users in non-UTC timezones. Events may appear on wrong dates or times in calendars.
- Fix approach: Audit all date handling paths to ensure: (1) Monday API calls consistently use UTC, (2) UI display always uses local time, (3) create conversion utilities with explicit timezone handling, add test cases for different timezones.

**Typo in Column ID Extraction:**
- Issue: `src/utils/mondayColumns.js` line 30 checks for `settings.daurtion` instead of `duration`. This typo will cause duration columns to fail silently.
- Files: `src/utils/mondayColumns.js:30`
- Impact: Duration values from Monday board won't be parsed. Events will lose duration information, breaking the core feature of time tracking.
- Fix approach: Fix typo to `settings.duration`. Add validation to catch missing required column mappings and show user-friendly error messages instead of silent failures.

**No Optimistic UI Updates with Rollback:**
- Issue: While state updates are optimistic (e.g., `setEvents(prev => [...prev, newEvent])` before API call), there is no explicit rollback mechanism if the API call fails. State is restored with saved previous state, but this creates brief inconsistency windows.
- Files: `src/hooks/useMondayEvents.js:460`, `src/hooks/useMondayEvents.js:493-532`, `src/hooks/useMondayEvents.js:555-563`, `src/hooks/useMondayEvents.js:587-648`
- Impact: If network fails after optimistic update but before rollback, user may see events that weren't actually saved. Multi-user scenarios could show stale data.
- Fix approach: Add transaction IDs to track pending operations, implement explicit rollback state with user notification, add retry mechanisms for failed operations.

**Missing Settings Validation on Every Render:**
- Issue: Settings are validated on mount via `SettingsValidationDialog`, but changes to settings don't re-trigger validation. A user could change column mappings and continue using invalid settings.
- Files: `src/components/SettingsDialog/SettingsDialog.jsx`, `src/utils/settingsValidator.js`, `src/MondayCalendar.jsx`
- Impact: Invalid column configurations will silently fail during data operations. Users won't know their settings are broken until they try to create/edit events.
- Fix approach: Add settings change detection listener, re-validate on settings save, block operations with invalid settings, show persistent warning banner.

**Plural Event Handler References:**
- Issue: Multiple state management hooks (`useMondayEvents`, `useAllDayEvents`, `useEventDataLoader`) handle similar data but are not synchronized. Changes to one may not reflect in others.
- Files: `src/hooks/useMondayEvents.js`, `src/hooks/useAllDayEvents.js`, `src/hooks/useEventDataLoader.js`
- Impact: Timed and all-day events are fetched/managed separately, creating potential race conditions and data inconsistencies. UI might show stale all-day events after timed event operations.
- Fix approach: Consolidate event management into single hook with unified state, or implement explicit sync mechanism between event sources.

---

## Known Bugs

**Scroll Lock During All-Day Event Drag Not Guaranteed:**
- Symptoms: User drags all-day event, time-content area unexpectedly scrolls, breaking visual feedback
- Files: `src/hooks/useCalendarHandlers.js:27-56`
- Trigger: Drag all-day event while time-content has non-zero scrollTop
- Workaround: None. User must drag carefully avoiding scroll triggers.
- Root cause: `requestAnimationFrame` loop runs continuously during drag but document.addEventListener cleanup may not fire synchronously, allowing scroll events between frames.

**Date Picker State Not Cleared on Modal Close:**
- Symptoms: Open AllDayEventModal with date picker visible, close modal, reopen - date picker still appears as open
- Files: `src/components/AllDayEventModal/AllDayEventModal.jsx:605-606`
- Trigger: Leave date picker open when closing modal via onClose callback
- Workaround: Click outside date picker to close before closing modal
- Root cause: `showDatePicker` state not reset in onClose handler, only in onCloseConfirm

**Race Condition in Column Settings Fetch:**
- Symptoms: Board loads but column validations show missing columns that exist
- Files: `src/utils/settingsValidator.js:16-51`, `src/components/SettingsDialog/MappingTab.jsx`
- Trigger: Rapid board switching or settings loading before board data is fully available
- Workaround: Refresh page after changing board
- Root cause: `checkColumnsExist` doesn't queue requests - multiple concurrent calls can race and return inconsistent results

---

## Security Considerations

**GraphQL Query Injection via Filter Values:**
- Risk: User filters contain unescaped values that could be injected into GraphQL queries if filter rules are user-editable
- Files: `src/hooks/useMondayEvents.js:84-93` (rulesToGraphQL function)
- Current mitigation: Filters come from Monday.com SDK which should sanitize, but `rulesToGraphQL` directly interpolates `rule.compare_value` using `JSON.stringify` without additional escaping
- Recommendations: Add input validation layer for filter values, use GraphQL variables for all dynamic values instead of string interpolation, add sanitization test cases for special GraphQL characters

**Stored XSS via Event Notes:**
- Risk: Notes are stored in Monday columns and rendered in modals without sanitization
- Files: `src/components/EventModal/EventModal.jsx`, `src/components/AllDayEventModal/AllDayEventModal.jsx`
- Current mitigation: React auto-escapes text content, but if notes are ever rendered as HTML they're at risk
- Recommendations: Continue using React text rendering (never dangerouslySetInnerHTML), validate notes length limits match Monday column constraints, add test case with HTML-like content in notes

**Monday SDK Token Exposure:**
- Risk: Monday SDK token is passed through props and context without explicit security boundaries
- Files: `src/MondayCalendar.jsx`, `src/App.jsx`, `src/init.js`
- Current mitigation: Token is managed by Monday.com SDK and only used for authorized Monday API calls
- Recommendations: Ensure token is never logged or exposed in error messages (check error handling), verify SDK initializes with HTTPS only, document token lifecycle

**CORS and Cross-Origin Data Leaks:**
- Risk: Not applicable - app runs within Monday.com iframe, no cross-origin requests to external APIs
- Recommendations: Maintain this constraint, avoid adding external API integrations without CORS review

---

## Performance Bottlenecks

**Large Event Lists Without Pagination in Calendar View:**
- Problem: `useMondayEvents.loadEvents()` fetches all events for date range via pagination (100 items per page), but renders all in calendar without virtual scrolling
- Files: `src/hooks/useMondayEvents.js:142-210`, `src/MondayCalendar.jsx:400-500`
- Cause: React Big Calendar renders all events in DOM. With 500+ events in a week view, renders become sluggish.
- Current capacity: ~300 events per week view before noticeable lag
- Limit: ~1000 events in view before frame drops below 30fps
- Improvement path: Implement client-side event filtering by time range, use React Big Calendar's built-in virtualization, add time-range pre-filter before fetch, lazy-load event details on-demand

**N+1 Query Pattern in Task/Project Loading:**
- Problem: Each event loads its associated task/project details separately instead of batch fetching
- Files: `src/hooks/useTasksMultiple.js:1-100`, `src/components/AllDayEventModal/AllDayEventModal.jsx:29-31`
- Cause: For each project selected, `fetchForProject()` is called individually, spawning multiple API requests
- Scaling limit: With 10+ projects selected, creates 10+ sequential API calls
- Improvement path: Batch-fetch all tasks for multiple projects in single query, cache project-task mappings, implement request deduplication

**Calendar Scroll Performance with High Event Density:**
- Problem: Scroll events trigger layout recalculations for event positioning
- Files: `src/MondayCalendar.jsx` (react-big-calendar integration)
- Cause: Each scroll event may retrigger event rendering calculations in the calendar library
- Improvement path: Debounce scroll handlers, use CSS transform for scroll position instead of layout thrashing, profile with DevTools to identify specific bottleneck

**Memory Leak from requestAnimationFrame Loop in useCalendarHandlers:**
- Problem: `lockScroll` function creates a closure that captures `isLocked` flag. If cleanup doesn't fire before component unmounts, loop continues referencing stale DOM
- Files: `src/hooks/useCalendarHandlers.js:36-43`
- Cause: requestAnimationFrame loop can persist if scroll lock cleanup delayed
- Improvement path: Store RAF ID and cancel with `cancelAnimationFrame`, add cleanup timeout safety net, test with React Profiler for memory leaks

---

## Fragile Areas

**AllDayEventModal Complex State Management:**
- Files: `src/components/AllDayEventModal/AllDayEventModal.jsx:39-66`
- Why fragile: 54 separate useState calls managing modal state (selectedType, endDate, showDatePicker, viewMode, searchTerm, addedReports, selectedTasks, selectedStages, etc.). State transitions between 'menu' → 'days-selection' → 'form' are not explicitly validated, creating potential invalid state combinations.
- Safe modification: Add state machine (useReducer) instead of individual useState, define explicit valid state transitions, add invariant assertions
- Test coverage: Modal state transitions not covered - missing tests for: switch mode without clearing previous state, reopen modal without reset, handle errors during state transition

**Dynamic Column Configuration Without Type Validation:**
- Files: `src/contexts/SettingsContext.jsx:39-49`, `src/utils/mondayColumns.js:12-53`
- Why fragile: Settings context stores column IDs as strings. When column types are unknown (status, people, connected board), mapping logic must handle all types. If Monday adds new column type, code silently ignores it.
- Safe modification: Add TypeScript column type definitions, validate column types on load, provide fallbacks with warnings, add column type validation utility
- Test coverage: No tests for unknown column types, mixed column type handling

**Drag-and-Drop State During Network Delays:**
- Files: `src/hooks/useCalendarHandlers.js:61-120`
- Why fragile: Drag operation updates event position optimistically but if API fails, state rollback happens silently. During rollback, user's drag may be visually interrupted. Multiple concurrent drag operations could conflict.
- Safe modification: Add drag operation queuing, prevent overlapping drags, show explicit rollback animation, add network error overlay
- Test coverage: No tests for: concurrent drags, drag during network failure, drag position validation

**Event Modal Form Field Synchronization:**
- Files: `src/components/EventModal/EventModal.jsx:1-491`
- Why fragile: Modal has 15+ form fields (title, date, startTime, endTime, project, task, stage, notes, etc.) stored in parent state. Changing one field may invalidate another (e.g., end time before start time). No unified validation logic.
- Safe modification: Consolidate form state to single object, add field-level validation with error states, implement form dirty detection for cancel confirmation
- Test coverage: Only basic form rendering tested - missing: invalid state combinations, field dependency validation

---

## Scaling Limits

**Monday API Complexity Budget:**
- Current capacity: Single board fetch with items, columns, nested relations stays within budget
- Limit: Adding more nested queries (e.g., tasks + stages + projects) in single query exceeds complexity limit
- Error: ComplexityBudgetExhausted returned by Monday API
- Scaling path: Break large queries into multiple smaller requests with smart caching, implement rate limiting queue, add request batching utility

**State Size Growth with Many Events:**
- Current capacity: ~1000 events in memory before noticeable React re-render lag
- Limit: ~10000 events causes visible frame drops
- Problem: All events kept in single state array, every event mutation re-renders entire list
- Scaling path: Implement virtualization in event list, use window state (only render visible events), add event filtering by date range in state

**Concurrent API Requests:**
- Current capacity: Monday SDK handles ~10 concurrent requests without rate limiting
- Limit: >15 concurrent requests may trigger rate limit or timeout
- Problem: No request queue or concurrency control - if user bulk-deletes or edits multiple events, requests spike
- Scaling path: Implement request queue with max 10 concurrent, add exponential backoff retry logic, queue mutations sequentially

---

## Dependencies at Risk

**react-big-calendar at v1.19.4:**
- Risk: Library is mature but slower update cadence. TypeScript types may lag. Drag-and-drop implementation not actively maintained.
- Impact: New calendar features need custom implementation (e.g., multi-select drag). Type safety limited.
- Migration plan: Monitor v2 releases (if any), consider switch to modern alternative (React Calendar, TanStack Table with calendar plugin) if needed, maintain local type definitions

**monday-sdk-js at v0.5.5:**
- Risk: SDK version is slightly outdated (latest is likely newer). Breaking changes in Monday API not immediately reflected.
- Impact: New Monday API features unavailable until SDK updates. Potential compatibility issues with new boards.
- Migration plan: Check for SDK updates quarterly, review Monday.com API changelog for breaking changes, add SDK upgrade task to maintenance backlog

**date-fns at v4.1.0:**
- Risk: Version is recent but timezone handling requires manual implementation. No built-in Israel timezone offset handling for DST transitions.
- Impact: Edge cases around DST transitions (spring/fall) could cause 1-hour shifts in reported times.
- Migration plan: Document timezone handling strategy, add DST test cases, consider Day.js as alternative if timezone support becomes critical

---

## Missing Critical Features

**Offline Support:**
- Problem: No offline queue for operations. If network drops during event creation, changes are lost.
- Blocks: Users in poor connectivity regions can't reliably submit hours
- Suggested approach: Implement IndexedDB queue for offline operations, show offline indicator, auto-sync when connection restored

**Bulk Event Operations:**
- Problem: Can delete multiple events via SelectionActionBar but can't bulk-edit shared properties (e.g., change billable status for 5 events at once)
- Blocks: Power users lose productivity reporting hours in batches
- Suggested approach: Add bulk edit modal supporting common fields (billable status, notes), batch API calls with transaction semantics

**Time Entry Validation:**
- Problem: No validation preventing overlapping timed events for same day. User can create 9-11 and 10-12 same day (invalid).
- Blocks: Prevents accurate time tracking. Leads to overbilled hours.
- Suggested approach: Query user's events for same day before save, show conflict warning, suggest alternative slots

---

## Test Coverage Gaps

**Date/Time Edge Cases:**
- What's not tested: DST transitions, leap seconds, year-end boundaries, non-Israeli timezones
- Files: `src/utils/dateFormatters.js`, `src/utils/durationUtils.js`, `src/hooks/useMondayEvents.js`
- Risk: Events created near DST transitions could be saved with wrong time. Year-end events may have off-by-one errors.
- Priority: High - impacts core feature reliability

**Error Handling with Specific Monday API Codes:**
- What's not tested: Each error code in ERROR_MESSAGES map (line 10-120 in errorHandler.js). Verify correct user message and canRetry flag for each.
- Files: `src/utils/errorHandler.js`, `src/components/ErrorToast/ErrorToast.jsx`
- Risk: Wrong error message shown, user attempts retry for non-retryable errors or gives up on retryable errors
- Priority: High - affects user experience during failures

**Modal Lifecycle and Cleanup:**
- What's not tested: Modal open/close sequences, rapid re-opens, close during pending operation, keyboard (Escape) close vs X button close
- Files: `src/components/EventModal/EventModal.jsx`, `src/components/AllDayEventModal/AllDayEventModal.jsx`
- Risk: State leaks between modal instances, pending operations continue after modal close, form data persists inappropriately
- Priority: Medium - occasional UX glitches likely

**Drag-Drop Edge Cases:**
- What's not tested: Drag all-day event while page scrolling, drag during network latency, drag outside calendar bounds, drag over themselves
- Files: `src/hooks/useCalendarHandlers.js`, `src/MondayCalendar.jsx`
- Risk: Visual glitches, dropped events in wrong positions, unintended event cancellations
- Priority: Medium - lower impact but affects daily usage

**Settings Validation Comprehensive:**
- What's not tested: Board deleted after settings save, columns deleted, column type changed, user permissions revoked
- Files: `src/utils/settingsValidator.js`, `src/components/SettingsValidationDialog/`
- Risk: Silent data loss if configuration becomes invalid post-save. Users lose access without warning.
- Priority: High - data integrity impact

**RTL (Right-to-Left) Language Edge Cases:**
- What's not tested: All UI elements with Hebrew text, calendar day names, number formatting, input field behavior in RTL context
- Files: `src/MondayCalendar.jsx`, `src/components/*/`, CSS modules
- Risk: UI layout broken, unreadable text, form fields misaligned in production for Hebrew users
- Priority: High - impacts all Hebrew-speaking users

**Concurrent Operations:**
- What's not tested: Delete event while dragging, create event while other event saves, update while delete pending
- Files: `src/hooks/useMondayEvents.js`, `src/MondayCalendar.jsx`
- Risk: Inconsistent state, lost updates, orphaned pending operations
- Priority: Medium - rare but data-loss implications

---

*Concerns audit: 2026-01-25*
