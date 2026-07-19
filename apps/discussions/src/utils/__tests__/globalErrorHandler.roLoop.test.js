import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// round163 — the global uncaught-error handler must SWALLOW the benign
// "ResizeObserver loop completed with undelivered notifications" browser
// warning (recharts' ResponsiveContainer is a common source) so it never
// surfaces as a user-facing "אירעה שגיאה" toast, while a REAL uncaught error
// still reaches the logger.

const logSpy = vi.fn();
vi.mock('../logger', () => ({ default: { error: (...a) => logSpy(...a) } }));
vi.mock('../lazyRetry', () => ({ handleGlobalChunkError: () => false }));

import { setupGlobalErrorHandlers } from '../globalErrorHandler.js';

beforeAll(() => { setupGlobalErrorHandlers(); }); // attach the window listeners once
beforeEach(() => { logSpy.mockClear(); });

describe('globalErrorHandler — ResizeObserver loop filter', () => {
  it('ignores the benign "ResizeObserver loop" error (no log → no toast)', () => {
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications',
      error: null,
    }));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('still logs a real uncaught error', () => {
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'boom',
      error: new Error('boom'),
    }));
    expect(logSpy).toHaveBeenCalled();
  });
});
