# Coding Conventions

**Analysis Date:** 2026-01-25

## Naming Patterns

**Files:**
- JSX components: PascalCase with `.jsx` extension (e.g., `EventModal.jsx`, `CustomEvent.jsx`)
- JavaScript utilities: camelCase with `.js` extension (e.g., `logger.js`, `mondayApi.js`, `durationUtils.js`)
- CSS modules: Paired with component using `.module.css` (e.g., `EventModal.module.css`)
- Barrel files: `index.js` or `index.js` in component directories exporting default (e.g., `src/components/EventModal/index.js`)
- Hooks: camelCase with `use` prefix (e.g., `useMondayEvents.js`, `useToast.js`, `useProjects.js`)

**Functions:**
- All functions use camelCase
- Hook functions: Prefixed with `use` (e.g., `useMondayEvents`, `useToast`, `useSettings`)
- API wrapper functions: Descriptive camelCase (e.g., `createBoardItem`, `updateItemColumnValues`, `fetchProjectsForUser`)
- Utility functions: Descriptive camelCase (e.g., `calculateDaysDiff`, `extractOperationName`, `parseMondayError`)

**Variables:**
- State variables: camelCase (e.g., `selectedTask`, `isLoading`, `customSettings`)
- Boolean flags: Prefixed with `is`, `has`, or `show` (e.g., `isOpen`, `hasValidatedSettings`, `showDeleteConfirm`, `isEditMode`)
- Constants: UPPER_SNAKE_CASE (e.g., `LOG_LEVELS`, `ALL_DAY_EVENT_TYPES`, `STRUCTURE_MODES`, `ERROR_MESSAGES`)
- Context/refs: camelCase (e.g., `SettingsContext`, `viewRangeRef`)

**Types/Interfaces:**
- JSDoc typedef: PascalCase with leading comment block
  ```javascript
  /**
   * @typedef {Object} CalendarEvent
   * @property {string} id - Monday item ID
   * @property {string} title - כותרת האירוע
   */
  ```
- Enum-like constants: UPPER_SNAKE_CASE values (e.g., `STRUCTURE_MODES.PROJECT_ONLY`)

## Code Style

**Formatting:**
- No linter/formatter enforced (no eslint or prettier config)
- Consistent with JavaScript conventions observed:
  - 4-space indentation (visible in all source files)
  - Single quotes in imports/strings (e.g., `import { default } from './EventModal'`)
  - Semicolons at end of statements
  - Trailing commas in objects/arrays

**Comments:**
- All comments are in **Hebrew** (entire codebase is Hebrew)
- JSDoc comments extensively used for functions, hooks, and complex logic
- Each function should have JSDoc block with:
  ```javascript
  /**
   * תיאור בעברית
   * @param {Type} paramName - תיאור הפרמטר
   * @returns {Type} תיאור ההחזרה
   */
  ```

**No Linting/Formatting Config:**
- No `.eslintrc`, `.prettierrc`, or `eslint` dependency
- Package.json includes: `"eslintConfig": { "extends": "react-app" }` (legacy, not actively used)
- Tests exist but no `test` command configured for linting

## Import Organization

**Order (observed pattern):**
1. React imports (React, hooks)
2. External libraries (react-big-calendar, date-fns, etc.)
3. Local utility functions (from `src/utils/`)
4. Local hooks (from `src/hooks/`)
5. Local context/state (from `src/contexts/`)
6. Local components (from `src/components/`)
7. Constants (from `src/constants/`)
8. Styles (CSS module imports)

**Example from `MondayCalendar.jsx`:**
```javascript
// React & hooks
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Calendar } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';

// Styles
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './styles/calendar/index.css';

// Constants & config
import { localizer, hebrewMessages, formats, roundToNearest15Minutes, WorkWeekView, CALENDAR_DEFAULTS } from './constants/calendarConfig';

// Utilities
import { getColumnIds } from './utils/mondayColumns';
import { validateSettings } from './utils/settingsValidator';
import logger from './utils/logger';

// Components
import EventModal from './components/EventModal/EventModal';
import AllDayEventModal from './components/AllDayEventModal/AllDayEventModal';

// Context
import { useSettings } from './contexts/SettingsContext';

// Hooks
import { useMondayEvents } from './hooks/useMondayEvents';
import { useToast } from './hooks/useToast';
```

**Path Aliases:**
- Not detected (no tsconfig.json or jsconfig.json with path aliases)
- Relative imports used throughout (e.g., `from '../../contexts/SettingsContext'`)

## Error Handling

**Pattern - Try/Catch with Logger:**
```javascript
try {
    await someApiCall();
} catch (error) {
    showErrorWithDetails(error, { functionName: 'myFunction' });
    logger.error('Module', 'Error message', error);
}
```

**Custom Error Class:**
- `MondayApiError` extends Error at `src/utils/mondayApi.js`
  - Properties: `response`, `apiRequest`, `errorCode`, `functionName`, `duration`, `timestamp`
  - Includes `toJSON()` method for serialization
  - Used for all Monday API call failures

**Error Parser:**
- `parseMondayError()` in `src/utils/errorHandler.js` decodes GraphQL/API errors
- Returns object with:
  - `userMessage` (Hebrew user-friendly message)
  - `errorCode` (standardized code from ERROR_MESSAGES mapping)
  - `fullDetails` (complete error info)
  - `canRetry` (boolean)
  - `actionRequired` (suggested action in Hebrew)
  - `apiRequest` (query and variables that were sent)

