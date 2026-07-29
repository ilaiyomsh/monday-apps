/**
 * Characterization tests for the toast QUEUE.
 *
 * Three behaviours here have already caused production bugs in the ported-from
 * apps and are the reason this file exists:
 *   1. ids come from a monotonic counter, NOT Date.now() — the error sink replays
 *      its buffer inside a single millisecond, and Date.now() ids collide, which
 *      React renders as one toast (duplicate `key`) and removeToast then wipes both.
 *   2. the error dedup window is a `<` comparison on a 2000ms window: a repeat at
 *      exactly the window edge must be ALLOWED (a stuck `<=` silently drops the
 *      second occurrence of a recurring failure).
 *   3. `showErrorWithDetails` is LOG-ONLY and must not double-log an error the
 *      logger already stamped — double logging means two toasts for one failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../useToast';
import logger from '../../utils/logger';

// The hook's only collaborator. Mocked so the ARGUMENTS of the single funnel call
// can be asserted (and so nothing prints during the run).
vi.mock('../../utils/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// The dedup constants live private in the module; mirrored here deliberately so a
// change to the source window shows up as a failing boundary test, not silently.
const DEDUP_WINDOW_MS = 2000;
const T0 = new Date('2026-07-29T09:00:00.000Z').getTime();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showToast / removeToast', () => {
  it('appends the toast with the documented default shape and returns its id', () => {
    const { result } = renderHook(() => useToast());

    let id;
    act(() => {
      id = result.current.showToast('הדוח הופק');
    });

    expect(result.current.toasts).toEqual([
      { id, message: 'הדוח הופק', type: 'info', duration: 3000, errorDetails: null },
    ]);
  });

  it('appends in call order rather than prepending', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('first');
    });
    act(() => {
      result.current.showToast('second');
    });

    expect(result.current.toasts.map((t) => t.message)).toEqual(['first', 'second']);
  });

  it('gives two toasts raised in the SAME millisecond different ids', () => {
    const { result } = renderHook(() => useToast());

    let a;
    let b;
    act(() => {
      // One act(), one frozen clock — exactly the sink's buffer-replay burst.
      a = result.current.showToast('a');
      b = result.current.showToast('b');
    });

    expect(Date.now()).toBe(T0); // the clock really did not move
    expect(a).not.toBe(b);
    expect(result.current.toasts.map((t) => t.id)).toEqual([a, b]);
  });

  it('removeToast removes only the matching toast', () => {
    const { result } = renderHook(() => useToast());

    let first;
    let second;
    let third;
    act(() => {
      first = result.current.showToast('first');
      second = result.current.showToast('second');
      third = result.current.showToast('third');
    });

    act(() => {
      result.current.removeToast(second);
    });

    expect(result.current.toasts.map((t) => t.id)).toEqual([first, third]);
  });

  it('removeToast with an unknown id leaves the queue untouched', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('only');
    });

    act(() => {
      result.current.removeToast('t-does-not-exist');
    });

    expect(result.current.toasts).toHaveLength(1);
  });
});

describe('error dedup window', () => {
  it('suppresses an identical error raised inside the window and returns null', () => {
    const { result } = renderHook(() => useToast());

    let first;
    let second;
    act(() => {
      first = result.current.showToast('אירעה שגיאה', 'error');
    });
    vi.setSystemTime(T0 + DEDUP_WINDOW_MS - 1); // 1999ms — still inside
    act(() => {
      second = result.current.showToast('אירעה שגיאה', 'error');
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(result.current.toasts).toHaveLength(1);
  });

  it('allows the identical error again at exactly the window edge', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('אירעה שגיאה', 'error');
    });
    vi.setSystemTime(T0 + DEDUP_WINDOW_MS); // exactly 2000ms — the window is `<`
    let second;
    act(() => {
      second = result.current.showToast('אירעה שגיאה', 'error');
    });

    expect(second).not.toBeNull();
    expect(result.current.toasts.map((t) => t.message)).toEqual([
      'אירעה שגיאה',
      'אירעה שגיאה',
    ]);
  });

  it('does NOT dedup non-error toasts raised in the same millisecond', () => {
    const { result } = renderHook(() => useToast());

    let a;
    let b;
    act(() => {
      a = result.current.showToast('מפיק דוח…', 'info');
      b = result.current.showToast('מפיק דוח…', 'info');
    });

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(result.current.toasts).toHaveLength(2);
  });

  it('does NOT dedup a success toast repeating the same message', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showSuccess('ההגדרות נשמרו');
      result.current.showSuccess('ההגדרות נשמרו');
    });

    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.toasts[0].type).toBe('success');
  });

  it('keys the dedup fingerprint on correlationId, so two distinct failures with one message both show', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('אירעה שגיאה', 'error', 3000, { correlationId: 'log_1' });
      result.current.showToast('אירעה שגיאה', 'error', 3000, { correlationId: 'log_2' });
      // Same correlationId as the first — this one IS a repeat.
      result.current.showToast('אירעה שגיאה', 'error', 3000, { correlationId: 'log_1' });
    });

    expect(result.current.toasts.map((t) => t.errorDetails.correlationId)).toEqual([
      'log_1',
      'log_2',
    ]);
  });

  it('a different error message inside the window is not suppressed', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showToast('שגיאה א', 'error');
      result.current.showToast('שגיאה ב', 'error');
    });

    expect(result.current.toasts.map((t) => t.message)).toEqual(['שגיאה א', 'שגיאה ב']);
  });
});

describe('showLoading / showInfo / showSuccess', () => {
  it('showLoading produces a loading toast with duration 0 (no auto-hide)', () => {
    const { result } = renderHook(() => useToast());

    let id;
    act(() => {
      id = result.current.showLoading('מפיק דוח…');
    });

    expect(result.current.toasts).toEqual([
      { id, message: 'מפיק דוח…', type: 'loading', duration: 0, errorDetails: null },
    ]);
  });

  it('showSuccess and showInfo carry their own types and the 3000ms default', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showSuccess('הדוח הופק');
      result.current.showInfo('מידע');
    });

    expect(result.current.toasts.map((t) => [t.type, t.duration])).toEqual([
      ['success', 3000],
      ['info', 3000],
    ]);
  });
});

describe('showErrorWithDetails (log-only facade)', () => {
  it('logs a fresh error through the single funnel with the caller-supplied functionName', () => {
    const { result } = renderHook(() => useToast());
    const error = new Error('kaboom');

    let returned;
    act(() => {
      returned = result.current.showErrorWithDetails(error, { functionName: 'generateReport' });
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('generateReport', 'kaboom', error);
    // LOG-ONLY: the display comes back around through useUiErrorSink, so this
    // facade must not push a toast itself.
    expect(returned).toBeNull();
    expect(result.current.toasts).toEqual([]);
  });

  it("defaults functionName to 'showErrorWithDetails' when the caller omits options", () => {
    const { result } = renderHook(() => useToast());
    const error = new Error('kaboom');

    act(() => {
      result.current.showErrorWithDetails(error);
    });

    expect(logger.error).toHaveBeenCalledWith('showErrorWithDetails', 'kaboom', error);
  });

  it('SKIPS the log when the error already carries __loggedId (one failure, one toast)', () => {
    const { result } = renderHook(() => useToast());
    const error = new Error('kaboom');
    Object.defineProperty(error, '__loggedId', { value: 'log_42', enumerable: false });

    act(() => {
      result.current.showErrorWithDetails(error, { functionName: 'generateReport' });
    });

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs 'unhandled_error' when the error has no message", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.showErrorWithDetails(null, { functionName: 'generateReport' });
    });

    expect(logger.error).toHaveBeenCalledWith('generateReport', 'unhandled_error', null);
  });
});

describe('error details modal state', () => {
  it('open stores the details and close clears them back to null', () => {
    const { result } = renderHook(() => useToast());
    const details = { module: 'Mod', message: 'stable_event_id', correlationId: 'log_1' };

    expect(result.current.errorDetailsModal).toBeNull();

    act(() => {
      result.current.openErrorDetailsModal(details);
    });
    expect(result.current.errorDetailsModal).toBe(details);

    act(() => {
      result.current.closeErrorDetailsModal();
    });
    expect(result.current.errorDetailsModal).toBeNull();
  });
});
