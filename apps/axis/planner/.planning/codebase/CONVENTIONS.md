# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- Components: PascalCase with `.tsx` extension (e.g., `TaskBar.tsx`, `SettingsDialog.tsx`, `GanttChart.tsx`)
- Utilities: camelCase with descriptive names (e.g., `dateUtils.ts`, `allocationUtils.ts`, `colorUtils.ts`)
- Hooks: camelCase prefixed with `use` (e.g., `useAllocations.ts`, `useInfiniteTimeline.ts`, `useMondayContext.ts`)
- Services: camelCase (e.g., `mondayService.ts`, `allocationsApi.ts`)
- Context files: PascalCase with `Context` suffix (e.g., `SettingsContext.tsx`, `ActiveProjectsContext.tsx`, `GanttContext.tsx`)
- Types: PascalCase in files within `src/types/` directory

**Functions:**
- Exported functions: camelCase (e.g., `formatDateRange`, `groupAllocations`, `formatEffort`)
- Event handlers: camelCase prefixed with `handle` or descriptive verb (e.g., `handlePeopleColumnChange`, `handleSave`)
- React component functions: PascalCase (e.g., `TaskBar`, `GanttChart`, `SettingsDialog`)
- Custom hooks: camelCase prefixed with `use` (e.g., `useAllocations`, `useSettings`, `useGantt`)
- API methods: camelCase, grouped in object (e.g., `mondayService.fetchColumns()`, `allocationsApi.create()`)

**Variables:**
- Local state: camelCase (e.g., `isHovered`, `showTooltip`, `draftSettings`)
- Boolean flags: prefixed with `is`, `has`, `should`, or `can` (e.g., `isConfigured`, `canEditSettings`, `isDragging`)
- Mutable state holders: camelCase (e.g., `rowHeight`, `pixelsPerDay`, `sidebarWidth`)
- Constants: UPPER_SNAKE_CASE (e.g., `DEFAULT_ZOOM`, `SIDEBAR_WIDTH_KEY`, `MIN_SIDEBAR_WIDTH`)
- Map/Record collections: camelCase plural or singular with context (e.g., `groupsMap`, `roleColorMap`, `settingsMap`)
- Array collections: camelCase plural (e.g., `allocations`, `employees`, `roles`, `groups`)

**Types:**
- Interfaces: PascalCase without `I` prefix (e.g., `Task`, `Group`, `Employee`, `SettingsContextType`)
- Type aliases: PascalCase (e.g., `ViewMode`, `ZoomLevel`, `RowType`, `TaskId`)
- Props interfaces: `{ComponentName}Props` (e.g., `TaskBarProps`, `SettingsDialogProps`, `GroupHeaderRowProps`)
- Enums: PascalCase (rarely used; prefer union types or const objects)

## Code Style

**Formatting:**
- No formatter configured (Prettier not in devDependencies)
- Code uses consistent spacing with 2-space indentation inferred from source
- Line length: appears unconstrained, some lines exceed 100 characters

**Linting:**
- ESLint 9.39.1 with TypeScript support
- Config: `eslint.config.js` (flat config format)
- Plugins:
  - `@eslint/js` - JavaScript recommended rules
  - `typescript-eslint` - TypeScript strict rules
  - `eslint-plugin-react-hooks` - React hook rules (warnings for missing dependencies)
  - `eslint-plugin-react-refresh` - React Fast Refresh rules
- Key rules enforced:
  - ES2020+ syntax target
  - TypeScript strict mode enabled
  - `noFallthroughCasesInSwitch: true`
  - `noUncheckedSideEffectImports: true`

**React Conventions:**
- Functional components with hooks (no class components)
- Component structure: Props interface → Component declaration → Export
- Props destructured in function signature
- `React.FC<PropsType>` type annotation for components
- `memo()` used for performance-sensitive components (e.g., `TaskBar`)

## Import Organization

**Order:**
1. React and React DOM imports (`import React, { useState } from 'react'`)
2. External libraries (`import { format, parseISO } from 'date-fns'`)
3. Local types and interfaces (`import type { Task, ViewMode } from '../../types/gantt.types'`)
4. Local services and utilities (`import { allocationUtils } from '../../utils/allocationUtils'`)
5. Local contexts and hooks (`import { useSettings } from '../../contexts/SettingsContext'`)
6. Local components (if applicable)
7. CSS imports (`import './App.css'`)

**Path Aliases:**
- Relative imports used throughout (no path aliases configured in `tsconfig.app.json`)
- Import paths: `'../../types/gantt.types'`, `'../../utils/allocationUtils'`, etc.
- Explicit file extensions on TypeScript imports (though not required)

**Type Imports:**
- Use `import type` syntax for type-only imports to avoid circular dependency issues
- Example: `import type { Task, Group, ViewMode } from '../types/gantt.types'`

## Error Handling

