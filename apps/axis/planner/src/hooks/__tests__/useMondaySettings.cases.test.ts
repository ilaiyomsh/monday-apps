import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getMondayMock } from '../../test-utils/mondayMock';

vi.mock('monday-sdk-js', () => ({ default: () => getMondayMock() }));

import { useMondaySettings } from '../useMondaySettings';

const SETTINGS_KEY = 'planner_app_settings';
const SILENT_RELOAD_FLAG = 'planner_silent_reload_done';

const validStoredSettings = {
  allocationsBoardId: 'b1',
  employeesBoardId: 'b2',
  startDateColumnId: 'sd',
  endDateColumnId: 'ed',
  hoursPerDayColumnId: 'hpd',
  projectColumnId: 'proj',
  employeeColumnId: 'emp',
  roleColumnId: 'role',
  employeeNameColumnId: 'en',
  employeeRoleColumnId: 'er',
  employeeAllocationPercentColumnId: 'ea',
  employeeUserIdColumnId: 'eu',
};

// jsdom defaults hostname to 'localhost' which puts the hook in dev mode
// (returns mock board IDs on empty storage). Force non-localhost so tests
// exercise the production branches.
const originalLocation = window.location;
beforeEach(() => {
  getMondayMock().__reset();
  // Block the hook's silent-reload escape hatch so reload() can't run in jsdom.
  try { sessionStorage.setItem(SILENT_RELOAD_FLAG, '1'); } catch { /* ignore */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, hostname: 'app.monday.com', reload: vi.fn() },
  });
});

afterEach(() => {
  vi.useRealTimers();
  try { sessionStorage.removeItem(SILENT_RELOAD_FLAG); } catch { /* ignore */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('useMondaySettings — three load outcomes', () => {
  describe('Case 1: storage returns settings — app loads normally', () => {
    it('parses stored JSON, populates settings, isConfigured=true, no error', async () => {
      getMondayMock().__seedStorage(SETTINGS_KEY, validStoredSettings);

      const { result } = renderHook(() => useMondaySettings());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBeNull();
      expect(result.current.errorKind).toBeNull();
      expect(result.current.settings).not.toBeNull();
      expect(result.current.settings?.allocationsBoardId).toBe('b1');
      expect(result.current.settings?.employeesBoardId).toBe('b2');
      expect(result.current.isConfigured).toBe(true);
    });
  });

  describe('Case 2: storage success but value is null — new/unconfigured instance', () => {
    it('returns DEFAULT_SETTINGS, isConfigured=false, no error', async () => {
      // Mock returns { data: { value: null, success: true } } when key is absent.
      const { result } = renderHook(() => useMondaySettings());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBeNull();
      expect(result.current.errorKind).toBeNull();
      expect(result.current.settings).not.toBeNull();
      // DEFAULT_SETTINGS has empty board IDs → must NOT be considered configured.
      expect(result.current.settings?.allocationsBoardId).toBe('');
      expect(result.current.settings?.employeesBoardId).toBe('');
      expect(result.current.isConfigured).toBe(false);
    });
  });

  describe('Case 3a: storage throws on every attempt — network error', () => {
    it('surfaces error, errorKind=network, leaves settings=null (no silent fallback to defaults)', async () => {
      vi.useFakeTimers();
      const mock = getMondayMock();
      // Replace getItem to reject immediately every call.
      mock.storage.instance.getItem = vi.fn().mockRejectedValue(new Error('fetch failed'));

      const { result } = renderHook(() => useMondaySettings());

      // Drain the retry loop: backoffs are 250 + 750 + 1500 = 2500ms.
      await vi.advanceTimersByTimeAsync(3000);
      vi.useRealTimers();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(String(result.current.error)).toMatch(/Storage unreachable/);
      expect(result.current.errorKind).toBe('network');
      // Critical: settings must NOT be silently set to defaults — that would
      // let the App render the "new instance" welcome screen instead of the error.
      expect(result.current.settings).toBeNull();
      expect(result.current.isConfigured).toBe(false);
    });
  });

  describe('Case 3b: storage times out on every attempt — network error', () => {
    it('classifies hangs as network errors', async () => {
      vi.useFakeTimers();
      const mock = getMondayMock();
      // Return a never-resolving promise — withTimeout will fire after 5s.
      mock.storage.instance.getItem = vi.fn().mockImplementation(
        () => new Promise(() => { /* never settles */ })
      );

      const { result } = renderHook(() => useMondaySettings());

      // 4 attempts × 5000ms timeout + 250+750+1500 backoffs ≈ 22.5s.
      await vi.advanceTimersByTimeAsync(25_000);
      vi.useRealTimers();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(String(result.current.error)).toMatch(/Storage unreachable/);
      expect(String(result.current.error)).toMatch(/timed out/);
      expect(result.current.errorKind).toBe('network');
      expect(result.current.settings).toBeNull();
    });
  });

  describe('Case 3c: storage responds success:false every time — non-network rejection', () => {
    it('classifies as unknown (channel worked, server rejected) and does NOT mark as network', async () => {
      vi.useFakeTimers();
      const mock = getMondayMock();
      mock.storage.instance.getItem = vi.fn().mockResolvedValue({
        data: { success: false, error: { code: 'denied' } },
      });

      const { result } = renderHook(() => useMondaySettings());

      await vi.advanceTimersByTimeAsync(3000);
      vi.useRealTimers();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(String(result.current.error)).toMatch(/Storage unreachable/);
      // success:false on every attempt → 'unknown' (channel is alive, request rejected).
      expect(result.current.errorKind).toBe('unknown');
      expect(result.current.settings).toBeNull();
    });
  });
});
