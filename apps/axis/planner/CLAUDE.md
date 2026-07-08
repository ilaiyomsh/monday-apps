# Planner App - Claude Code Guidelines

## Project Overview

Planner is a resource planning Monday.com app built for service companies where labor costs are the main expense and billing is based on work hours. It provides a Gantt chart interface for managing employee allocations to projects.

**Key Value Propositions:**
- Role-based workload visibility (not just individual employees)
- Real-time workload info when assigning employees to projects
- Data export for comparing planned vs actual work

## ⚠️ Open Investigation — pick up next session

**Settings "false-empty" wrongly onboards a configured instance.** Diagnosed, fix proposed (a `localStorage` "configured" breadcrumb), **not yet implemented**. A temporary `[VERSION_PROBE]` diagnostic is **live in production** and must be removed when the fix lands. Full diagnosis, evidence (live captures), proposed fix, data-loss corollary, and acceptance criteria are in:

→ **[`SETTINGS-FALSE-EMPTY-DIAGNOSIS.md`](./SETTINGS-FALSE-EMPTY-DIAGNOSIS.md)**

## Tech Stack

- **Framework:** React 19 + TypeScript
- **Build:** Vite 7
- **Package Manager:** pnpm
- **Styling:** Tailwind CSS 4
- **UI Components:** @vibe/core (Monday.com's design system)
- **Drag & Drop:** @dnd-kit/core
- **Virtualization:** @tanstack/react-virtual
- **Monday SDK:** monday-sdk-js + @mondaycom/apps-sdk
- **Date Handling:** date-fns
- **Utilities:** clsx, tailwind-merge, react-use-measure

## Project Structure

```
src/
├── App.tsx                      # Root component with providers
├── main.tsx                     # Entry point
├── components/
│   ├── Gantt/                   # Gantt chart components
│   │   ├── GanttProvider.tsx    # Central state provider
│   │   ├── GanttContext.tsx     # Context definition
│   │   ├── GanttChart.tsx       # Main chart with DnD and toolbar
│   │   ├── GanttContent.tsx     # Loading wrapper with branded spinner
│   │   ├── VirtualRowList.tsx   # Virtualized row rendering
│   │   ├── TimelineHeader.tsx   # Two-level timeline header
│   │   ├── TaskBar.tsx          # Draggable/resizable task bar
│   │   ├── TaskBarOverlay.tsx   # Lightweight drag overlay
│   │   ├── AllocationModal.tsx  # Create/edit allocations with validation
│   │   ├── BulkAllocationModal.tsx # Bulk allocation for multiple employees
│   │   ├── FilterDropdown.tsx   # Timeframe & utilization filters
│   │   ├── AddProjectDropdown.tsx # Add hidden projects to view
│   │   ├── ProjectFilterDropdown.tsx # Filter by PM & project type (portal)
│   │   ├── PMSelector.tsx       # Project manager selector
│   │   ├── ProjectSummaryCard.tsx # Project cost/hours summary card
│   │   ├── DatePickerInput.tsx  # Custom date picker with smart positioning
│   │   ├── ContextMenu.tsx      # Right-click context menu (portal)
│   │   ├── ResizeHandle.tsx     # Sidebar resize handle
│   │   └── rows/               # Row type components
│   │       ├── RowRenderer.tsx
│   │       ├── GroupHeaderRow.tsx
│   │       ├── TrackRow.tsx
│   │       ├── TaskTrackRow.tsx
│   │       ├── CompanyLoadRow.tsx
│   │       └── LoadCell.tsx
│   ├── Settings/                # Settings dialog components
│   │   ├── SettingsDialog.tsx
│   │   ├── SettingsTabs.tsx
│   │   ├── SettingsSection.tsx
│   │   ├── SearchableSelect.tsx
│   │   ├── MultiSelect.tsx
│   │   └── index.ts
│   └── ui/                      # Shared UI components
│       ├── FreeFallLoader.tsx   # Monday-branded loading spinner
│       └── index.ts
├── contexts/                    # React contexts
│   ├── SettingsContext.tsx
│   ├── MondayContext.tsx         # Monday SDK context provider
│   └── ActiveProjectsContext.tsx
├── hooks/                       # Custom React hooks
│   ├── useAllocations.ts        # CRUD for allocations (optimistic)
│   ├── useAutoScroll.ts         # Auto-scroll during drag operations
│   ├── useCompanyLoad.ts        # Company-wide load by role
│   ├── useCoordinateSystem.ts   # Date ↔ pixel conversions
│   ├── useDataFlattener.ts      # Hierarchical to flat rows
│   ├── useEmployeeAvailability.ts # Employee workload availability
│   ├── useGantt.ts              # Gantt context accessor
│   ├── useHorizontalVirtualization.ts # Visible date range calc
│   ├── useInfiniteTimeline.ts   # Dynamic timeline expansion
│   ├── useMondayContext.ts      # Monday SDK context & permissions
│   ├── useMondaySettings.ts     # Settings persistence (Monday storage)
│   ├── useOverlapValidation.ts  # Allocation overlap detection
│   ├── useProjectCosts.ts       # Project cost calculations
│   ├── useRightClickPan.ts      # Right-click panning
│   ├── useSettingsValidation.ts # Settings field validation (incl. fail-loud Day-off mapping checks — W3.7)
│   ├── useUserPhotos.ts         # User photo caching
│   └── useWorkloadCalculator.ts # Workload percentage calc
├── services/                    # API layer
│   ├── mondayService.ts         # Monday GraphQL API wrapper
│   ├── allocationsApi.ts        # Allocations-specific API
│   └── apiQueue.ts              # Rate-limited API queue with retries
├── utils/                       # Utility functions
│   ├── Logger.ts                # Client-side logging (window.AppLogger)
│   ├── allocationUtils.ts       # Allocation grouping logic
│   ├── colorUtils.ts            # Project color generation
│   ├── constants.ts             # Layout, zoom, and buffer constants
│   ├── dateUtils.ts             # Date formatting helpers
│   ├── effortUtils.ts           # Effort display formatting
│   ├── mondayTransformers.ts    # Monday ↔ domain transformers
│   ├── overlapUtils.ts          # Overlap detection utilities
│   ├── workDaysUtils.ts         # Working day calculations
│   ├── batchMutations.ts        # Sequential batch mutation execution
│   ├── statusLabelUtils.ts      # ID-based status/color label parsing (shared by SettingsDialog + useSettingsValidation)
│   └── sdkUtils.ts              # Promise timeout utility
└── types/                       # TypeScript definitions
    ├── index.ts                 # Barrel export
    ├── gantt.types.ts
    ├── settings.types.ts
    └── entities/
        ├── allocation.types.ts
        ├── employee.types.ts
        ├── project.types.ts
        └── role.types.ts
```

## Key Commands

```bash
pnpm start        # Start dev server (port 8301) + Monday tunnel
pnpm server       # Start dev server only (no tunnel)
pnpm expose       # Create tunnel only
pnpm build        # TypeScript check + Vite build
pnpm deploy       # DO NOT run directly (blocked) — deploy via the mapps skill ship procedure (one gated question; it rebuilds and force-pushes internally)
pnpm lint         # Run ESLint
pnpm logs         # View live console logs
pnpm logs:http    # View live HTTP logs
pnpm status       # Check deployment status
```

## Package Manager

This project uses **pnpm** as its package manager.

```bash
pnpm install      # Install dependencies
pnpm add <pkg>    # Add a dependency
pnpm add -D <pkg> # Add a dev dependency
```

## Architecture Patterns

### Data Flow
1. Monday.com API → `apiQueue.ts` → `mondayService.ts` → `allocationsApi.ts` → `useAllocations` hook
2. Raw Monday items are transformed via `mondayTransformers.ts`
3. `useDataFlattener` converts hierarchical groups to flat rows for virtualization

### State Management
- **Monday Context:** `MondayContext` provides SDK context, permissions, and board ownership
- **Settings:** `SettingsContext` persists to Monday Instance Storage
- **Gantt Data:** `GanttProvider` manages allocations, timeline, and UI state
- **Active Projects:** `ActiveProjectsContext` filters by project status

### View Modes
- `projects` - Groups allocations by project
- `employees` - Groups allocations by employee

### Zoom Levels
- `day`, `week`, `month`, `quarter` - Affects timeline granularity

## Coding Conventions

### Component Structure
- Functional components with hooks
- Memoization (`memo`, `useMemo`, `useCallback`) for performance
- Props interfaces defined at component level

### Monday.com Integration
- All API calls go through `mondayService.ts`
- Use `monday.storage.instance` for app settings
- Column mappings stored in settings (not hardcoded)

### Bug log
Non-trivial bugs get a postmortem in `BUGS.md` (symptom, root cause, why it slipped, fix, prevention). Add an entry whenever a bug took real digging to find — especially when the symptom misled the first diagnosis.

### Adding a new Monday GraphQL query
Before writing a new monday API call (especially one with `query_params` / filter rules):
1. Check `apps/tracker` and other sibling apps for an existing working pattern (`grep -r 'compare_value' apps/*/src`). Copy the proven shape rather than guessing.
2. Verify operator names and `compare_value` shape against the official docs (e.g. `https://developer.monday.com/api-reference/reference/date#filter`). Date filters need keywords like `["TODAY"]` or `["EXACT","YYYY-MM-DD"]` — a bare `["YYYY-MM-DD"]` is silently rejected.
3. Run the query once in the monday Playground or via `monday.api()` in DevTools before merging.
4. If a query starts failing with `Graphql validation errors` or `500 INTERNAL_SERVER_ERROR`, do NOT default to "monday is having a transient outage" — first re-verify the query against the docs. The SDK wraps real validation problems as 500s.

### Styling
- Tailwind CSS for layout and spacing
- Vibe components for UI consistency
- Custom colors from `colorUtils.ts` for projects

### TypeScript
- Strict mode enabled
- Entity types in `src/types/entities/`
- UI types in `src/types/gantt.types.ts`

## Key Files to Know

| File | Purpose |
|------|---------|
| `GanttProvider.tsx` | Central state and logic for entire Gantt |
| `useAllocations.ts` | Allocation CRUD with optimistic updates |
| `mondayService.ts` | Monday GraphQL API wrapper |
| `allocationsApi.ts` | Domain-specific API with transformations |
| `allocationUtils.ts` | Groups allocations into hierarchy |
| `mondayTransformers.ts` | Monday ↔ domain entity mapping |
| `settings.types.ts` | App configuration structure (~64 fields; incl. the additive `dayOff*` vacations-board block per `../Day-off/CONTRACT.md` — W3.1, +`dayOffMandatoryColumnId` W3.4) |
| `constants.ts` | Pixel sizes, zoom levels, buffer configs |
| `Logger.ts` | Singleton logger with `window.AppLogger` control |
| `overlapUtils.ts` | Allocation overlap detection logic |
| `apiQueue.ts` | Rate-limited mutation/read queue with backoff retries |
| `MondayContext.tsx` | Monday SDK context provider (permissions, board owner) |

## Important Considerations

### Performance
- Virtual scrolling via `@tanstack/react-virtual`
- Horizontal virtualization for timeline cells
- Track packing algorithm to minimize rows

### Monday.com Specifics
- App runs inside Monday iframe
- Uses Monday's theme context
- Board/column IDs come from settings (not hardcoded)
- Respects user permissions and board ownership

### Hebrew/RTL Support
- App designed for Hebrew-speaking users
- Date formatting uses Hebrew locale
- UI documentation in CODE_STRUCTURE_PLANNER.MD is in Hebrew