**Patterns:**
- Try-catch blocks in async functions (e.g., `useAllocations`, `SettingsDialog` data loading)
- Error state in hooks: `const [error, setError] = useState<string | null>(null)`
- Console.error() for logging errors during development: `console.error('Failed to load data', err)`
- Context hooks throw `Error` if used outside provider: `throw new Error('useSettings must be used within SettingsProvider')`
- Monday API errors checked: `if (response.errors) throw new Error(response.errors[0].message)`
- Async operations use try-finally to manage loading state:
  ```typescript
  try {
    setLoading(true);
    // operation
  } catch (err) {
    setError('Failed message');
    console.error(err);
  } finally {
    setLoading(false);
  }
  ```

**Validation:**
- Custom validation hook: `useSettingsValidation()` for form field errors
- Field-level validation before API calls (e.g., `validatePeopleColumn()`)
- Runtime type checking with `.find()`, `.filter()`, optional chaining (`?.`)

## Logging

**Framework:** Console API (no logging library)

**Patterns:**
- Debug logs prefixed with context: `console.log('[useAllocations] Grouping with:', {...})`
- API calls logged with emoji prefix: `console.log('🚀 [monday.api] Full Call:', ...)`
- Fetch operations logged with structured data: `console.log('[fetchActiveProjectIds] Query variables:', JSON.stringify(variables))`
- Error logs: `console.error('Failed to X', err)` with error as second parameter

**When to Log:**
- API calls and responses (especially Monday.com API)
- State transitions in hooks (initialization, data fetch completion)
- Validation failures in settings
- Error conditions in try-catch blocks
- Not logged: routine component renders, event handlers (excessive noise)

## Comments

**When to Comment:**
- Function purpose and parameters: JSDoc-style comments for exported functions
- Complex logic: Inline comments for non-obvious algorithms
- Hebrew context-specific logic: Comments in English explaining purpose (though some Hebrew comments exist for RTL-specific code)
- Configuration rationale: Explain why constants have specific values
- NOT overused: Most code is self-documenting through clear naming

**JSDoc/TSDoc:**
- Used selectively for exported functions
- Example from `dateUtils.ts`:
  ```typescript
  /**
   * Formats a date range into a concise Hebrew string
   * Example: "12 ביוני - 15 ביוני"
   */
  export function formatDateRange(startDate: string | Date, endDate: string | Date): string
  ```
- Component-level documentation: Brief comment above component definition
- Parameter/return documentation: Inline when non-obvious

## Function Design

**Size:**
- Prefer small, focused functions (most utilities are 30-50 lines)
- Hooks contain more logic but logically separated (useAllocations = 230 lines for data loading + CRUD)
- Components: 100-300 lines typical; larger components separated into multiple smaller functions

**Parameters:**
- Destructure object parameters when multiple related arguments (e.g., `{startDate, endDate, pixelOffset, pixelsPerDay}`)
- Use options object for optional/configuration parameters: `options?: { activeProjects?: ...; allEmployees?: ... }`
- Type params explicitly for function arguments

**Return Values:**
- Return objects from hooks: `{ groups, employees, loading, error, addAllocation, updateAllocation, ... }`
- Return tuples for simple hooks (rare)
- Async functions return Promises of data type: `async getAll(settings): Promise<Allocation[]>`
- Null/undefined for optional values: `const [error, setError] = useState<string | null>(null)`

## Module Design

**Exports:**
- Named exports for most functions/hooks: `export const useAllocations = (...) => {...}`
- Default export only for main App component
- Services exported as objects: `export const mondayService = { ... }` and `export const allocationsApi = { ... }`
- Context exports: `export const useSettings = () => {...}` plus provider component

**Barrel Files:**
- Minimal barrel files; most imports are direct
- Example: `src/components/Settings/index.ts` exports all Settings components
- Types: `src/types/index.ts` exists but not heavily used

## Performance Conventions

**Memoization:**
- `memo()` for components receiving complex props that don't change frequently (TaskBar, etc.)
- `useMemo()` for expensive calculations: `const groups = useMemo(() => groupAllocations(...), [...])`
- `useCallback()` for callback functions passed to hooks/components: `const fetchAllocations = useCallback(async () => {...}, [...])`

**State Management:**
- Local state in components when state doesn't need lifting (isHovered, showTooltip)
- Context for truly global state (Settings, ActiveProjects, Gantt state)
- Avoid derived state; use useMemo instead

**Optimization:**
- Virtual rendering via `@tanstack/react-virtual` in VirtualRowList
- Lazy dependency tracking in hook dependency arrays (lint warnings disabled: `noUnusedParameters: false`)

## TypeScript Conventions

**Strict Mode:** Enabled (`"strict": true`)

**Type Annotations:**
- Always annotate function parameters
- Always annotate return types for exported functions
- Use `type` for type aliases, `interface` for object shapes
- Union types preferred over overloads: `TaskId = string | number`
- Intersection types for combining concerns: `Task extends Allocation { ... }`

**Generic Types:**
- Used in hooks: `useAllocations = (viewMode: ViewMode = 'projects')`
- Used in Map/Record: `Map<string, Task>`, `Record<ZoomLevel, number>`
- Constrained generics rarely used (prefer explicit types)

**Null/Undefined:**
- Null checks explicit: `const [error, setError] = useState<string | null>(null)`
- Optional chaining: `response.data?.boards[0]?.columns || []`
- Non-null assertion sparingly: `groupsMap.get(groupId)?.tasks.push(task)`
