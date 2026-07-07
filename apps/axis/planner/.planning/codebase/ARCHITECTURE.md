# Architecture

**Analysis Date:** 2026-01-25

## Pattern Overview

**Overall:** Hierarchical React Context-based architecture with central state management through providers, combined with a hook-based composition layer for data transformation and business logic.

**Key Characteristics:**
- Three-tier context provider hierarchy (SettingsProvider → ActiveProjectsProvider → GanttProvider)
- Unified data flow from Monday.com API through service layer, transformers, and hooks to components
- Vertical virtualization for rows, horizontal virtualization for timeline cells
- Real-time workload calculation across roles and employees
- Track packing algorithm to minimize visual row count while maintaining non-overlapping task visualization

## Layers

**Presentation Layer:**
- Purpose: Render UI components with Tailwind + Vibe design system
- Location: `src/components/`
- Contains: React functional components for Gantt chart, rows, settings dialog, task bars
- Depends on: GanttContext, hooks, types
- Used by: React DOM

**Container/Provider Layer:**
- Purpose: Manage global state and provide it to consumers via React Context
- Location: `src/contexts/` and `src/components/Gantt/GanttProvider.tsx`
- Contains:
  - `SettingsContext` - app configuration persisted to Monday Instance Storage
  - `ActiveProjectsContext` - filters projects by status
  - `GanttProvider` - central Gantt state (view mode, zoom, expanded groups, timeline, scroll)
- Depends on: Hooks, services, Monday SDK
- Used by: Components via `useGantt()` and context hooks

**Custom Hooks (Business Logic):**
- Purpose: Encapsulate data transformation, API calls, calculations
- Location: `src/hooks/`
- Contains:
  - `useAllocations` - fetches and groups allocations by view mode
  - `useDataFlattener` - converts hierarchical groups to flat rows for virtualization + track packing
  - `useInfiniteTimeline` - manages infinite scrolling timeline with dynamic day expansion
  - `useCompanyLoad` - calculates role capacity and daily load aggregation
  - `useWorkloadCalculator` - computes utilization percentages and color coding
  - `useCoordinateSystem` - converts between pixel X coordinates and dates
  - `useMondaySettings` - loads/saves settings to Monday Instance Storage
  - `useHorizontalVirtualization` - calculates visible day range for timeline cells
  - `useEmployeeAvailability` - determines free slots for new allocations
- Depends on: Services, utils, types
- Used by: Providers and components

**Service Layer (API Integration):**
- Purpose: GraphQL API wrapper and business entity transformation
- Location: `src/services/`
- Contains:
  - `mondayService` - generic Monday GraphQL wrapper (queries: boards, columns, items; mutations: create/update/delete items; workload data)
  - `allocationsApi` - allocation-specific CRUD wrapper (getAll, getEmployees, create, update, delete)
- Depends on: monday-sdk-js, transformers
- Used by: Hooks

**Transformation/Utils Layer:**
- Purpose: Data mapping and utility functions
- Location: `src/utils/`
- Contains:
  - `mondayTransformers.ts` - converts Monday items to Allocation/Employee/Task entities
  - `allocationUtils.ts` - groups allocations into hierarchical structure
  - `effortUtils.ts` - maps zoom levels to effort display modes (hours_day, hours_week, days_month, fte, total_hours)
  - `colorUtils.ts` - project and role color generation
  - `dateUtils.ts` - date range utilities
  - `workDaysUtils.ts` - working day calculation with configurable work week
  - `constants.ts` - zoom configs, pixels per day, buffer sizes
- Depends on: date-fns, types
- Used by: Hooks, services, components

**Type Definitions:**
- Purpose: TypeScript interfaces for type safety
- Location: `src/types/`
- Contains:
  - `gantt.types.ts` - FlatRow, Task, Group, ZoomLevel, ViewMode, timeline state
  - `settings.types.ts` - PlannerSettings configuration
  - `entities/` - Allocation, Employee, Role, Project types
- Depends on: Nothing
- Used by: All layers

## Data Flow

**Initialization Flow:**

1. App mounts → SettingsProvider loads settings from Monday Instance Storage via `useMondaySettings`
2. If configured, GanttProvider mounts → loads allocations via `useAllocations`
3. `useAllocations` calls `allocationsApi.getAll()` → `mondayService.fetchItems()` → GraphQL query to Monday API
4. Raw Monday items transformed via `transformMondayItemToAllocation` → Allocation entities
5. Allocations grouped via `groupAllocations()` in `useAllocations` useMemo → Group[] hierarchy
6. Groups flattened via `useDataFlattener` with track packing → FlatRow[] (virtualization-ready)
7. FlatRows rendered by VirtualRowList with RowRenderer dispatch

**View Change Flow (Projects ↔ Employees):**

1. User toggles view mode → `setViewMode()` in GanttProvider
2. Triggers `useAllocations` useMemo recalculation with new viewMode
3. Allocations regrouped (by project vs employee)
4. Flattening recalculates with new structure
5. VirtualRowList re-renders with new row data

**Allocation CRUD Flow:**

1. User drags task or opens modal → `openModal()` in GanttProvider
2. User saves changes → `addAllocation()` or `updateAllocation()` in GanttProvider
3. `useAllocations` calls `allocationsApi.create/update()`
4. API calls `mondayService.createItem/updateItem()` → GraphQL mutation
5. On success, `allocationsVersion` incremented (triggers re-fetch)
6. `useAllocations` re-fetches data, groups recalculate, rows flatten again

**Workload Calculation Flow (Company Load):**

1. Timeline day range changes → `useInfiniteTimeline` expands displayDays
2. `useCompanyLoad` recalculates based on:
   - Allocations data (from allocations board)
   - Employee capacity data (from employees board)
   - Workload items (pre-fetched from workload board if configured)
