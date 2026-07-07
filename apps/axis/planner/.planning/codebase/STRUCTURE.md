# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
src/
├── App.tsx                      # Root component with provider hierarchy
├── App.css                      # Tailwind + custom styles
├── main.tsx                     # Entry point (Vite)
├── index.css                    # Global styles
├── components/                  # React UI components
│   ├── Gantt/                   # Gantt chart implementation
│   │   ├── GanttChart.tsx       # Main container (drag-drop, toolbar, virtualization)
│   │   ├── GanttProvider.tsx    # Central state provider
│   │   ├── GanttContext.tsx     # Context definition
│   │   ├── VirtualRowList.tsx   # Vertical virtualization wrapper
│   │   ├── TimelineHeader.tsx   # Column headers (dates/weeks/months)
│   │   ├── TaskBar.tsx          # Draggable task bar component
│   │   ├── TaskBarOverlay.tsx   # Drag preview overlay
│   │   ├── AllocationModal.tsx  # Create/edit allocation dialog
│   │   ├── ResizeHandle.tsx     # Sidebar resize handle
│   │   └── rows/                # Row type components
│   │       ├── RowRenderer.tsx  # Dispatcher for row types
│   │       ├── GroupHeaderRow.tsx   # Collapsible group header
│   │       ├── TrackRow.tsx     # Container for packed tasks
│   │       ├── TaskTrackRow.tsx # Legacy single task row
│   │       ├── CompanyLoadRow.tsx   # Role capacity/load visualization
│   │       └── LoadCell.tsx     # Individual load cell
│   └── Settings/                # Settings dialog & configuration
│       ├── SettingsDialog.tsx   # Modal wrapper
│       ├── SettingsTabs.tsx     # Tab navigation (Boards, Columns, Options)
│       ├── SettingsSection.tsx  # Reusable section component
│       ├── SearchableSelect.tsx # Searchable dropdown for board/column selection
│       ├── MultiSelect.tsx      # Multi-select for project status values
│       └── index.ts             # Barrel export
├── contexts/                    # React Context providers
│   ├── SettingsContext.tsx      # App configuration (persisted to Monday storage)
│   └── ActiveProjectsContext.tsx    # Project status filtering
├── hooks/                       # Custom React hooks (business logic)
│   ├── useGantt.ts             # Convenience hook to access GanttContext
│   ├── useMondayContext.ts     # Monday.com context (boardId, userId, permissions)
│   ├── useMondaySettings.ts    # Load/save PlannerSettings to storage
│   ├── useAllocations.ts       # Fetch and group allocations by view mode
│   ├── useDataFlattener.ts     # Flatten hierarchical groups to virtualization rows (with track packing)
│   ├── useInfiniteTimeline.ts  # Dynamic timeline expansion on scroll
│   ├── useHorizontalVirtualization.ts   # Calculate visible day range
│   ├── useCoordinateSystem.ts  # Pixel ↔ date conversion
│   ├── useCompanyLoad.ts       # Calculate role capacity and daily allocation load
│   ├── useWorkloadCalculator.ts    # Compute utilization and color coding
│   ├── useEmployeeAvailability.ts  # Find free slots for allocations
│   ├── useProjectCosts.ts      # Cost aggregation (if used)
│   ├── useRightClickPan.ts     # Right-click drag timeline
│   ├── useSettingsValidation.ts    # Validate settings completeness
│   └── index.ts                # (if exists)
├── services/                    # API layer
│   ├── mondayService.ts        # Generic Monday GraphQL wrapper
│   ├── allocationsApi.ts       # Allocation-specific CRUD
│   └── (future: workloadService.ts, projectsService.ts)
├── types/                       # TypeScript definitions
│   ├── gantt.types.ts          # FlatRow, Task, Group, ViewMode, ZoomLevel
│   ├── settings.types.ts       # PlannerSettings config
│   ├── index.ts                # Barrel export
│   ├── entities/               # Domain entity types
│   │   ├── allocation.types.ts # Allocation interface
│   │   ├── employee.types.ts   # Employee interface
│   │   ├── role.types.ts       # Role interface + color map
│   │   └── project.types.ts    # Project interface
│   └── ui/                     # (if used)
├── utils/                       # Utility functions
│   ├── allocationUtils.ts      # Grouping and hierarchy logic
│   ├── colorUtils.ts           # Project/role color generation
│   ├── constants.ts            # CONFIG, PIXELS_PER_DAY, zoom configs
│   ├── dateUtils.ts            # Date range helpers
│   ├── effortUtils.ts          # Effort mode mapping by zoom level
│   ├── mondayTransformers.ts   # Monday item → entity conversion
│   └── workDaysUtils.ts        # Working day calculation
├── data/                        # Static data or mock data (if used)
└── assets/                      # Images, fonts, icons (if used)
```

## Directory Purposes

**src/components/Gantt/**
- Purpose: Gantt chart visualization and interaction
- Contains: Main chart layout, virtualized rows, timeline header, draggable tasks, modals
- Key files: `GanttChart.tsx` (entry point), `GanttProvider.tsx` (state), `VirtualRowList.tsx` (rendering), `rows/` (row type implementations)

**src/components/Settings/**
- Purpose: Configuration UI for connecting Monday boards and columns
- Contains: Multi-step dialog, searchable dropdowns, validation messages
- Key files: `SettingsDialog.tsx` (main), `SettingsTabs.tsx` (tabbed navigation)

**src/contexts/**
- Purpose: Global state providers
- Contains: SettingsContext (config), ActiveProjectsContext (filters), GanttProvider context (Gantt state)
- All consumed via custom hooks (useSettings, useActiveProjects, useGantt)

**src/hooks/**
- Purpose: Business logic encapsulation and state management
- Contains: Data fetching, transformation, calculations, coordinate system
- Pattern: Each hook handles one concern, uses useMemo/useCallback for optimization

**src/services/**
- Purpose: External API integration
- Contains: Monday GraphQL queries/mutations, response handling
- Pattern: Thin wrapper over monday-sdk-js, returns domain entities

**src/types/**
- Purpose: TypeScript type definitions
- Contains: Data interfaces, unions, enums
- Pattern: entities/ for domain models, gantt.types.ts for UI state, settings.types.ts for config

**src/utils/**
- Purpose: Shared utility functions
- Contains: Data transformation, color generation, date calculations, constants
- No side effects; pure functions only

## Key File Locations

**Entry Points:**
- `src/main.tsx` - Vite dev server entry, mounts React app
- `src/App.tsx` - Root component, provider setup, configuration check
- `src/components/Gantt/GanttChart.tsx` - Main Gantt visualization component

**Configuration:**
- `src/types/settings.types.ts` - PlannerSettings interface (defines all configurable fields)
- `src/utils/constants.ts` - Zoom levels, pixels per day, buffer sizes, row heights
- `src/components/Settings/SettingsDialog.tsx` - UI for configuration

**Core Logic:**
- `src/components/Gantt/GanttProvider.tsx` - Central state management, orchestrates hooks
- `src/hooks/useAllocations.ts` - Data fetching and grouping
- `src/hooks/useDataFlattener.ts` - Hierarchical → flat conversion with track packing
- `src/hooks/useInfiniteTimeline.ts` - Timeline expansion and coordinate system
- `src/hooks/useCompanyLoad.ts` - Workload aggregation by role

**Testing:**
- No test files in src/ (testing pattern not established in codebase)
- See TESTING.md if tests are added

**Styling:**
- `src/App.css` - Component-level custom styles
- `src/index.css` - Global styles (Tailwind directives, theme)
- Tailwind CSS 4 via Vibe components

## Naming Conventions

**Files:**
- React components: PascalCase (e.g., `GanttChart.tsx`, `AllocationModal.tsx`)
- Hooks: camelCase with 'use' prefix (e.g., `useAllocations.ts`, `useDataFlattener.ts`)
- Services: camelCase with 'Service' or 'Api' suffix (e.g., `mondayService.ts`, `allocationsApi.ts`)
- Utilities: camelCase (e.g., `colorUtils.ts`, `dateUtils.ts`)
- Types: PascalCase (e.g., `gantt.types.ts`, `allocation.types.ts`)

**Directories:**
- Domain areas: PascalCase (e.g., Gantt/, Settings/, Allocations/)
- Layers: lowercase plural (e.g., hooks/, services/, contexts/, utils/, types/)
- Sub-domains within components: lowercase (e.g., rows/, ui/)

**Code Symbols:**
- React components: PascalCase (e.g., `GanttChart`, `AllocationModal`)
- Functions: camelCase (e.g., `groupAllocations()`, `packTasksIntoTracks()`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `DEFAULT_ZOOM`, `CONFIG`, `SIDEBAR_WIDTH_KEY`)
- Interfaces: PascalCase (e.g., `Group`, `Task`, `FlatRow`)
- Enums: PascalCase (e.g., `ViewMode` as union type)
- Type aliases: PascalCase (e.g., `ZoomLevel`, `TaskId`)

## Where to Add New Code

**New Feature (Allocation Editing, Filtering, Reporting):**
- Primary implementation: New hooks in `src/hooks/` for logic, components in `src/components/Gantt/` for UI
- If fetching external data: Extend `src/services/mondayService.ts` and `src/services/allocationsApi.ts`
- Data transformation: Add to `src/utils/mondayTransformers.ts` or new util file
- Types: Add interfaces to `src/types/gantt.types.ts` or new `src/types/entities/`

**New Row Type (e.g., SummaryRow, MetricsRow):**
- Type definition: Add to `src/types/gantt.types.ts` FlatRow union
- Component: Create `src/components/Gantt/rows/YourRowType.tsx`
- Dispatcher: Update `src/components/Gantt/rows/RowRenderer.tsx` switch statement
- Creation: Update `src/hooks/useDataFlattener.ts` row construction logic

**New Settings Section:**
- UI: Create `src/components/Settings/YourSection.tsx` (extend SettingsSection pattern)
- Config: Add fields to `src/types/settings.types.ts` PlannerSettings
- Validation: Add to `src/hooks/useSettingsValidation.ts`
- Storage: Settings automatically persisted via `useMondaySettings.ts`

**New Utility Function:**
- If date-related: Add to `src/utils/dateUtils.ts`
- If color-related: Add to `src/utils/colorUtils.ts`
- If data transformation: Add to `src/utils/allocationUtils.ts` or `src/utils/mondayTransformers.ts`
- If calculation: Create new file `src/utils/yourFeatureUtils.ts`

**New Context/State:**
- Create file `src/contexts/YourContext.tsx` following SettingsContext pattern
- Export Provider and custom hook (useYour)
- Mount at appropriate level in App.tsx (between SettingsProvider and GanttProvider)
- Document when to use vs when to extend GanttProvider

## Special Directories

**src/data/**
- Purpose: Mock data or static constants for development
- Generated: No
- Committed: Yes (if contains development mocks)

**src/assets/**
- Purpose: Images, SVG icons, fonts
- Generated: No
- Committed: Yes

**node_modules/**
- Purpose: npm dependencies
- Generated: Yes (by pnpm install)
- Committed: No

**.planning/codebase/**
- Purpose: Architecture and coding pattern reference documents
- Generated: By GSD mapper agent
- Committed: Yes (design records for future phases)

## Import Patterns

**Preferred order:**
```typescript
// 1. External libraries
import React, { useState, useCallback } from 'react';
import { addDays, format } from 'date-fns';

