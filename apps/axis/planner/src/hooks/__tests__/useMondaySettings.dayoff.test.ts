import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { getMondayMock } from '../../test-utils/mondayMock';
import type { PlannerSettings } from '../../types/settings.types';

vi.mock('monday-sdk-js', () => ({ default: () => getMondayMock() }));

import { useMondaySettings } from '../useMondaySettings';

const SETTINGS_KEY = 'planner_app_settings';
const SILENT_RELOAD_FLAG = 'planner_silent_reload_done';

/**
 * DAY-OFF-INTEGRATION W3.1 — additive day-off settings fields.
 *
 * Locks three guarantees:
 * 1. Defaults leave the new path entirely OFF (empty `dayOffBoardId` ⇒ legacy behavior).
 * 2. Pre-dayOff stored blobs load unchanged and merely gain the inert day-off
 *    defaults via merge-on-load.
 * 3. The new keys persist through the generic JSON save/load round trip.
 */

// A pre-W3.1 settings blob: configured boards + the legacy absence block,
// with NO dayOff* keys at all.
const legacyStoredSettings = {
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

const dayOffValues: Partial<PlannerSettings> = {
  dayOffBoardId: 'vacations-board',
  dayOffEmployeeColumnId: 'person',
  dayOffStartDateColumnId: 'date_from',
  dayOffEndDateColumnId: 'date_to',
  dayOffKindColumnId: 'kind_status',
  dayOffKindGeneralLabelId: '2',
  dayOffKindPersonalLabelId: '0',
  dayOffTypeColumnId: 'type_status',
  dayOffApprovalRequired: true,
  dayOffApprovalColumnId: 'approval_status',
  dayOffApprovedLabelIds: ['1', '107'],
};

// jsdom defaults hostname to 'localhost' which puts the hook in dev mode.
// Force non-localhost so tests exercise the production load/save branches.
const originalLocation = window.location;
beforeEach(() => {
  getMondayMock().__reset();
  try { sessionStorage.setItem(SILENT_RELOAD_FLAG, '1'); } catch { /* ignore */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, hostname: 'app.monday.com', reload: vi.fn() },
  });
});

afterEach(() => {
  try { sessionStorage.removeItem(SILENT_RELOAD_FLAG); } catch { /* ignore */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('useMondaySettings — day-off settings fields (W3.1)', () => {
  it('fresh unconfigured instance: defaults leave the day-off path entirely OFF', async () => {
    const { result } = renderHook(() => useMondaySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const s = result.current.settings;
    expect(s).not.toBeNull();
    // The path gate: empty board ID ⇒ legacy behavior.
    expect(s?.dayOffBoardId).toBe('');
    // Column/label mappings empty.
    expect(s?.dayOffEmployeeColumnId).toBe('');
    expect(s?.dayOffStartDateColumnId).toBe('');
    expect(s?.dayOffEndDateColumnId).toBe('');
    expect(s?.dayOffKindColumnId).toBe('');
    expect(s?.dayOffKindGeneralLabelId).toBe('');
    expect(s?.dayOffKindPersonalLabelId).toBe('');
    expect(s?.dayOffTypeColumnId).toBe('');
    expect(s?.dayOffApprovalColumnId).toBe('');
    expect(s?.dayOffApprovedLabelIds).toEqual([]);
    // Approval policy toggle defaults OFF (local decision recorded in the W3.1 ledger row).
    expect(s?.dayOffApprovalRequired).toBe(false);
  });

  it('a pre-dayOff blob loads cleanly and gains inert day-off defaults', async () => {
    getMondayMock().__seedStorage(SETTINGS_KEY, legacyStoredSettings);

    const { result } = renderHook(() => useMondaySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const s = result.current.settings;
    expect(result.current.error).toBeNull();
    expect(result.current.isConfigured).toBe(true);
    // New keys exist but are OFF.
    expect(s?.dayOffBoardId).toBe('');
    expect(s?.dayOffApprovalRequired).toBe(false);
    expect(s?.dayOffApprovedLabelIds).toEqual([]);
  });

  it('stored dayOff* values override the defaults on load (merge-on-load)', async () => {
    getMondayMock().__seedStorage(SETTINGS_KEY, { ...legacyStoredSettings, ...dayOffValues });

    const { result } = renderHook(() => useMondaySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const s = result.current.settings;
    expect(s?.dayOffBoardId).toBe('vacations-board');
    expect(s?.dayOffEmployeeColumnId).toBe('person');
    expect(s?.dayOffStartDateColumnId).toBe('date_from');
    expect(s?.dayOffEndDateColumnId).toBe('date_to');
    expect(s?.dayOffKindColumnId).toBe('kind_status');
    expect(s?.dayOffKindGeneralLabelId).toBe('2');
    expect(s?.dayOffKindPersonalLabelId).toBe('0');
    expect(s?.dayOffTypeColumnId).toBe('type_status');
    expect(s?.dayOffApprovalRequired).toBe(true);
    expect(s?.dayOffApprovalColumnId).toBe('approval_status');
    expect(s?.dayOffApprovedLabelIds).toEqual(['1', '107']);
  });

  it('saveSettings persists the new keys and they survive a reload round trip', async () => {
    getMondayMock().__seedStorage(SETTINGS_KEY, legacyStoredSettings);

    const { result } = renderHook(() => useMondaySettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const next = { ...result.current.settings!, ...dayOffValues } as PlannerSettings;
    let saved = false;
    await act(async () => {
      saved = await result.current.saveSettings(next);
    });
    expect(saved).toBe(true);

    // Raw persisted JSON carries the new keys (generic JSON persistence, no field code).
    const raw = getMondayMock().__getStorage(SETTINGS_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!) as PlannerSettings;
    expect(persisted.dayOffBoardId).toBe('vacations-board');
    expect(persisted.dayOffApprovalRequired).toBe(true);
    expect(persisted.dayOffApprovedLabelIds).toEqual(['1', '107']);

    // Reload from storage → values come back.
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings?.dayOffBoardId).toBe('vacations-board');
    expect(result.current.settings?.dayOffKindPersonalLabelId).toBe('0');
    expect(result.current.settings?.dayOffApprovedLabelIds).toEqual(['1', '107']);
  });
});