3. For each role: sum employee base hours (percentage × workDayHours) → RoleCapacity
4. For each allocation: iterate days in range → aggregate hoursPerDay by date and role → LoadMap
5. CompanyLoadData passed to `useDataFlattener` → LoadRow inserted at top
6. LoadCell component renders load bar colored by utilization (green/yellow/red)

**State Management:**

- **Settings:** Persisted to Monday Instance Storage via `monday.storage.instance`, loaded once on app boot
- **View state (zoom, view mode, sidebar width):** Stored in GanttProvider, sidebar width also persisted to Monday storage
- **Gantt data (groups, employees, roles, allocations):** Managed in GanttProvider, source-of-truth from Monday boards
- **Expanded groups:** Tracked in expandedGroups Set in GanttProvider
- **Scroll position:** Stored in scrollLeft/scrollTop in GanttProvider
- **Modal state:** isModalOpen + modalData in GanttProvider

## Key Abstractions

**Group:**
- Purpose: Hierarchical container for tasks, represents either a project or employee depending on view mode
- Examples: `src/types/gantt.types.ts` (Group interface)
- Pattern: Created via `groupAllocations()` in `src/utils/allocationUtils.ts`, grouped by projectId or employeeId based on viewMode

**FlatRow (Union Type):**
- Purpose: Flattened representation of hierarchical data for virtualization
- Pattern: Discriminated union with type field ('GROUP', 'TRACK', 'LOAD', 'TASK')
- Subtypes:
  - GroupHeaderRow - collapsible group header with expansion state
  - TrackRow - container for 1+ non-overlapping tasks (track packing output)
  - LoadRow - role capacity and daily load visualization
  - TaskRow - legacy single-task row (legacy support only)

**Track Packing:**
- Purpose: Minimize row count by placing non-overlapping tasks on same row
- Algorithm: Greedy first-fit (sort by start date, place each task on first available track with no overlap)
- Implementation: `packTasksIntoTracks()` in `src/hooks/useDataFlattener.ts`
- Benefit: Reduces visual clutter for projects with many parallel allocations

**Workload Item:**
- Purpose: Pre-aggregated workload data from separate workload tracking board
- Source: Monday board (optional, configured in settings)
- Example usage: "How many hours total is this role allocated across all projects this week?"
- Pattern: Fetched separately from allocations, cached in `employeeWorkloadItems` / `roleWorkloadItems` in GanttProvider

**Coordinate System:**
- Purpose: Convert between pixel X position and calendar dates
- Methods: `getXByDate()`, `getDateByX()`, `getWidthByDates()`
- Implementation: `useInfiniteTimeline` and `useCoordinateSystem`
- Usage: Drag and drop, task rendering, timeline scrolling

## Entry Points

**Browser:**
- Location: `src/main.tsx`
- Triggers: Vite dev server or production build
- Responsibilities: Mount React app into #root DOM element, wrap App in StrictMode

**App Component:**
- Location: `src/App.tsx`
- Triggers: Called by main.tsx
- Responsibilities:
  - Provider hierarchy setup (SettingsProvider → ActiveProjectsProvider → AppContent)
  - Monday context initialization via `useMondayContext()`
  - RTL layout setup (document.dir = 'rtl' for Hebrew)
  - Conditional rendering: unconfigured state vs configured (GanttProvider + GanttChart)
  - Auto-open settings if not configured

**GanttChart:**
- Location: `src/components/Gantt/GanttChart.tsx`
- Triggers: Mounted when app is configured
- Responsibilities:
  - Main container for Gantt view
  - Drag-and-drop setup via @dnd-kit
  - Toolbar: zoom controls, view mode toggle, settings button, search
  - Calls to VirtualRowList for virtualized row rendering
  - Scroll-to-today on zoom change

## Error Handling

**Strategy:** Try-catch at API boundaries with console.error logging and user-facing error messages via modal/toast where applicable.

**Patterns:**
- API calls wrapped in try-catch, errors logged but often silently fail (no hard blocking)
- Settings validation in `useSettingsValidation` hook to prevent unconfigured state
- Allocation CRUD operations provide optimistic UI updates, fallback to re-fetch on error
- Monday GraphQL errors checked via `response.errors` after each query
- Missing board/column IDs handled gracefully (return empty arrays or use defaults)

## Cross-Cutting Concerns

**Logging:**
- Strategy: console.log with prefixes ('[mondayService]', '[useAllocations]', etc) for debugging
- When: API calls, state changes, grouping/flattening operations
- Tools: Native console API

**Validation:**
- Board and column IDs must be configured in settings
- Date ranges validated (start ≤ end) before processing
- Allocation percentages clamped to 0-100%
- Role names trimmed and lowercased for comparison

**Authentication:**
- Implicit via Monday SDK - app runs inside Monday iframe with user context
- Permissions checked via `context.permissions` from `useMondayContext()`
- Setting changes restricted to users with canEditSettings permission

**Timezone & Locale:**
- App hardcoded for Hebrew (RTL layout, date formatting with Hebrew locale)
- Work day configuration respects user timezone indirectly through Monday Instance Storage
- Date calculations use date-fns with locale-aware formatting

**Performance Optimization:**
- Vertical virtualization: VirtualRowList only renders visible rows + buffer (from @tanstack/react-virtual)
- Horizontal virtualization: TimelineHeader + TaskBar only render visible days (via visibleDayRange)
- Memoization: useMemo + useCallback throughout for stable references
- Track packing reduces rendered rows from potential O(n) to O(sqrt(n)) in typical case
- Infinite timeline: Limits days in memory, dynamically expands as user scrolls
