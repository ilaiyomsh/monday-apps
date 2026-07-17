import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewTracking } from '@axis/app-core';
import logger from '../../logger';
import { safeApi } from '../client.js';

// Locks the Axiom logging v2 CALL SITES wired into tracker (the logger/sink primitives
// themselves are locked separately by #243). Uses the global mocked logger (setupTests.js),
// whose track()/health() are vi.fn spies that also emit through the fan-out.

describe('safeApi api-latency health (v2 call sites)', () => {
  beforeEach(() => {
    logger.health.mockClear();
  });

  it('emits health("api_ok", {tag, bucket}) on a successful call', async () => {
    const monday = { api: vi.fn().mockResolvedValue({ data: { ok: true } }) };
    await safeApi(monday, 'lockOkCall', 'query { me { id } }');

    const okCall = logger.health.mock.calls.find(([signal]) => signal === 'api_ok');
    expect(okCall).toBeTruthy();
    expect(okCall[0]).toBe('api_ok');
    expect(okCall[1]).toEqual(expect.objectContaining({ tag: 'lockOkCall' }));
    // latency is a coarse bucket (not raw ms) so the transport can dedup it
    expect(['fast', 'ok', 'slow', 'very_slow']).toContain(okCall[1].bucket);
    // never api_fail on the success path
    expect(logger.health.mock.calls.some(([s]) => s === 'api_fail')).toBe(false);
  });

  it('emits health("api_fail", {tag, bucket, err_code}) on a terminal (non-retryable) failure', async () => {
    const boom = Object.assign(new Error('boom'), { errorCode: 'TEST_CODE' });
    const monday = { api: vi.fn().mockRejectedValue(boom) };

    await expect(safeApi(monday, 'lockFailCall', 'query { me { id } }')).rejects.toThrow();

    const failCall = logger.health.mock.calls.find(([signal]) => signal === 'api_fail');
    expect(failCall).toBeTruthy();
    expect(failCall[1]).toEqual(expect.objectContaining({ tag: 'lockFailCall', err_code: 'TEST_CODE' }));
    expect(['fast', 'ok', 'slow', 'very_slow']).toContain(failCall[1].bucket);
  });
});

describe('useViewTracking (v2 usage call site)', () => {
  beforeEach(() => {
    logger.track.mockClear();
  });

  it('reports view_open at most once per session for a given view', () => {
    // Distinct view name so the module-scoped per-session dedup is deterministic here.
    const view = 'lock_test_view';
    const { rerender, unmount } = renderHook(() => useViewTracking(logger, view));
    rerender();
    unmount();
    // Second mount in the same session must NOT re-track (dedup keyed by logger+view).
    renderHook(() => useViewTracking(logger, view));

    const opens = logger.track.mock.calls.filter(
      ([event, dims]) => event === 'view_open' && dims?.view === view
    );
    expect(opens).toHaveLength(1);
  });
});
