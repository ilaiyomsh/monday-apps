# Testing Patterns

**Analysis Date:** 2026-01-25

## Test Framework

**Status:** Not configured

**No active testing framework found:**
- No `.test.js`, `.spec.js`, or `__tests__` directories in `src/`
- No Jest, Vitest, Mocha, or Cypress config files present
- No test dependencies in package.json beyond `react-scripts` (legacy)
- Package.json test command points to `react-scripts test` but no tests are written
- No `coverage` threshold or reporting configuration

## Test Coverage

**Current Status:** 0% - No tests written

**Coverage Requirements:** Not enforced

**Why Testing is Absent:**
This is a Vite + React 18 application focused on Monday.com integration with:
- Heavy reliance on Monday SDK and GraphQL API (difficult to test without mocks)
- Complex calendar UI state tied to react-big-calendar library
- Multiple dependent hooks and context providers
- Manual testing workflow documented in CLAUDE.md

## Manual Testing Workflow

The project relies on manual testing per CLAUDE.md:

1. Load calendar, navigate between weeks
2. Create timed event (with project/task/stage based on structure mode)
3. Create all-day event (חופשה/מחלה/מילואים)
4. Edit existing event
5. Drag event to new time
6. Resize event
7. Delete event
8. Open settings, change settings, verify changes apply

## Testing Considerations for Future Implementation

### What Should Be Tested (if testing framework added)

**Unit Tests:**
- `src/utils/logger.js` - log levels, formatting, color output
- `src/utils/durationUtils.js` - date calculations, day diffs, duration parsing
- `src/utils/errorHandler.js` - error parsing, message mapping, code extraction
- `src/utils/dateFormatters.js` - date format conversions
- `src/utils/mondayColumns.js` - column value mapping and parsing
- `src/utils/eventTypeValidation.js` - event type validation rules

**Hook Tests (with mocks):**
- `src/hooks/useToast.js` - toast display, removal, error handling
- `src/hooks/useProjects.js` - project fetching and filtering
- `src/hooks/useTasks.js` - task creation and fetching
- `src/hooks/useNonBillableOptions.js` - option loading
- `src/hooks/useStageOptions.js` - stage option loading
- `src/hooks/useIsraeliHolidays.js` - holiday data loading

**Component Tests (with mocks):**
- `src/components/Toast/Toast.jsx` - toast display and lifecycle
- `src/components/ConfirmDialog/ConfirmDialog.jsx` - confirmation UI
- `src/components/CustomEvent/CustomEvent.jsx` - event rendering
- `src/components/TimeSelect/TimeSelect.jsx` - time selection UI
- `src/components/SettingsDialog/` - settings form state and validation

**Integration Tests (with mocked Monday SDK):**
- Event CRUD operations (`createBoardItem`, `updateItemColumnValues`, `deleteItem`)
- Modal workflows (open → fill form → submit)
- Calendar drag-and-drop operations
- Event filtering by date range
- Settings validation and application

**What Should NOT Be Tested:**
- Monday SDK integration (use API mocks instead)
- react-big-calendar internals (trust library)
- Browser calendar rendering details
- Network calls (mock all API responses)

### Mocking Strategy

**What Needs Mocking:**

1. **Monday SDK** - All `monday` object calls:
   ```javascript
   const mockMonday = {
     get: jest.fn(),
     api: jest.fn(),
     listen: jest.fn(),
     storage: { instance: { getItem: jest.fn(), setItem: jest.fn() } }
   };
   ```

2. **GraphQL Responses** - Use `src/utils/mondayApi.js` as template:
   ```javascript
   const mockBoardResponse = {
     data: {
       boards: [{
         id: 'board_123',
         name: 'Test Board',
         columns: [...]
       }]
     }
   };
   ```

3. **Context Providers** - Wrap test components with:
   ```javascript
   <SettingsProvider monday={mockMonday}>
     <Component />
   </SettingsProvider>
   ```

4. **Hooks with Side Effects** - Mock external dependencies:
   - `useProjects` depends on Monday API
   - `useMondayEvents` depends on Monday API + SettingsContext
   - `useEventModals` manages internal state (safe to test)

### Error Scenarios to Test

**API Errors (from `src/utils/errorHandler.js`):**
- `USER_UNAUTHORIZED` → "אין לך הרשאות..."
- `ResourceNotFoundException` → "אחת העמודות..."
- `ComplexityBudgetExhausted` → "העומס על המערכת..." (canRetry: true)
- `InternalServerError` → "אירעה תקלה..." (canRetry: true)
- Rate limiting scenarios → "חרגת ממגבלת..."

**Validation Errors:**
- Invalid date ranges
- Missing required columns
- Invalid duration values
- Unsupported event types

## Code Patterns to Enable Testing

**Dependency Injection Pattern (partially observed):**
- Hooks accept `monday` and `context` parameters, enabling mock passing
- Components accept `monday` prop

**Testable Utility Functions:**
- Pure functions in `src/utils/` are independently testable
- Error parser is pure and deterministic
- Duration calculations are pure math

**Areas Difficult to Test (as written):**
- Direct Monday SDK calls without wrapper (use middleware pattern)
- Tightly coupled context usage (consider useCallback with dependencies)
- Large components with multiple responsibilities (consider splitting modals)

