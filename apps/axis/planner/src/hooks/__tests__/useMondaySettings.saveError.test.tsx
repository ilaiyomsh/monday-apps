import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { getMondayMock } from '../../test-utils/mondayMock';

vi.mock('monday-sdk-js', () => ({ default: () => getMondayMock() }));

import { useMondaySettings } from '../useMondaySettings';
import { logger } from '../../utils/Logger';

// Locks the observability fix in saveSettings: a save failure now also ships to Axiom
// (logger.error) in addition to the in-dialog setError — previously it was display-only.

const SILENT_RELOAD_FLAG = 'planner_silent_reload_done';
const validSettings = {
  allocationsBoardId: 'b1',
  employeesBoardId: 'b2',
} as never;

const originalLocation = window.location;
beforeEach(() => {
  getMondayMock().__reset();
  try { sessionStorage.setItem(SILENT_RELOAD_FLAG, '1'); } catch { /* ignore */ }
  // Force non-localhost so saveSettings exercises the production storage branch (not the
  // dev short-circuit that returns true without touching storage).
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, hostname: 'app.monday.com', reload: vi.fn() },
  });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.restoreAllMocks();
});

describe('useMondaySettings.saveSettings failure observability', () => {
  it('logs an ERROR and returns false when the storage setItem rejects', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(getMondayMock().storage.instance, 'setItem').mockRejectedValue(new Error('storage down'));

    const { result } = renderHook(() => useMondaySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveSettings(validSettings);
    });

    expect(ok).toBe(false);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('saveSettings failed'))).toBe(true);
  });

  it('does NOT log an error when the save succeeds', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useMondaySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveSettings(validSettings);
    });

    expect(ok).toBe(true);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('saveSettings failed'))).toBe(false);
  });
});
