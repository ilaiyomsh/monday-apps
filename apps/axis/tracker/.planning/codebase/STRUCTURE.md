# Codebase Structure

**Analysis Date:** 2026-01-25

## Directory Layout

```
src/
├── components/              # React UI components (11 folders)
│   ├── AllDayEventModal/    # All-day event (vacation/sick/reserves) form
│   ├── EventModal/          # Timed event create/edit form
│   ├── SettingsDialog/      # Settings configuration (tabs, column mapping)
│   ├── ConfirmDialog/       # Confirmation modal for destructive actions
│   ├── ErrorBoundary/       # React error boundary wrapper
│   ├── ErrorDetailsModal/   # Full error details with copy-to-JSON
│   ├── ErrorToast/          # Error notification display
│   ├── Toast/               # Generic notification system
│   ├── CustomEvent/         # Calendar event renderer
│   ├── CalendarToolbar/     # Calendar navigation toolbar
│   ├── SelectionActionBar/  # Multi-select actions bar
│   └── TaskSelect/          # Dropdown for task selection
├── hooks/                   # Custom React hooks (15+ files)
│   ├── useMondayEvents.js   # Event CRUD, pagination, filtering (721 lines)
│   ├── useProjects.js       # Project loading with user assignment filtering
│   ├── useTasks.js          # Task loading and creation
│   ├── useEventModals.js    # Modal state management
│   ├── useEventDataLoader.js # Event data fetching for edit mode
│   ├── useCalendarHandlers.js # Drag/drop, event interactions
│   ├── useToast.js          # Toast notifications state
│   ├── useStageOptions.js   # Stage/status field options
│   ├── useNonBillableOptions.js # Non-billable type options
│   ├── useBoardOwner.js     # Board ownership info
│   ├── useIsraeliHolidays.js # Israeli holidays calendar
│   ├── useAllDayEvents.js   # All-day event specific logic
│   ├── useMultiSelect.js    # Multi-select management
│   ├── useTasksMultiple.js  # Multiple task loading
│   └── ...                  # Additional hooks
├── contexts/                # React Context providers
│   └── SettingsContext.jsx  # Global settings, structure modes, persistence
├── utils/                   # Utility functions
│   ├── mondayApi.js         # GraphQL queries/mutations (1037 lines)
│   ├── logger.js            # Logging system with debug controls
│   ├── errorHandler.js      # Error parsing, user messages
│   ├── durationUtils.js     # Duration conversion (hours/days)
│   ├── mondayColumns.js     # Column mapping, value parsing
│   ├── dateFormatters.js    # Date/time formatting
│   ├── colorUtils.js        # Color generation from project names
│   ├── settingsValidator.js # Settings validation
│   ├── eventTypeValidation.js # Event type checking
│   ├── holidayUtils.js      # Holiday detection
│   └── globalErrorHandler.js # Global error catcher
├── constants/               # Configuration constants
│   ├── calendarConfig.jsx   # react-big-calendar localizer, formats
│   └── holidayConfig.js     # Israeli holidays dates
├── styles/                  # CSS styling
│   ├── calendar/            # Calendar-specific styles
│   │   ├── index.css
│   │   ├── components/      # Component overrides
│   │   └── structure/       # Layout structure styles
│   └── index.css            # Global styles
├── App.jsx                  # Root component, SettingsProvider wrapper
├── MondayCalendar.jsx       # Main calendar view (1551 lines)
├── index.jsx                # React entry point
├── init.js                  # Global initialization
└── index.css                # Root styles
```

## Directory Purposes