**Error Messages:**
- All user-facing error messages in Hebrew
- Comprehensive error mapping in `ERROR_MESSAGES` object (~25+ error codes)
- Maps HTTP status codes to error codes via `HTTP_STATUS_TO_ERROR_CODE`

## Logging

**Framework:** Custom logger at `src/utils/logger.js` (no external library)

**Patterns:**
```javascript
import logger from './utils/logger';

// Standard levels
logger.debug('ModuleName', 'Debug message', optionalData);
logger.info('ModuleName', 'Info message', optionalData);
logger.warn('ModuleName', 'Warning message', optionalData);
logger.error('ModuleName', 'Error message', errorObject);

// API-specific logging
logger.api('functionName', query, variables);
logger.apiResponse('functionName', response, duration);
logger.apiError('functionName', error);

// Function tracing
logger.functionStart('functionName', params);
logger.functionEnd('functionName', result);
```

**Log Levels (by environment):**
- Production: Only ERROR level shown
- Development: All levels shown (DEBUG, INFO, WARN, ERROR)
- Current level managed via `logger.setLevel()` or `logger.getLevel()`

**Runtime Control (in browser console):**
```javascript
enableDebugLogs()      // Enable all logs
disableDebugLogs()     // Disable to ERROR only
getLogLevel()          // Show current level
setLogLevel('INFO')    // Set specific level
```

**Log Format:**
```
[HH:MM:SS] [LEVEL] [ModuleName] message
```
With colored output in console (DEBUG=#6c757d, INFO=#0d6efd, WARN=#ffc107, ERROR=#dc3545)

## Function Design

**Size Guideline:** No explicit limit observed. Key files range 496-1551 lines:
- `MondayCalendar.jsx`: 1551 lines (main component, complex state management)
- `mondayApi.js`: 1037 lines (all GraphQL queries/mutations)
- `useMondayEvents.js`: 721 lines (hook with event CRUD logic)
- `EventModal.jsx`: 496 lines (modal component with form logic)

Large functions are documented with JSDoc and organized into logical sections.

**Parameters:**
- No default parameter values observed; parameters passed explicitly
- Destructuring used in component props:
  ```javascript
  export default function EventModal({
    isOpen,
    onClose,
    pendingSlot,
    onCreate,
    eventToEdit = null,
    ...
  }) { ... }
  ```

**Return Values:**
- Hooks return objects with properties:
  ```javascript
  return {
    events,
    loading,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent
  };
  ```
- Pure utility functions return specific types (Date, string, object, array)
- Components return JSX or null (if !isOpen pattern)

## Module Design

**Exports:**
- Barrel files use: `export { default } from './ComponentName'`
- Named exports from utilities: `export const functionName = (...) => { ... }`
- Default exports for main components and hooks
- Mixed pattern: `export default logger; export { LOG_LEVELS };`

**Component Structure:**
```
src/components/ComponentName/
├── ComponentName.jsx      (Main component logic)
├── ComponentName.module.css (CSS modules with scoped styles)
└── index.js              (Barrel export: `export { default } from './ComponentName'`)
```

**Hooks Structure:**
```
src/hooks/
├── useHookName.js        (Single file, no subdirectory)
├── useToast.js
├── useMondayEvents.js
└── ...
```

**Utilities Structure:**
```
src/utils/
├── logger.js             (Custom logging system)
├── mondayApi.js          (All GraphQL queries and mutations)
├── errorHandler.js       (Error parsing and mapping)
├── durationUtils.js      (Duration/date calculations)
├── dateFormatters.js     (Date formatting helpers)
└── ...
```

**Context/State:**
```
src/contexts/
├── SettingsContext.jsx   (Settings provider and hook)
└── ...
```

## Constants & Configuration

**Location:** `src/constants/`
- `calendarConfig.jsx` - Calendar setup (localizer, messages, formats, WorkWeekView, time utilities)
- `holidayConfig.js` - Israeli holiday definitions

**Environment Configuration:**
- Built with Vite (uses `import.meta.env.PROD` for production check)
- Fallback to `process.env.NODE_ENV` for compatibility
- No `.env` file pattern detected; settings stored in Monday's storage API

## CSS Modules

**Convention:** One `.module.css` per component, paired with `.jsx` file
- All styling scoped to component via CSS Modules
- Example selector usage:
  ```javascript
  import styles from './EventModal.module.css';
  <div className={styles.container}>
  <button className={`${styles.button} ${styles[type]}`}>
  ```

## React Patterns

**Hooks-based architecture:**
- No class components
- React 18.2.0 with functional components
- Custom hooks for logic extraction

**Props Drilling:**
- Extensive prop passing (especially in modals and forms)
- Props include callbacks like `onCreate`, `onClose`, `onUpdate`, `onDelete`
- Callback naming: `onEventName` or `setValueName`

**State Management:**
- Local `useState` within components
- SettingsContext for global settings
- Monday SDK for persistent storage (`monday.storage.instance`)
- No Redux/Zustand

**Modal Pattern (observed):**
```javascript
if (!isOpen) return null;
return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div className={styles.modal}>
            {/* content */}
        </div>
    </div>
);
```

---

*Convention analysis: 2026-01-25*
