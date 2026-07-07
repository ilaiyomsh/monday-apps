# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Status:** Not detected

**Note:** No test framework (Jest, Vitest, etc.) is currently installed or configured in `package.json`. No `.test.ts`, `.spec.ts`, `.test.tsx`, or `.spec.tsx` files exist in the `src/` directory.

## Development Testing Approach

While automated tests are not present, the codebase is structured for testability:

### Design Patterns Supporting Testing

**1. Service Separation (Dependency Injection Pattern)**
- API layer separated in `src/services/`:
  - `mondayService.ts` - Monday.com GraphQL API abstraction
  - `allocationsApi.ts` - Allocation-specific API operations
- Services can be mocked or stubbed in future tests
- Example: `allocationsApi` wraps `mondayService` calls, allowing injection of mock Monday service

**2. Utility Functions (Pure Functions)**
- Logic isolated in `src/utils/`:
  - `allocationUtils.ts` - `groupAllocations()` (pure function, no side effects)
  - `dateUtils.ts` - `formatDateRange()`, `getDynamicDates()` (pure)
  - `colorUtils.ts` - Color mapping functions (pure)
  - `effortUtils.ts` - Effort calculation and display (pure)
  - `workDaysUtils.ts` - Working day calculations (pure)
- Pure functions are easily testable without mocking

**3. Hook Abstraction (Custom React Hooks)**
- Business logic in hooks allows isolated testing:
  - `useAllocations.ts` - Data loading and CRUD operations
  - `useInfiniteTimeline.ts` - Timeline range management
  - `useCompanyLoad.ts` - Workload calculations
  - `useDataFlattener.ts` - Hierarchical data transformation
- Hooks can be tested with `renderHook()` from `@testing-library/react`

**4. Context Providers (State Testing)**
- Central state managed via contexts:
  - `SettingsContext.tsx` - App settings (testable with Provider wrapper)
  - `ActiveProjectsContext.tsx` - Project filtering state
  - `GanttContext.tsx` - Gantt chart state
- Context hooks (`useSettings()`) can be tested within provider trees

**5. Component Props-Driven Design**
- Components receive data via props (container/presentational pattern):
  - Props interfaces: `TaskBarProps`, `SettingsDialogProps`
  - Components render based on props, facilitating snapshot and behavior tests
- Example: `TaskBar` component receives `task: Task` prop, testable by varying Task objects

## Recommended Testing Strategy

### Unit Tests (Testable Utilities)

**For Pure Functions:**
Test functions in `src/utils/` without any setup:

```typescript
// Example test structure (not yet implemented)
describe('allocationUtils', () => {
  describe('groupAllocations', () => {
    it('groups allocations by project in projects view mode', () => {
      const allocations: Allocation[] = [...];
      const result = groupAllocations(allocations, 'projects');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Project A');
    });

    it('groups allocations by employee in employees view mode', () => {
      const allocations: Allocation[] = [...];
      const result = groupAllocations(allocations, 'employees');
      expect(result[0].id).toBe('emp-123');
    });
  });
});
```

**For Services:**
Mock Monday API responses and test transformation logic:

```typescript
// Example structure
describe('allocationsApi', () => {
  beforeEach(() => {
    jest.spyOn(mondayService, 'fetchItems').mockResolvedValue([...]);
  });

  it('fetches and transforms allocations', async () => {
    const allocations = await allocationsApi.getAll(settings);
    expect(allocations).toEqual([...]);
  });
});
```

### Integration Tests (Hooks)

**Testing Custom Hooks:**
Use React Testing Library's `renderHook()` for hooks requiring context:

```typescript
// Example structure
describe('useAllocations', () => {
  it('fetches allocations and groups them on mount', async () => {
    const wrapper = ({ children }) => (
      <SettingsProvider>
        <ActiveProjectsProvider>
          {children}
        </ActiveProjectsProvider>
      </SettingsProvider>
    );

    const { result } = renderHook(() => useAllocations('projects'), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.groups).toHaveLength(3);
  });

  it('updates allocation optimistically', async () => {
    const { result } = renderHook(() => useAllocations(), { wrapper });
    const task = result.current.groups[0].tasks[0];

    await act(async () => {
      await result.current.updateAllocation({...task, hoursPerDay: 6});
    });

    expect(result.current.groups[0].tasks[0].hoursPerDay).toBe(6);
  });
});
```

### Component Tests

**React Testing Library Pattern:**
Test component behavior with user interactions:

