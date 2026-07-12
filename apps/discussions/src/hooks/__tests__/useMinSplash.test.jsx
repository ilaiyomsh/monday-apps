import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMinSplash } from '../useMinSplash.js';

// Round 50 — the min-splash window is now ~2000ms by default so the branded
// loader is clearly experienced on boot + view transitions rather than flashing.
// Fake timers make the window deterministic.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useMinSplash — ≥2000ms minimum window (Round 50)', () => {
  it('defaults to ~2000ms: stays visible until 2s after an armed boot, then reveals', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useMinSplash(active),
      { initialProps: { active: true } },
    );
    // active=true (boot) → visible
    expect(result.current).toBe(true);
    // loading resolves right away, but the min window keeps it visible
    rerender({ active: false });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current).toBe(true);   // still < 2000ms
    act(() => { vi.advanceTimersByTime(2); });
    expect(result.current).toBe(false);  // window elapsed → revealed (proves the 2000ms default)
  });

  it('re-arms a full default window on an armKey (view) change and always resolves — never hangs', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useMinSplash(false, undefined, key),
      { initialProps: { key: 'discussions' } },
    );
    // false from mount + no key change yet → content shows immediately
    expect(result.current).toBe(false);
    // a view switch arms the default 2000ms window
    rerender({ key: 'myTasks' });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(false);  // resolves on its own → never stuck
  });

  it('honors an explicit ms argument', () => {
    const { result, rerender } = renderHook(
      ({ key }) => useMinSplash(false, 2500, key),
      { initialProps: { key: 'a' } },
    );
    rerender({ key: 'b' });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(2499); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(false);
  });
});