**components/**
- Purpose: All user-facing React components
- Contains: Modal dialogs, form inputs, calendar UI customizations
- Pattern: Each component has folder with `ComponentName.jsx`, `ComponentName.module.css`, `index.js`
- Key file: `MondayCalendar.jsx` is not in components folder - it's at root src level as the main view

**hooks/**
- Purpose: Business logic, data fetching, state management
- Contains: Custom hooks with no JSX (except return objects/functions)
- Pattern: Pure functions taking arguments, returning state + functions
- Key hooks: `useMondayEvents` (721 lines), others 50-150 lines each

**contexts/**
- Purpose: Global application state
- Contains: `SettingsContext` for persistent configuration
- Accessed via: `useSettings()` hook from components/hooks

**utils/**
- Purpose: Pure utility functions, no React
- Contains: API integration, error handling, data transformation
- Key file: `mondayApi.js` (1037 lines) - all Monday API calls
- Key file: `logger.js` (297 lines) - comprehensive logging system

**constants/**
- Purpose: Immutable configuration
- Contains: Calendar setup, holiday dates
- Key file: `calendarConfig.jsx` exports: `localizer`, `hebrewMessages`, `formats`, `WorkWeekView`, `roundToNearest15Minutes`

**styles/**
- Purpose: CSS organization
- Pattern: CSS Modules for component styling + calendar-specific overrides
- Hierarchy: Global → Calendar structure → Component overrides

## Key File Locations

**Entry Points:**
- `src/index.jsx`: React DOM mount, global error setup
- `src/init.js`: Global polyfills (`window.global`)
- `src/App.jsx`: SettingsProvider wrapper, context setup
- `src/MondayCalendar.jsx`: Main calendar interface (renders calendar, modals, handlers)

**Configuration:**
- `src/contexts/SettingsContext.jsx`: Column IDs, board IDs, structure modes, persistence
- `src/constants/calendarConfig.jsx`: Calendar UI setup (localizer, formats, time ranges)
- `src/constants/holidayConfig.js`: Israeli holiday dates

**Core Logic:**
- `src/utils/mondayApi.js`: All GraphQL queries and mutations
- `src/hooks/useMondayEvents.js`: Event CRUD, loading, filtering
- `src/utils/errorHandler.js`: Error parsing and messages

**Forms/Modals:**
- `src/components/EventModal/EventModal.jsx`: Timed event form (496 lines)
- `src/components/AllDayEventModal/AllDayEventModal.jsx`: All-day event form
- `src/components/SettingsDialog/SettingsDialog.jsx`: Settings UI with tabs

**Testing:**
- No test files detected - not configured

## Naming Conventions

**Files:**
- Components: `PascalCase.jsx` (e.g., `EventModal.jsx`)
- Hooks: `camelCase.js` with `use` prefix (e.g., `useMondayEvents.js`)
- Utilities: `camelCase.js` (e.g., `mondayApi.js`)
- Constants: `camelCase.js` (e.g., `calendarConfig.jsx`)
- Styles: `ComponentName.module.css` for modules, `index.css` for globals

**Directories:**
- Components: `PascalCase/` (e.g., `EventModal/`)
- Utilities: `utils/`
- Hooks: `hooks/`
- Contexts: `contexts/`
- Constants: `constants/`
- Styles: `styles/`

**Functions:**
- Regular: `camelCase` (e.g., `parseHourColumn`)
- React hooks: `camelCase` with `use` prefix (e.g., `useProjects`)
- Query/mutation builders: `camelCase` (e.g., `createBoardItem`)
- Utilities: `camelCase` (e.g., `parseDuration`)

**Variables:**
- Component state: `camelCase` (e.g., `selectedProject`, `isLoading`)
- Constants: `UPPER_CASE` (e.g., `ALL_DAY_EVENT_TYPES`)
- Objects: `camelCase` (e.g., `columnIds`)

**CSS Classes:**
- Modules: camelCase (e.g., `styles.container`, `styles.modalOverlay`)
- Semantic: lowercase with hyphens from react-big-calendar (e.g., `rbc-calendar`, `rbc-time-slot`)

## Where to Add New Code

**New Feature (e.g., Reports, Analytics):**
- Primary code: `src/hooks/useNewFeature.js` (logic) + `src/components/FeatureName/FeatureName.jsx` (UI)
- Tests: Create `src/hooks/__tests__/useNewFeature.test.js` (if testing added)
- Styling: `src/components/FeatureName/FeatureName.module.css`

**New Component/Modal:**
- Implementation: `src/components/ComponentName/ComponentName.jsx`
- Styles: `src/components/ComponentName/ComponentName.module.css`
- Export: `src/components/ComponentName/index.js` with `export { default } from './ComponentName'`
- Import in parent: `import ComponentName from './components/ComponentName'`

**New Hook:**
- Implementation: `src/hooks/useNewHook.js`
- Pattern: `export const useNewHook = () => { return { /* state */ }; }`
- Usage: Import in components: `const { state } = useNewHook()`

**New Utility Function:**
- Implementation: `src/utils/newUtility.js` or add to existing file
- Pattern: Pure functions, no React, no side effects
- Logging: Use `logger` from `src/utils/logger.js`
- Error handling: Throw errors, let caller handle

**New Monday API Call:**
- Location: `src/utils/mondayApi.js`
- Pattern: Wrap in `wrapMondayApiCall(functionName, apiRequest, apiCall)`
- Query/variables: Extract operationName using `extractOperationName(query)`
- Return: `Promise<{response, duration}>` or throw `MondayApiError`

**New Constants:**
- Global config: `src/constants/calendarConfig.jsx` or new file
- Dates: `src/constants/holidayConfig.js`
- Enums: `src/contexts/SettingsContext.jsx` (e.g., `STRUCTURE_MODES`)

**New Style:**
- Component-specific: `src/components/ComponentName/ComponentName.module.css`
- Calendar overrides: `src/styles/calendar/components/[name].css`
- Global: `src/styles/index.css`

## Special Directories

**src/styles/**
- Purpose: Centralized styling with CSS Modules
- Generated: No (all hand-written)
- Committed: Yes
- Structure:
  - `index.css`: Global styles
  - `calendar/index.css`: react-big-calendar overrides
  - `calendar/components/`: Specific component overrides
  - `calendar/structure/`: Layout and structure styles

**src/components/SettingsDialog/**
- Purpose: Multi-tab settings interface
- Files:
  - `SettingsDialog.jsx`: Main dialog, tab navigation
  - `StructureTab.jsx`: Structure mode selection
  - `MappingTab.jsx`: Column ID mapping
  - `SearchableSelect.jsx`: Reusable dropdown (columns, boards)
  - `MultiSelect.jsx`: Multi-select widget (people columns)
  - `useSettingsValidation.js`: Settings validation logic

**src/hooks/ (Core Hooks)**
- `useMondayEvents.js`: Event CRUD engine - core of app
  - Functions: `loadEvents`, `createEvent`, `updateEvent`, `deleteEvent`, `updateEventPosition`, `addEvent`
  - Handles: Pagination, filtering, date range loading
  - Returns: `{ events, loading, error, ... }`

- `useEventModals.js`: Modal state machine
  - State: `eventModal`, `allDayModal` with separate edit modes
  - Functions: `openEventModal`, `openAllDayModal`, `closeAllModals`, etc.

- `useCalendarHandlers.js`: Calendar interaction handlers
  - Functions: `onEventDrop`, `onEventResize`, `onSelectSlot`, `onSelectEvent`
  - Logic: Validation, optimistic updates, scroll locking

## Column Configuration System

Settings in `SettingsContext` define Monday board structure:

```javascript
// Example mapping for PROJECT_WITH_STAGE structure:
customSettings = {
  connectedBoardId: "1234567",           // Projects board
  dateColumnId: "date_column_1",         // When event happened
  durationColumnId: "duration_1",        // How long (hours/days)
  projectColumnId: "connect_boards_1",   // Link to project
  taskColumnId: "connect_boards_2",      // Link to task
  stageColumnId: "status_field_1",       // Classification/stage
  eventTypeStatusColumnId: "status_field_2", // Billable/non-billable
  nonBillableStatusColumnId: "status_field_3", // Non-billable type
  reporterColumnId: "people_field_1",    // Who reported
  notesColumnId: "text_field_1"          // Free-text notes
}
```

This configuration is:
1. Set in SettingsDialog
2. Validated in `settingsValidator.js`
3. Stored in `monday.storage.instance`
4. Loaded on app start in `SettingsContext`
5. Used by all components/hooks via `useSettings()`

---

*Structure analysis: 2026-01-25*