## Recommended Testing Stack (if implemented)

**Framework:** Jest or Vitest
- Jest: Better ecosystem for React, more mature
- Vitest: Faster, better Vite integration

**Dependencies:**
```json
{
  "@testing-library/react": "^14.0.0",
  "@testing-library/jest-dom": "^6.0.0",
  "@testing-library/user-event": "^14.0.0",
  "jest": "^29.0.0",
  "jest-environment-jsdom": "^29.0.0",
  "@babel/preset-react": "^7.0.0"
}
```

**Config Example (vite.config.test.js):**
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/']
    }
  }
});
```

**Test File Naming Convention (recommended):**
```
src/utils/logger.js         → src/utils/logger.test.js
src/hooks/useToast.js       → src/hooks/useToast.test.js
src/components/Toast/Toast.jsx → src/components/Toast/Toast.test.jsx
```

## Test Structure Examples (if implemented)

### Unit Test Pattern
```javascript
// src/utils/durationUtils.test.js
import { calculateDaysDiff, isAllDayEventType, calculateEndDateFromDays } from './durationUtils';

describe('durationUtils', () => {
  describe('isAllDayEventType', () => {
    it('should return true for all-day event types', () => {
      expect(isAllDayEventType('חופשה')).toBe(true);
      expect(isAllDayEventType('מחלה')).toBe(true);
      expect(isAllDayEventType('מילואים')).toBe(true);
    });

    it('should return false for timed event types', () => {
      expect(isAllDayEventType('שעתי')).toBe(false);
      expect(isAllDayEventType('other')).toBe(false);
    });
  });

  describe('calculateDaysDiff', () => {
    it('should calculate difference between dates', () => {
      const start = new Date('2026-01-25');
      const end = new Date('2026-01-28');
      expect(calculateDaysDiff(start, end)).toBe(3);
    });

    it('should return minimum 1 day', () => {
      const start = new Date('2026-01-25');
      expect(calculateDaysDiff(start, start)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('calculateEndDateFromDays', () => {
    it('should calculate exclusive end date', () => {
      const start = new Date('2026-01-25');
      const end = calculateEndDateFromDays(start, 3);
      // Should be 2026-01-28 at 00:00 (exclusive)
      expect(end.getDate()).toBe(28);
      expect(end.getHours()).toBe(0);
    });
  });
});
```

### Hook Test Pattern
```javascript
// src/hooks/useToast.test.js
import { renderHook, act } from '@testing-library/react';
import { useToast } from './useToast';

describe('useToast', () => {
  it('should initialize with empty toasts', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it('should add toast on showSuccess', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showSuccess('Test message');
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Test message');
    expect(result.current.toasts[0].type).toBe('success');
  });

  it('should remove toast', () => {
    const { result } = renderHook(() => useToast());
    let toastId;

    act(() => {
      toastId = result.current.showSuccess('Test');
    });

    act(() => {
      result.current.removeToast(toastId);
    });

    expect(result.current.toasts).toHaveLength(0);
  });
});
```

### Component Test Pattern
```javascript
// src/components/Toast/Toast.test.jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toast from './Toast';

describe('Toast', () => {
  it('should display message', () => {
    render(<Toast message="Test message" type="success" duration={5000} onClose={() => {}} />);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('should auto-hide after duration', async () => {
    const { container } = render(
      <Toast message="Test" type="info" duration={100} onClose={() => {}} />
    );

    await waitFor(() => {
      expect(container.firstChild).not.toBeInTheDocument();
    }, { timeout: 500 });
  });

  it('should call onClose when dismissed', async () => {
    const handleClose = jest.fn();
    render(<Toast message="Test" type="success" duration={0} onClose={handleClose} />);

    const closeButton = screen.getByRole('button');
    await userEvent.click(closeButton);

    expect(handleClose).toHaveBeenCalled();
  });
});
```

### Error Handler Test Pattern
```javascript
// src/utils/errorHandler.test.js
import { parseMondayError, createFullErrorObject } from './errorHandler';

describe('errorHandler', () => {
  describe('parseMondayError', () => {
    it('should parse GraphQL error response', () => {
      const response = {
        errors: [{
          message: 'User is unauthorized',
          extensions: {
            code: 'USER_UNAUTHORIZED',
            status_code: 401
          }
        }]
      };

      const result = parseMondayError(null, response);

      expect(result.errorCode).toBe('USER_UNAUTHORIZED');
      expect(result.userMessage).toContain('אין לך הרשאות');
      expect(result.canRetry).toBe(false);
    });

    it('should parse HTTP errors with status code mapping', () => {
      const error = { status: 429 };
      const result = parseMondayError(error);

      expect(result.errorCode).toBe('Rate Limit Exceeded');
      expect(result.canRetry).toBe(true);
    });

    it('should extract operation name from query', () => {
      const apiRequest = {
        query: 'mutation CreateItem { create_item(...) { id } }'
      };

      const result = parseMondayError(
        new Error('Test'),
        null,
        apiRequest
      );

      expect(result.apiRequest.operationName).toBe('CreateItem');
    });
  });
});
```

---

*Testing analysis: 2026-01-25*

**Note:** This codebase currently has no automated tests. These patterns serve as recommendations for future test implementation. The project currently relies on manual testing workflows as documented in CLAUDE.md.
