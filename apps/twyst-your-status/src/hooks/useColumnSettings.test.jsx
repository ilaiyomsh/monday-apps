/**
 * useColumnSettings — the picker's storage read, and the two things that made it
 * the slowest part of a warm open.
 *
 * Counted, not timed: every assertion here is on the NUMBER of
 * monday.storage.getItem calls and on object identity. Both are exact, so a
 * regression cannot hide inside a plausible-looking wall clock.
 *
 * `monday.storage.getItem` is counted by wrapping the dev-harness SDK factory
 * rather than by mocking it — the false-empty race, the response envelope and
 * the 350ms retry are the behaviour under test, so the real stub has to run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { harness } from '../dev-harness/monday-sdk-stub.js';
import useColumnSettings from './useColumnSettings.js';

/** Hoisted so the vi.mock factory below can close over it. */
const { getItemCalls } = vi.hoisted(() => ({ getItemCalls: [] }));

vi.mock('monday-sdk-js', async () => {
  const actual = await vi.importActual('monday-sdk-js');
  return {
    ...actual,
    default: (...args) => {
      const client = actual.default(...args);
      const realGetItem = client.storage.getItem.bind(client.storage);
      client.storage.getItem = (key) => {
        getItemCalls.push(key);
        return realGetItem(key);
      };
      return client;
    },
  };
});

// The recorded probe's board/column (src/test-utils/probes/status-column-context.json).
// Deliberately NOT the ids harness.reset() pre-seeds settings for
// (global:twystStatus:1234567890:status) — a test that leans on that hidden seed
// stops meaning what it says the moment the seed changes.
const BOARD_ID = '18423828028';
const COLUMN_ID = 'status_guard';

// mondayService.getColumnConfig reads `twystStatus:<boardId>:<columnId>`, which the
// stub scopes to `global:<key>`. seedStorage does NOT re-scope — seed the scoped key.
const STORAGE_KEY = `global:twystStatus:${BOARD_ID}:${COLUMN_ID}`;

const context = { boardId: BOARD_ID, columnId: COLUMN_ID, itemId: '12632784783' };

/** A configured v1 settings object, in migrateSettings' own key order. */
const validV1 = () => ({
  version: 1,
  hiddenLabelIds: ['1'],
  labels: {
    2: {
      allowedUserIds: ['11111111'],
      allowedTeamIds: [],
      requiredColumnIds: [],
      requiredPeopleColumnIds: [],
    },
  },
});

beforeEach(() => {
  harness.reset();
  harness.failures.latencyMs = 0;
  getItemCalls.length = 0;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('useColumnSettings — the false-empty retry has ONE owner', () => {
  it('reads storage twice, not four times, before calling a column unconfigured', async () => {
    vi.useFakeTimers();
    // No seed, no false-empty toggle: storage is genuinely empty, which is the
    // common case (nobody has configured this column) and the one that used to
    // cost two stacked 350ms retries — one in mondayService, one in this hook.

    const { result } = renderHook(() => useColumnSettings(context));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    // One read, one 350ms wait, one more read — and the answer is in.
    expect(getItemCalls).toHaveLength(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.settings).toBe(null);
    expect(result.current.error).toBe(null);

    // And nothing reads again afterwards.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(getItemCalls).toHaveLength(2);
  });

  it('still recovers a populated key from a false-empty first read, in the same two reads', async () => {
    // This is what keeps the retry deletion honest: the retry MOVED, it did not
    // go away. Delete the hook's retry too and this test fails with a
    // configured column reported as unconfigured — the blank-settings incident.
    vi.useFakeTimers();
    harness.seedStorage(STORAGE_KEY, validV1());
    harness.failures.storageFalseEmptyFirstRead = true;

    const { result } = renderHook(() => useColumnSettings(context));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.settings).toEqual(validV1());
    expect(getItemCalls).toHaveLength(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });
});
