/**
 * W3.3 (DAY-OFF-INTEGRATION) — Day-off vacations-board path in
 * useEmployeeAbsences: range→per-day expansion per `Day-off/CONTRACT.md` §6,
 * window clipping, D2 approval policy, kind=personal ID-first matching with
 * the contract §2 person-presence fallback.
 *
 * The Day-off board is the SOLE absence source (the legacy Time Logs single-
 * date path was removed in the W5 cutover).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { fetchDayOffsForRange, loggerWarn, loggerError } = vi.hoisted(() => ({
  fetchDayOffsForRange: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('../../services/mondayService', () => ({
  mondayService: { fetchDayOffsForRange },
}));
vi.mock('../../utils/Logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: loggerWarn, error: loggerError },
}));

import { useEmployeeAbsences } from '../useEmployeeAbsences';
import type { PlannerSettings } from '../../types/settings.types';

// Vacations-board mapping (W3.1 keys). Label IDs are stable monday label ids.
const KIND_PERSONAL = '1';
const KIND_GENERAL = '2';
const APPROVED = '10';
const PENDING = '11';
const REJECTED = '12';

const dayOffSettings = {
  dayOffBoardId: 'vac-board',
  dayOffEmployeeColumnId: 'person',
  dayOffStartDateColumnId: 'start',
  dayOffEndDateColumnId: 'end',
  dayOffKindColumnId: 'kind',
  dayOffKindPersonalLabelId: KIND_PERSONAL,
  dayOffKindGeneralLabelId: KIND_GENERAL,
  dayOffTypeColumnId: 'type',
  dayOffApprovalRequired: false,
  dayOffApprovalColumnId: 'approval',
  dayOffApprovedLabelIds: [APPROVED],
} as Partial<PlannerSettings>;

interface DayOffItemSpec {
  id: string;
  personId?: number | string;
  start?: string;
  end?: string;
  kindIndex?: number | string | null;
  typeText?: string;
  approvalIndex?: number | string | null;
}

/** Builds a raw monday item shaped like fetchDayOffsForRange's output. */
const dayOffItem = ({ id, personId, start, end, kindIndex, typeText, approvalIndex }: DayOffItemSpec) => ({
  id,
  name: `item ${id}`,
  column_values: [
    {
      id: 'person',
      persons_and_teams: personId != null ? [{ id: personId }] : [],
      text: personId != null ? `user ${personId}` : '',
    },
    { id: 'start', text: start ?? '' },
    { id: 'end', text: end ?? '' },
    { id: 'kind', index: kindIndex ?? null, text: '' },
    { id: 'type', index: 5, text: typeText ?? '' },
    { id: 'approval', index: approvalIndex ?? null, text: '' },
  ],
});

const window = { startDate: new Date('2026-05-01T00:00:00'), endDate: new Date('2026-05-31T00:00:00') };

const render = (settings: Partial<PlannerSettings>, enabled = true) =>
  renderHook(() =>
    useEmployeeAbsences({
      enabled,
      settings: settings as PlannerSettings,
      ...window,
    })
  );

beforeEach(() => {
  fetchDayOffsForRange.mockReset().mockResolvedValue([]);
  loggerWarn.mockReset();
  loggerError.mockReset();
});

