# Planner - Resource Planning App for Monday.com

A Gantt chart-based resource planning app built for service companies where labor costs are the main expense and billing is based on work hours. Manage employee allocations to projects with real-time workload visibility.

## Key Features

- **Gantt Chart View** — Drag-and-drop allocation management with infinite timeline scrolling
- **Dual View Modes** — View allocations grouped by project or by employee
- **Role-Based Company Load** — Heatmap visualization of capacity vs. utilization per role
- **Real-Time Workload Info** — See employee availability when making allocations
- **Overlap Validation** — Prevents conflicting allocations for the same employee and project
- **Project Cost Tracking** — Total cost, planned hours, and average hourly rate per project
- **Project Manager Assignment** — Assign and change PMs directly from the Gantt view
- **Multi-Zoom Levels** — Day, week, month, and quarter granularity
- **Data Export** — Export planning data for comparing planned vs. actual work
- **Filtering** — Filter by timeframe and utilization status

## Tech Stack

- **Framework:** React 19 + TypeScript
- **Build:** Vite 7
- **Package Manager:** pnpm
- **Styling:** Tailwind CSS 4
- **UI Components:** @vibe/core (Monday.com Vibe Design System)
- **Drag & Drop:** @dnd-kit/core
- **Virtualization:** @tanstack/react-virtual
- **Monday SDK:** monday-sdk-js + @mondaycom/apps-sdk
- **Date Handling:** date-fns

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+
- A Monday.com developer account with app access

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm start        # Start dev server (port 8301) + Monday tunnel
pnpm server       # Start dev server only (no tunnel)
pnpm expose       # Create tunnel only
```

### Build & Deploy

```bash
pnpm build        # TypeScript check + Vite build
pnpm deploy       # Build and push to Monday.com
```

### Other Commands

```bash
pnpm lint         # Run ESLint
pnpm logs         # View live console logs
pnpm logs:http    # View live HTTP logs
pnpm status       # Check deployment status
```

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
│   │   ├── GanttContent.tsx     # Loading wrapper
│   │   ├── VirtualRowList.tsx   # Virtualized row rendering
│   │   ├── TimelineHeader.tsx   # Two-level timeline header
│   │   ├── TaskBar.tsx          # Draggable/resizable task bar
│   │   ├── TaskBarOverlay.tsx   # Drag overlay display
│   │   ├── AllocationModal.tsx  # Create/edit allocations
│   │   ├── FilterDropdown.tsx   # Timeframe & utilization filters
│   │   ├── AddProjectDropdown.tsx # Add hidden projects to view
│   │   ├── PMSelector.tsx       # Project manager selector
│   │   ├── ProjectSummaryCard.tsx # Project cost/hours summary
│   │   ├── DatePickerInput.tsx  # Custom date picker input
│   │   ├── ContextMenu.tsx      # Right-click context menu
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
│       ├── FreeFallLoader.tsx
│       └── index.ts
├── contexts/
│   ├── SettingsContext.tsx       # App settings (Monday storage)
│   └── ActiveProjectsContext.tsx # Active project filtering
├── hooks/
│   ├── useAllocations.ts        # Allocation CRUD with optimistic updates
│   ├── useAutoScroll.ts         # Auto-scroll during drag
│   ├── useCompanyLoad.ts        # Company-wide load by role
│   ├── useCoordinateSystem.ts   # Date ↔ pixel conversions
│   ├── useDataFlattener.ts      # Hierarchical → flat rows
│   ├── useEmployeeAvailability.ts # Employee workload availability
│   ├── useGantt.ts              # Gantt context accessor
│   ├── useHorizontalVirtualization.ts # Visible date range calc
│   ├── useInfiniteTimeline.ts   # Dynamic timeline expansion
│   ├── useMondayContext.ts      # Monday SDK context & permissions
│   ├── useMondaySettings.ts     # Settings persistence
│   ├── useOverlapValidation.ts  # Allocation overlap detection
│   ├── useProjectCosts.ts       # Project cost calculations
│   ├── useRightClickPan.ts      # Right-click panning
│   ├── useSettingsValidation.ts # Settings validation
│   ├── useUserPhotos.ts         # User photo caching
│   └── useWorkloadCalculator.ts # Workload percentage calc
├── services/
│   ├── mondayService.ts         # Monday GraphQL API wrapper
│   └── allocationsApi.ts        # Allocation-specific API layer
├── utils/
│   ├── Logger.ts                # Client-side logging service
│   ├── allocationUtils.ts       # Allocation grouping logic
│   ├── colorUtils.ts            # Project color generation
│   ├── constants.ts             # Layout & zoom constants
│   ├── dateUtils.ts             # Date formatting helpers
│   ├── effortUtils.ts           # Effort display formatting
│   ├── mondayTransformers.ts    # Monday ↔ domain transformers
│   ├── overlapUtils.ts          # Overlap detection utilities
│   └── workDaysUtils.ts         # Working day calculations
└── types/
    ├── index.ts                 # Barrel export
    ├── gantt.types.ts           # Gantt chart types
    ├── settings.types.ts        # App settings types
    └── entities/
        ├── allocation.types.ts
        ├── employee.types.ts
        ├── project.types.ts
        └── role.types.ts
```

## Architecture

### Data Flow

```
Monday.com API → mondayService.ts → allocationsApi.ts → useAllocations hook
                                                              ↓
                                                    allocationUtils.ts (grouping)
                                                              ↓
                                                    useDataFlattener (flat rows)
                                                              ↓
                                                    GanttProvider (global state)
                                                              ↓
                                                    Gantt UI Components
```

### State Management

- **Settings:** `SettingsContext` — persisted to Monday Instance Storage
- **Gantt Data:** `GanttProvider` — allocations, timeline, UI state
- **Active Projects:** `ActiveProjectsContext` — project status filtering

## Distribution

Sold as a **Monday Solution** — a complete package including pre-configured boards, automations, and this app.

## Target Users

Project managers at service companies (agencies, consulting firms, development studios).
