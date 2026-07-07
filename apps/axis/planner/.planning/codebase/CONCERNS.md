# Codebase Concerns

**Analysis Date:** 2026-01-25

## Tech Debt

**Console Logging in Production Code:**
- Issue: Multiple development console logs left in production-ready files that should be removed or behind debug flags
- Files: `src/services/mondayService.ts` (lines 8, 116, 149, 152, 165, 168, 173), `src/hooks/useMondaySettings.ts` (line 10), `src/hooks/useMondayContext.ts` (line 10), `src/hooks/useAllocations.ts` (line 25), `src/components/Gantt/AllocationModal.tsx` (line 84), `src/contexts/ActiveProjectsContext.tsx` (multiple lines), `src/components/Settings/SettingsDialog.tsx` (multiple lines)
- Impact: Performance degradation, security risk (API calls logged with variables), cluttered console output makes debugging harder
- Fix approach: Implement conditional logging behind environment flag or debug context; remove or wrap in `if (DEBUG)` blocks

**Type Safety Workarounds - Excessive `as any` Usage:**
- Issue: 31 instances of `as any` casts throughout codebase, bypassing TypeScript strict mode
- Files: `src/components/Gantt/GanttProvider.tsx` (line 49), `src/services/mondayService.ts` (lines 26, 60, 86), `src/hooks/useMondaySettings.ts` (line 65), `src/hooks/useAllocations.ts` (line 63), `src/components/Settings/SettingsDialog.tsx` (line 26), and many others
- Impact: Type errors at runtime, harder to refactor, IDE cannot catch mistakes, unclear intent
- Fix approach: Replace with proper type definitions; create interfaces for Monday.com API responses; use type guards instead of casts

**Missing Error Context in Catch Blocks:**
- Issue: Error handlers use generic messages (`'Failed to load data'`, `'Failed to update allocation'`) without error details passed to user or logging system
- Files: `src/hooks/useAllocations.ts` (lines 134-136, 152-154, 170-172, 183-185, 206-208), `src/contexts/ActiveProjectsContext.tsx` (line 55), `src/components/Settings/SettingsDialog.tsx` (lines 203, 217, 229, 241, 253)
- Impact: Users see unhelpful error messages; impossible to diagnose failures; errors silently logged to console only
- Fix approach: Pass error details to state; create centralized error handling; show actionable error messages to user

## Known Bugs

**Optimistic Update Without Proper Error Recovery:**
- Symptoms: If update fails after optimistic UI update, user sees stale data until manual refresh
- Files: `src/hooks/useAllocations.ts` (lines 160-175)
- Trigger: Network failure during `updateAllocation` call; user changes task, update fails mid-network request
- Workaround: Manual page refresh restores consistency; user can re-open modal to see current state

**Missing null/undefined Checks on Task Properties:**
- Symptoms: Potential runtime errors when task missing required fields
- Files: `src/components/Gantt/TaskBar.tsx` (lines 49-57, 83-84); uses `task.startDate`, `task.endDate`, `task.hoursPerDay` without validation
- Trigger: Malformed allocation data from Monday.com API
- Workaround: Defensive coding in component (checks like `if (!task.startDate)`) mitigates but doesn't solve at source

**ResizeOffset Drag Interaction Conflict:**
- Symptoms: After drag resize, clicking task may trigger modal unexpectedly
- Files: `src/components/Gantt/TaskBar.tsx` (lines 87-95, 224-230)
- Trigger: Rapid drag + click sequence; `justResizedRef` prevents modal but timing-sensitive
- Workaround: Modal handler checks `justResizedRef` to prevent unwanted open

## Security Considerations

**Monday.com Storage Access Without Validation:**
- Risk: App stores settings in Monday instance storage without encrypting sensitive values (like board IDs and column IDs)
- Files: `src/hooks/useMondaySettings.ts` (lines 65, 120-123), `src/components/Gantt/GanttProvider.tsx` (lines 49-50, 70)
- Current mitigation: Monday.com storage is scoped to instance; relies on Monday.com's security
- Recommendations: Validate settings before use (check board/column IDs exist); sanitize stored data; implement audit log for settings changes

**No Input Validation on Column Settings Parsing:**
- Risk: Parsing JSON from Monday.com column settings without try-catch in all places; some errors silently fail
- Files: `src/utils/mondayTransformers.ts` (lines 37, 97, 198), `src/components/Settings/SettingsDialog.tsx` (lines 79-81, 147-149, 186), `src/hooks/useAllocations.ts` (lines 65-67)
- Current mitigation: Some try-catch blocks exist, but not consistent
- Recommendations: Centralize settings parsing in utility function with schema validation; use library like Zod for runtime validation