// 2. Monday SDK
import mondaySdk from 'monday-sdk-js';

// 3. Internal types
import type { Task, Group } from '../types/gantt.types';
import type { PlannerSettings } from '../types/settings.types';

// 4. Internal services
import { mondayService } from '../services/mondayService';

// 5. Internal hooks
import { useAllocations } from '../hooks/useAllocations';

// 6. Internal components
import { GanttChart } from './GanttChart';

// 7. Internal utilities
import { groupAllocations } from '../utils/allocationUtils';

// 8. Styles
import './Component.css';
```

**Path aliases:**
- No aliases configured (relative imports only)
- Common pattern: `../../hooks/`, `../../types/`, etc.

## File Structure Rules

**Component files:**
- One component per file
- Props interface defined at top
- Component declared after imports
- Display name for debugging
- Memoization via React.memo() if performance-critical
- Example: `src/components/Gantt/AllocationModal.tsx`

**Hook files:**
- One hook per file (or tightly related hooks)
- Hook declared after types/interfaces
- No component logic inside hooks
- Example: `src/hooks/useAllocations.ts`

**Service files:**
- Export object with methods (not class)
- All async functions return Promise<T> or throw
- Example: `src/services/mondayService.ts` exports `mondayService` object

**Type files:**
- Interfaces, types, enums only
- No runtime code
- Example: `src/types/gantt.types.ts`

**Utility files:**
- Pure functions only
- No side effects
- No component imports
- Example: `src/utils/dateUtils.ts`

---

*Structure analysis: 2026-01-25*