describe('useEmployeeAbsences — Day-off path (W3.3)', () => {
  it('stays OFF while dayOffBoardId is empty — no fetch, empty map', async () => {
    const { result } = render({});
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchDayOffsForRange).not.toHaveBeenCalled();
    expect(result.current.absencesByEmployee.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('expands an inclusive range into one entry per calendar day — weekends included', async () => {
    // 2026-05-08 = Friday, 2026-05-09 = Saturday: expansion must NOT skip them
    // (buildDayInfo's priority chain owns day classification — CONTRACT.md §6.3).
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-07', end: '2026-05-10', kindIndex: 1, typeText: 'חופשה' }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));

    const days = result.current.absencesByEmployee.get('100')!;
    expect([...days.keys()].sort()).toEqual(['2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10']);
    expect(days.get('2026-05-09')).toEqual({
      employeeId: '100',
      date: '2026-05-09',
      classification: 'חופשה',
      // W3.5 fields: provenance + structured type + resolved approval state
      // (empty approval value = semantic pending = not approved, mapping present).
      sourceItemId: '1',
      approved: false,
      typeLabelId: '5',
    });
  });

  it('clips the expansion to the visible window on both ends (inclusive)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-04-20', end: '2026-06-10', kindIndex: 1 }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));

    const days = result.current.absencesByEmployee.get('100')!;
    expect(days.size).toBe(31); // exactly May 2026
    expect(days.has('2026-04-30')).toBe(false);
    expect(days.has('2026-05-01')).toBe(true);
    expect(days.has('2026-05-31')).toBe(true);
    expect(days.has('2026-06-01')).toBe(false);
  });

  it('expands a single-day item (start == end) into exactly one entry', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-12', end: '2026-05-12', kindIndex: 1 }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect([...result.current.absencesByEmployee.get('100')!.keys()]).toEqual(['2026-05-12']);
  });

  it('approval OFF with a rejected mapping: pending/empty count, REJECTED is excluded (D2 amendment, DEV-2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, approvalIndex: PENDING }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-05', end: '2026-05-05', kindIndex: 1, approvalIndex: REJECTED }),
      dayOffItem({ id: '3', personId: 300, start: '2026-05-06', end: '2026-05-06', kindIndex: 1, approvalIndex: null }),
    ]);
    const { result } = render({
      ...dayOffSettings,
      dayOffApprovalRequired: false,
      dayOffRejectedLabelIds: [REJECTED],
    });
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(2));
    expect(result.current.absencesByEmployee.has('200')).toBe(false); // the rejected one
  });

  it('approval OFF without a rejected mapping cannot exclude — all personal items count (documented degradation, CONTRACT.md §5.2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, approvalIndex: PENDING }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-05', end: '2026-05-05', kindIndex: 1, approvalIndex: REJECTED }),
      dayOffItem({ id: '3', personId: 300, start: '2026-05-06', end: '2026-05-06', kindIndex: 1, approvalIndex: null }),
    ]);
    const { result } = render({ ...dayOffSettings, dayOffApprovalRequired: false });
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(3));
  });

  it('approval ON: a rejected item is excluded by the rejected set even if it also sneaks into the approved set (rejection wins)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, approvalIndex: REJECTED }),
    ]);
    const { result } = render({
      ...dayOffSettings,
      dayOffApprovalRequired: true,
      dayOffApprovedLabelIds: [APPROVED, REJECTED],
      dayOffRejectedLabelIds: [REJECTED],
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.absencesByEmployee.size).toBe(0);
  });

  it('approval ON keeps only items whose approval label ID is in the approved set (D2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, approvalIndex: APPROVED }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-05', end: '2026-05-05', kindIndex: 1, approvalIndex: PENDING }),
      dayOffItem({ id: '3', personId: 300, start: '2026-05-06', end: '2026-05-06', kindIndex: 1, approvalIndex: REJECTED }),
      // empty approval = semantic pending = not approved
      dayOffItem({ id: '4', personId: 400, start: '2026-05-07', end: '2026-05-07', kindIndex: 1, approvalIndex: null }),
    ]);
    const { result } = render({ ...dayOffSettings, dayOffApprovalRequired: true });
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect(result.current.absencesByEmployee.has('100')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('skips general items (kind label ID match) even when a person is set', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-05', kindIndex: KIND_GENERAL }),
      dayOffItem({ id: '2', start: '2026-05-06', end: '2026-05-06', kindIndex: KIND_GENERAL }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.absencesByEmployee.size).toBe(0);
    expect(loggerWarn).not.toHaveBeenCalled(); // configured-label match — no drift
  });

  it('falls back to person-presence for an EMPTY kind, without a drift warning', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: null }),
      dayOffItem({ id: '2', start: '2026-05-05', end: '2026-05-05', kindIndex: null }), // no person → general → skipped
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect(result.current.absencesByEmployee.has('100')).toBe(true);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('warn-logs settings drift for a non-empty kind matching neither configured label, keeps the item via fallback', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 99 }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect(result.current.absencesByEmployee.has('100')).toBe(true);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(String(loggerWarn.mock.calls[0][0])).toContain('drift');
  });

  it('uses person-presence when the kind column is unmapped (no warning)', async () => {
    const settings = { ...dayOffSettings };
    delete (settings as Record<string, unknown>).dayOffKindColumnId;
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1 }),
      dayOffItem({ id: '2', start: '2026-05-05', end: '2026-05-05', kindIndex: 2 }), // no person → skipped
    ]);
    const { result } = render(settings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('classification carries the type label TEXT (display-only, open set per D1)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, typeText: 'השתלמות' }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect(result.current.absencesByEmployee.get('100')!.get('2026-05-04')!.classification).toBe('השתלמות');
  });

  it('re-expansion is idempotent for overlapping items of the same employee', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-06', kindIndex: 1, typeText: 'חופשה' }),
      dayOffItem({ id: '2', personId: 100, start: '2026-05-06', end: '2026-05-08', kindIndex: 1, typeText: 'מחלה' }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    const days = result.current.absencesByEmployee.get('100')!;
    expect(days.size).toBe(5); // 04..08, one entry per day
    expect(days.get('2026-05-06')!.classification).toBe('מחלה'); // later item wins the overlap day
  });

  it('skips a personal item whose person column is empty (cannot join — contract §2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', start: '2026-05-04', end: '2026-05-04', kindIndex: KIND_PERSONAL }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.absencesByEmployee.size).toBe(0);
  });

  it('fails loudly on a half-configured dayOff mapping — no fetch, error set, empty map', async () => {
    const broken = { ...dayOffSettings };
    delete (broken as Record<string, unknown>).dayOffEmployeeColumnId;

    const { result } = render(broken);
    await waitFor(() => expect(result.current.error).toBe('dayoff_misconfigured'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.absencesByEmployee.size).toBe(0);
    expect(fetchDayOffsForRange).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(String(loggerError.mock.calls[0][0])).toContain('dayOffEmployeeColumnId');
  });

  it('approval ON without an approved-label set is a loud misconfiguration (no silent drop-all)', async () => {
    const { result } = render({
      ...dayOffSettings,
      dayOffApprovalRequired: true,
      dayOffApprovedLabelIds: [],
    });
    await waitFor(() => expect(result.current.error).toBe('dayoff_misconfigured'));
    expect(fetchDayOffsForRange).not.toHaveBeenCalled();
    expect(String(loggerError.mock.calls[0][0])).toContain('dayOffApprovedLabelIds');
  });

  it('passes the visible window and only the mapped columns slice to fetchDayOffsForRange', async () => {
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchDayOffsForRange).toHaveBeenCalledWith('vac-board', '2026-05-01', '2026-05-31', {
      dayOffEmployeeColumnId: 'person',
      dayOffStartDateColumnId: 'start',
      dayOffEndDateColumnId: 'end',
      dayOffKindColumnId: 'kind',
      dayOffTypeColumnId: 'type',
      dayOffApprovalColumnId: 'approval',
    });
  });

  it('a window re-read REPLACES the window data (hard-deleted cancellations disappear — CONTRACT.md §7)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1 }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-05', end: '2026-05-05', kindIndex: 1 }),
    ]);
    const { result, rerender } = renderHook(
      ({ settings }: { settings: PlannerSettings }) =>
        useEmployeeAbsences({ enabled: true, settings, ...window }),
      { initialProps: { settings: dayOffSettings as PlannerSettings } }
    );
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(2));

    // item 2 was cancelled (hard delete) → next read returns only item 1.
    // Force a refetch by changing a consumed setting (type column remap).
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1 }),
    ]);
    rerender({ settings: { ...dayOffSettings, dayOffTypeColumnId: 'type2' } as PlannerSettings });
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    expect(result.current.absencesByEmployee.has('200')).toBe(false);
  });

  it('does not fetch when disabled, even with a full dayOff mapping', async () => {
    const { result } = render(dayOffSettings, false);
    expect(result.current.absencesByEmployee.size).toBe(0);
    expect(fetchDayOffsForRange).not.toHaveBeenCalled();
  });

  // --- W3.5: sourceItemId / approved / typeLabelId on expanded entries ---

  it('every expanded day carries the producing vacations-board item id as sourceItemId (W3.5)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '71', personId: 100, start: '2026-05-04', end: '2026-05-06', kindIndex: 1 }),
      dayOffItem({ id: '72', personId: 200, start: '2026-05-10', end: '2026-05-10', kindIndex: 1 }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(2));
    const alice = result.current.absencesByEmployee.get('100')!;
    expect([...alice.values()].map((e) => e.sourceItemId)).toEqual(['71', '71', '71']);
    expect(result.current.absencesByEmployee.get('200')!.get('2026-05-10')!.sourceItemId).toBe('72');
  });

  it('typeLabelId carries the personalType LABEL ID (structured type key) beside the classification text (W3.5)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, typeText: 'מילואים' }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    const entry = result.current.absencesByEmployee.get('100')!.get('2026-05-04')!;
    expect(entry.typeLabelId).toBe('5'); // the fixture's type-column label id
    expect(entry.classification).toBe('מילואים'); // display text, reused field — no duplicate
  });

  it('typeLabelId and classification stay undefined when the type column is unmapped (W3.5)', async () => {
    const settings = { ...dayOffSettings };
    delete (settings as Record<string, unknown>).dayOffTypeColumnId;
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, typeText: 'חופשה' }),
    ]);
    const { result } = render(settings);
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    const entry = result.current.absencesByEmployee.get('100')!.get('2026-05-04')!;
    expect(entry.typeLabelId).toBeUndefined();
    expect(entry.classification).toBeUndefined();
  });

  it('approval OFF + mapping present: entries carry an informational `approved` flag, all items still count (W3.5/D2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, approvalIndex: APPROVED }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-05', end: '2026-05-05', kindIndex: 1, approvalIndex: PENDING }),
      dayOffItem({ id: '3', personId: 300, start: '2026-05-06', end: '2026-05-06', kindIndex: 1, approvalIndex: REJECTED }),
      dayOffItem({ id: '4', personId: 400, start: '2026-05-07', end: '2026-05-07', kindIndex: 1, approvalIndex: null }),
    ]);
    const { result } = render({ ...dayOffSettings, dayOffApprovalRequired: false });
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(4));
    const flag = (emp: string, day: string) => result.current.absencesByEmployee.get(emp)!.get(day)!.approved;
    expect(flag('100', '2026-05-04')).toBe(true);
    expect(flag('200', '2026-05-05')).toBe(false); // pending
    expect(flag('300', '2026-05-06')).toBe(false); // rejected — still counted under OFF
    expect(flag('400', '2026-05-07')).toBe(false); // empty = semantic pending
  });

  it('approval ON: every surviving entry carries approved === true (W3.5/D2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-05', kindIndex: 1, approvalIndex: APPROVED }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-06', end: '2026-05-06', kindIndex: 1, approvalIndex: PENDING }),
    ]);
    const { result } = render({ ...dayOffSettings, dayOffApprovalRequired: true });
    await waitFor(() => expect(result.current.absencesByEmployee.size).toBe(1));
    const alice = result.current.absencesByEmployee.get('100')!;
    expect([...alice.values()].map((e) => e.approved)).toEqual([true, true]);
  });

  it('approved stays undefined when the approval mapping cannot resolve it (W3.5 — never guess)', async () => {
    // (a) approval column unmapped
    const noColumn = { ...dayOffSettings, dayOffApprovalRequired: false };
    delete (noColumn as Record<string, unknown>).dayOffApprovalColumnId;
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-04', kindIndex: 1, approvalIndex: APPROVED }),
    ]);
    const first = render(noColumn);
    await waitFor(() => expect(first.result.current.absencesByEmployee.size).toBe(1));
    expect(first.result.current.absencesByEmployee.get('100')!.get('2026-05-04')!.approved).toBeUndefined();
    first.unmount();

    // (b) approved-label set empty (legal while the D2 toggle is OFF)
    const noLabels = { ...dayOffSettings, dayOffApprovalRequired: false, dayOffApprovedLabelIds: [] };
    const second = render(noLabels);
    await waitFor(() => expect(second.result.current.absencesByEmployee.size).toBe(1));
    expect(second.result.current.absencesByEmployee.get('100')!.get('2026-05-04')!.approved).toBeUndefined();
  });

});