**Development Mode Detection Based on Hostname:**
- Risk: `isDevelopment = window.location.hostname === 'localhost'` is fragile; allows bypassing storage errors in dev but could expose inconsistent behavior
- Files: `src/hooks/useMondaySettings.ts` (line 52)
- Current mitigation: Only affects dev environment, mock data hardcoded
- Recommendations: Use environment variable (process.env.NODE_ENV) instead of hostname check; document dev vs production differences

**API Logging Includes Sensitive Data:**
- Risk: Monday API calls logged with variables containing board IDs, column settings, allocation data
- Files: `src/services/mondayService.ts` (lines 6-10), `src/hooks/useMondaySettings.ts` (lines 8-11), `src/hooks/useMondayContext.ts` (lines 9-12)
- Current mitigation: Console logs only, not sent to external service
- Recommendations: Never log query variables with user data; implement sanitization if logging needed for debugging

## Performance Bottlenecks

**Large Component Renders - SettingsDialog:**
- Problem: Component renders 932 lines with 30+ state variables; difficult to reason about
- Files: `src/components/Settings/SettingsDialog.tsx`
- Cause: All UI logic in single component; no sub-component decomposition
- Improvement path: Extract sections into separate components (AllocationsSection, EmployeesSection, GeneralSection); memoize each section; move loading states to context

**Excessive Re-renders from Context Changes:**
- Problem: `GanttProvider` has large dependency array (38 items); any change to one value triggers full tree re-render
- Files: `src/components/Gantt/GanttProvider.tsx` (lines 400-438)
- Cause: Context value includes both data and callbacks; consumers can't subscribe to specific values
- Improvement path: Split context into multiple (data context, callbacks context); use useShallow for selective updates

**Horizontal Virtualization Not Fully Utilized:**
- Problem: Timeline header and virtual row list virtualize differently; gaps in implementation mean not all far-off grid cells are skipped
- Files: `src/components/Gantt/TimelineHeader.tsx`, `src/components/Gantt/VirtualRowList.tsx`, `src/hooks/useHorizontalVirtualization.ts`
- Cause: Partial implementation; some components render all visible columns instead of virtualized range
- Improvement path: Ensure all grid rendering uses `visibleDayRange` from context; profile with many days visible (e.g., 2-year view)

**Role/Color Map Regeneration:**
- Problem: `roleColorMap` recalculated on every allocation fetch even when roles unchanged
- Files: `src/hooks/useAllocations.ts` (lines 60-120)
- Cause: Color map built inline during fetch, not memoized separately
- Improvement path: Extract role extraction to separate memoized function; only update when role column changes

## Fragile Areas

**AllocationModal Form State Sync:**
- Files: `src/components/Gantt/AllocationModal.tsx` (lines 68-79, 82-120)
- Why fragile: Manual two-way sync between `hoursPerDay` and `totalHours` with `daysCount`; easy to create inconsistent states
- Safe modification: Add explicit validation on form submit; ensure all three values (hours, total, days) match before save; document invariant
- Test coverage: Form state sync has no tests; effort/total conversion not unit tested

**Monday.com API Response Parsing:**
- Files: `src/services/mondayService.ts`, `src/utils/mondayTransformers.ts`
- Why fragile: Assumes specific response structure from Monday.com API; no validation of required fields; parsing spread across two files
- Safe modification: Add runtime validation using schema library; centralize all transformations in mondayTransformers.ts; add integration tests with real API responses
- Test coverage: No tests for transformer functions; no validation of edge cases (missing fields, null values, unexpected types)

**Settings Validation Logic:**
- Files: `src/components/Settings/SettingsDialog.tsx` (lines 75-107, 143-189), `src/hooks/useSettingsValidation.ts`
- Why fragile: Validation split between component and custom hook; board/column dependencies not validated (e.g., column must exist in selected board); status labels extracted ad-hoc
- Safe modification: Move all validation to centralized schema; validate entire settings object before save; warn user if linked resources change
- Test coverage: useSettingsValidation has no unit tests

**Employee Availability Calculation:**
- Files: `src/hooks/useEmployeeAvailability.ts`
- Why fragile: Depends on exact task date format and employee role matching; circular dependency risk with task updates
- Safe modification: Add comprehensive date validation; use date objects internally instead of strings; unit test with edge dates
- Test coverage: Not tested; edge cases like same-day tasks not verified

## Scaling Limits

**Timeline Rendering with Years of Data:**
- Current capacity: Tested with months of data; likely becomes slow with 2+ year timelines
- Limit: Virtual row list works fine, but timeline header regenerates `displayDays` array on zoom change; scales O(days)
- Scaling path: Implement header virtualization; cache timeline segments; consider weekly/monthly grouping for large date ranges

**Memory Growth with Large Allocations:**
- Current capacity: 1000+ allocations manageable; grouping and flattening may become slow
- Limit: `useDataFlattener` flattens entire hierarchy on each call; no pagination or windowing
- Scaling path: Implement allocation pagination; use cursor-based pagination from Monday.com API; stream rows instead of materializing all