```typescript
// Example structure
describe('TaskBar', () => {
  it('renders task name and effort', () => {
    const task: Task = {
      id: '1',
      name: 'Development',
      projectName: 'Project A',
      startDate: '2026-01-25',
      endDate: '2026-01-30',
      hoursPerDay: 8,
      // ... other required fields
    };

    render(<TaskBar task={task} />, {
      wrapper: ({ children }) => (
        <GanttProvider>{children}</GanttProvider>
      )
    });

    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText(/8h|40h/)).toBeInTheDocument();
  });

  it('opens modal on click', async () => {
    const { getByRole } = render(<TaskBar task={mockTask} />, {
      wrapper: ({ children }) => (
        <GanttProvider>{children}</GanttProvider>
      )
    });

    await userEvent.click(getByRole('button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

## Test Coverage Opportunities

### High Priority (Core Logic)

1. **Allocation Grouping** (`allocationUtils.ts`)
   - Grouping by projects vs employees
   - Color assignment logic
   - Filtering by active projects
   - Estimated coverage: 100% achievable (pure function)

2. **Effort Calculations** (`effortUtils.ts`)
   - Format effort in different modes (hours_day, hours_week, days_month, fte, total_hours)
   - Over-capacity detection
   - Estimated coverage: 90%+ achievable

3. **Timeline Management** (`useInfiniteTimeline.ts`)
   - Dynamic date range expansion
   - Buffer triggers for loading more data
   - Zoom level effects
   - Estimated coverage: 80%+ achievable

4. **Working Days** (`workDaysUtils.ts`)
   - Counting working days considering work schedule
   - Weekend/holiday exclusion
   - Estimated coverage: 95%+ achievable

### Medium Priority (Business Logic)

5. **Data Loading** (`useAllocations.ts`)
   - Fetch allocations from Monday
   - Transform raw data to Task objects
   - Handle active project filtering
   - Estimated coverage: 70%+ achievable

6. **Company Load Calculations** (`useCompanyLoad.ts`)
   - Role-based workload aggregation
   - Daily/weekly/monthly load calculations
   - Estimated coverage: 75%+ achievable

### Lower Priority (UI/Integration)

7. **Component Rendering** (TaskBar, GanttChart, etc.)
   - Snapshot tests for UI consistency
   - User interactions (drag, resize, click)
   - Estimated coverage: 50%+ achievable initially

8. **Settings Dialog** (`SettingsDialog.tsx`)
   - Form validation
   - Board/column selection
   - Settings persistence
   - Estimated coverage: 60%+ achievable

## Mock Data Patterns

**Monday SDK Mock:**
```typescript
// Already present in mondayService.ts for mock boards
const mockBoard = (id: string) => ({
  id: id.startsWith('mock-') ? id : undefined,
  columns: [
    { id: 'date', title: 'Start Date', type: 'date' },
    { id: 'numbers', title: 'Hours', type: 'numbers' },
  ]
});
```

**Allocation Mock Factory:**
```typescript
const createMockAllocation = (overrides?: Partial<Allocation>): Allocation => ({
  id: '1',
  projectId: 'proj-1',
  projectName: 'Test Project',
  employeeId: 'emp-1',
  userName: 'John Doe',
  role: 'Developer',
  hoursPerDay: 8,
  startDate: '2026-01-25',
  endDate: '2026-01-30',
  ...overrides
});
```

**Settings Mock:**
```typescript
const createMockSettings = (overrides?: Partial<PlannerSettings>): PlannerSettings => ({
  allocationsBoardId: 'mock-board-1',
  employeesBoardId: 'mock-board-2',
  projectsBoardId: 'mock-board-3',
  startDateColumnId: 'date',
  endDateColumnId: 'date_1',
  hoursColumnId: 'numbers',
  roleColumnId: 'status',
  maxHoursPerDay: 8.5,
  filterActiveProjects: false,
  workDays: [1, 2, 3, 4, 5], // Monday-Friday
  ...overrides
});
```

## Fixtures and Test Data

**No centralized fixtures currently exist.**

Recommended structure when adding tests:
```
src/__tests__/
├── fixtures/
│   ├── allocations.fixtures.ts
│   ├── employees.fixtures.ts
│   ├── projects.fixtures.ts
│   └── settings.fixtures.ts
├── mocks/
│   ├── mondayService.mock.ts
│   └── handlers.ts (MSW)
└── utils/
    ├── testHelpers.ts
    └── renderWithProviders.ts
```

## Async Testing

**Current Approach:**
- Async operations wrapped in try-catch within hooks
- Optimistic updates with error recovery

**Testing Pattern:**
```typescript
it('handles async allocation update', async () => {
  const { result } = renderHook(() => useAllocations(), { wrapper });

  // Spy on API
  jest.spyOn(allocationsApi, 'update').mockImplementation(
    () => new Promise(resolve => setTimeout(resolve, 100))
  );

  await act(async () => {
    await result.current.updateAllocation(modifiedTask);
  });

  expect(allocationsApi.update).toHaveBeenCalled();
});
```

## Error Testing

**Error Handling Pattern:**
Services throw errors, hooks catch and set error state:

```typescript
// Test error state
it('sets error state on fetch failure', async () => {
  jest.spyOn(allocationsApi, 'getAll').mockRejectedValue(
    new Error('Network error')
  );

  const { result } = renderHook(() => useAllocations(), { wrapper });

  await waitFor(() => {
    expect(result.current.error).toBe('Failed to load data');
    expect(result.current.loading).toBe(false);
  });
});
```

## Implementation Recommendations

1. **Add test framework:** Install Vitest (faster than Jest for Vite projects)
   ```bash
   pnpm add -D vitest @testing-library/react @testing-library/jest-dom
   ```

2. **Start with utilities:** Pure functions in `src/utils/` are easiest to test first

3. **Add to CI/CD:** Configure test runs on pull requests

4. **Coverage targets:** Aim for 70%+ on utilities, 50%+ on hooks/components initially

5. **Mock Monday SDK:** Consider MSW (Mock Service Worker) for API mocking in integration tests

---

*Testing analysis: 2026-01-25*