/**
 * W3.8 — cross-cutting guards: window-change re-expansion idempotency (§6.6)
 * and the stale-window clobber regression pattern (Planner BUGS.md 2026-06-09):
 * a late-resolving read for the OLD window must not overwrite the NEW window.
 */
describe('useEmployeeAbsences — W3.8 window-change & clobber guards', () => {
  const mayWin = { startDate: new Date('2026-05-01T00:00:00'), endDate: new Date('2026-05-31T00:00:00') };
  const juneWin = { startDate: new Date('2026-06-01T00:00:00'), endDate: new Date('2026-06-30T00:00:00') };

  const renderWindowed = () =>
    renderHook(
      ({ win }: { win: { startDate: Date; endDate: Date } }) =>
        useEmployeeAbsences({ enabled: true, settings: dayOffSettings as PlannerSettings, ...win }),
      { initialProps: { win: mayWin } }
    );

  it('a window change re-expands the same item clipped to the NEW window — idempotent keys, out-of-window days dropped (§6.6)', async () => {
    // One item spanning Apr..Jun: each window sees only its own clipped slice.
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-04-15', end: '2026-06-15', kindIndex: 1, typeText: 'חופשה' }),
    ]);
    const { result, rerender } = renderWindowed();
    await waitFor(() => expect(result.current.absencesByEmployee.get('100')?.size).toBe(31)); // exactly May

    rerender({ win: juneWin });
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(2));
    expect(fetchDayOffsForRange).toHaveBeenLastCalledWith('vac-board', '2026-06-01', '2026-06-30', expect.any(Object));

    await waitFor(() => expect(result.current.absencesByEmployee.get('100')?.size).toBe(15)); // 06-01..06-15 only
    const days = result.current.absencesByEmployee.get('100')!;
    expect(days.has('2026-05-31')).toBe(false); // old window's days are gone (replace, not accumulate)
    expect(days.has('2026-06-01')).toBe(true);
    expect(days.has('2026-06-15')).toBe(true);
    expect(days.has('2026-06-16')).toBe(false);
    // idempotent (employeeId, day) keying: every entry self-describes its key + provenance
    for (const [key, entry] of days) {
      expect(entry.date).toBe(key);
      expect(entry.employeeId).toBe('100');
      expect(entry.sourceItemId).toBe('1');
    }
  });

  it('a stale in-flight fetch for the OLD window resolving late cannot clobber the NEW window data (futureClobber pattern)', async () => {
    let releaseMay!: (items: unknown[]) => void;
    let releaseJune!: (items: unknown[]) => void;
    fetchDayOffsForRange
      .mockReturnValueOnce(
        new Promise<unknown[]>((resolve) => {
          releaseMay = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise<unknown[]>((resolve) => {
          releaseJune = resolve;
        })
      );

    const { result, rerender } = renderWindowed();
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(1));
    rerender({ win: juneWin }); // navigate before the May read lands
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(2));

    releaseJune([dayOffItem({ id: 'J', personId: 200, start: '2026-06-03', end: '2026-06-03', kindIndex: 1 })]);
    await waitFor(() => expect(result.current.absencesByEmployee.has('200')).toBe(true));

    // The May response arrives LAST — it must be dropped, not published.
    releaseMay([dayOffItem({ id: 'M', personId: 900, start: '2026-05-04', end: '2026-05-04', kindIndex: 1 })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.absencesByEmployee.has('900')).toBe(false); // stale window dropped
    expect(result.current.absencesByEmployee.get('200')!.has('2026-06-03')).toBe(true); // fresh window intact
    expect(result.current.isLoading).toBe(false);
  });
});