**Employee List in Settings Dropdown:**
- Current capacity: 500+ employees loadable
- Limit: SearchableSelect renders all options; no virtualization
- Scaling path: Implement virtual scrolling in select dropdown; add search-as-you-type to reduce options early; lazy-load employee list

**Task Bar Dragging Performance:**
- Current capacity: 200+ visible task bars on screen at once
- Limit: Each TaskBar is memoized but checks all tasks in groups for employee availability; O(n) calculation per bar
- Scaling path: Pre-calculate availability matrix once per timeline segment; memo availability results by employee+date range

## Dependencies at Risk

**monday-sdk-js (v0.5.7):**
- Risk: Wrapping monday.api with monkey-patching for logging; SDK updates may break the wrapper or change API signatures
- Impact: API calls fail silently if wrapper breaks; hard to diagnose SDK version issues
- Migration plan: Use SDK's built-in logging if available (check v1.0+ releases); switch to official debugging tools; remove monkey-patch

**@vibe/core (v3.83.1):**
- Risk: Monday.com design system; major version updates may include breaking changes to component props/behavior
- Impact: UI components may behave unexpectedly after upgrade; DatePicker in AllocationModal may change interaction model
- Migration plan: Pin exact version; test thoroughly before upgrading; watch Monday.com changelog for Vibe releases

**@dnd-kit (v6.3.1):**
- Risk: Complex drag-and-drop library; task drag/drop resize logic tightly coupled to dnd-kit behavior
- Impact: Upgrading dnd-kit may require re-implementing resize logic; team may not be familiar with library
- Migration plan: Add comprehensive e2e tests for drag/drop before any upgrade; consider extracting drag logic to isolated hook

## Missing Critical Features

**Offline Support:**
- Problem: App has no offline capability; all operations require Monday.com API connectivity
- Blocks: Using app on unstable internet; viewing allocations without connection; working locally on allocations
- Implementation: Add local caching with IndexedDB; queue mutations; sync on reconnect; show offline indicator

**Allocation Conflict Detection:**
- Problem: No visual warning when assigning employee to overlapping allocations
- Blocks: Over-booking detection only happens post-save when checking capacity; user doesn't know before committing
- Implementation: Real-time availability check in TaskBar and AllocationModal; highlight conflicts in timeline view

**Bulk Operations:**
- Problem: No multi-select or bulk edit capability; updating multiple allocations one-by-one is tedious
- Blocks: Large planning changes; moving multiple tasks to same date; scaling project timelines
- Implementation: Add select checkbox to rows; implement batch update API calls; add copy-paste for dates/hours

**Audit Log:**
- Problem: No record of who changed what allocation when
- Blocks: Investigating planning changes; accountability for project modifications
- Implementation: Log all mutations (create/update/delete) to Monday.com custom field; surface in settings

## Test Coverage Gaps

**No Unit Tests for Core Hooks:**
- What's not tested: `useAllocations`, `useDataFlattener`, `useInfiniteTimeline`, `useCompanyLoad`, `useEmployeeAvailability` - all critical data/logic hooks
- Files: `src/hooks/*.ts` - every hook in this directory
- Risk: Refactoring these is extremely risky; bugs in logic go undetected; performance regressions not caught
- Priority: High - these hooks are the backbone of the app

**No Tests for Data Transformers:**
- What's not tested: `mondayTransformers.ts` role/people/allocation parsing; `allocationUtils.ts` grouping logic; `effortUtils.ts` calculations
- Files: `src/utils/mondayTransformers.ts`, `src/utils/allocationUtils.ts`, `src/utils/effortUtils.ts`
- Risk: Data corruption or calculation errors only caught in production; edge cases (null values, missing fields) not validated
- Priority: High - transformers are fundamental to data integrity

**No Integration Tests:**
- What's not tested: Monday.com API integration; allocationsApi CRUD operations; end-to-end data flow from fetch to display
- Risk: API contract changes not caught; breaking changes in Monday SDK only discovered at runtime
- Priority: Medium - would require Monday.com sandbox/test instance

**No Component Snapshot or E2E Tests:**
- What's not tested: TaskBar rendering with various states; TimelineHeader zoom interactions; GanttChart overall layout; modal validation flows
- Risk: UI regressions go unnoticed; edge cases like small screens not caught; drag/drop correctness not verified
- Priority: Medium - benefits from automation but time-intensive to implement

**Missing Test Setup Infrastructure:**
- Current state: No test runner, no test utilities, no mock setup, no fixtures
- Blocker: Project uses no test framework (jest/vitest not configured); would need initial setup before any tests possible
- Priority: High - blocks all testing efforts; should be first step

---

*Concerns audit: 2026-01-25*
