import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { harness } from '../dev-harness/monday-sdk-stub.js';
import mondayService from '../services/mondayService.js';
import logger from '../utils/logger.js';
import useColumnSettings from './useColumnSettings.js';

// A complete, valid v1 settings object as it is persisted in global storage
// (per probes/MANIFEST.md — the real seeded board/column ids).
const validV1 = () => ({
  version: 1,
  relationColumnId: 'board_relation_mm56dy57',
  linkedBoardId: '18421604791',
  peopleColumnId: 'multiple_person_mm5694pg',
  policy: { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true },
});

// mondayService.getColumnConfig(boardId, columnId) resolves to
// monday.storage.getItem('teamPeople:<boardId>:<columnId>'), which the stub
// scopes to `global:<key>`. harness.seedStorage does NOT re-scope, so we seed
// under the already-scoped key.
const STORAGE_KEY = 'global:teamPeople:18421604809:team_people_col';

const context = { boardId: '18421604809', itemId: '12511436134', columnId: 'team_people_col' };

beforeEach(() => {
  harness.reset();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useColumnSettings — false-empty first-read race', () => {
  it('starts in the loading state before any read resolves', () => {
    vi.useFakeTimers();
    harness.failures.latencyMs = 0;
    harness.seedStorage(STORAGE_KEY, validV1());
    harness.failures.storageFalseEmptyFirstRead = true;

    const { result } = renderHook(() => useColumnSettings(context));
    expect(result.current.loading).toBe(true);
    expect(result.current.settings).toBe(null);
  });

  it('retries once and resolves the seeded settings instead of trusting the transient null (would be unconfigured with a single read)', async () => {
    vi.useFakeTimers();
    harness.failures.latencyMs = 0;
    harness.seedStorage(STORAGE_KEY, validV1());
    harness.failures.storageFalseEmptyFirstRead = true;

    const { result } = renderHook(() => useColumnSettings(context));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.settings).toEqual(validV1());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('does not resolve before the ~350ms retry window elapses, then resolves after it', async () => {
    vi.useFakeTimers();
    harness.failures.latencyMs = 0;
    harness.seedStorage(STORAGE_KEY, validV1());
    harness.failures.storageFalseEmptyFirstRead = true;

    const { result } = renderHook(() => useColumnSettings(context));

    // First (false-empty) read has completed; the retry timer has NOT fired yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.settings).toBe(null);
    expect(result.current.loading).toBe(true);

    // Cross the retry boundary — the second read now serves the seeded value.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.settings).toEqual(validV1());
    expect(result.current.loading).toBe(false);
  });
});

describe('useColumnSettings — genuinely empty storage', () => {
  it('resolves settings to null (unconfigured) after the retry when storage is truly empty', async () => {
    vi.useFakeTimers();
    harness.failures.latencyMs = 0;
    // No seed, no false-empty toggle: both reads legitimately return null.

    const { result } = renderHook(() => useColumnSettings(context));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.settings).toBe(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });
});

describe('useColumnSettings — storage hard error', () => {
  it('surfaces the error and logs it exactly once (never swallowed)', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const boom = new Error('boom: storage unavailable');
    // A hard failure: the service rejects on every attempt (a retry-on-error
    // bug would then log twice — the times(1) assertion catches it).
    vi.spyOn(mondayService, 'getColumnConfig').mockRejectedValue(boom);

    const { result } = renderHook(() => useColumnSettings(context));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(boom);
    expect(result.current.settings).toBe(null);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useColumnSettings — reload', () => {
  it('re-reads storage on reload() and picks up settings seeded after the first (empty) load', async () => {
    vi.useFakeTimers();
    harness.failures.latencyMs = 0;

    const { result } = renderHook(() => useColumnSettings(context));

    // First load: storage empty -> settings stays null.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.settings).toBe(null);

    // Settings become available; reload() must surface them.
    harness.seedStorage(STORAGE_KEY, validV1());
    await act(async () => {
      result.current.reload();
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.settings).toEqual(validV1());
    expect(result.current.loading).toBe(false);
  });
});
