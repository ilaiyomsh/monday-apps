/**
 * W3.4 (DAY-OFF-INTEGRATION) — general Day-off vacations-board items routed
 * into `holidaysByDate` per `Day-off/CONTRACT.md` §4 + §6: kind routing
 * (label-ID first, §2 person-presence fallback), mandatory⇒blocking vs
 * optional⇒display-only, per-day expansion + window clipping, fail-loud
 * misconfiguration, replace-on-window-change (§7).
 *
 * W5.3 cutover: the Day-off board is the SOLE holiday source — the legacy
 * custom-holidays store was removed, so an empty/misconfigured/failed mapping
 * yields an EMPTY map (no custom fallback).
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

import { useHolidays } from '../useHolidays';
import type { PlannerSettings } from '../../types/settings.types';

// Vacations-board mapping (W3.1 + W3.4 keys). Label IDs are stable monday ids.
const KIND_PERSONAL = '1';
const KIND_GENERAL = '2';

const dayOffSettings = {
  dayOffBoardId: 'vac-board',
  dayOffEmployeeColumnId: 'person',
  dayOffStartDateColumnId: 'start',
  dayOffEndDateColumnId: 'end',
  dayOffKindColumnId: 'kind',
  dayOffKindGeneralLabelId: KIND_GENERAL,
  dayOffKindPersonalLabelId: KIND_PERSONAL,
  dayOffMandatoryColumnId: 'mandatory',
} as Partial<PlannerSettings>;

interface ItemSpec {
  id: string;
  name?: string;
  personId?: number | string;
  start?: string;
  end?: string;
  kindIndex?: number | string | null;
  /** checkbox `checked` value; omit to simulate an empty checkbox cell */
  mandatory?: boolean | string;
}

/** Builds a raw monday item shaped like fetchDayOffsForRange's output. */
const dayOffItem = ({ id, name, personId, start, end, kindIndex, mandatory }: ItemSpec) => ({
  id,
  name: name ?? `item ${id}`,
  column_values: [
    {
      id: 'person',
      persons_and_teams: personId != null ? [{ id: personId }] : [],
      text: personId != null ? `user ${personId}` : '',
    },
    { id: 'start', text: start ?? '' },
    { id: 'end', text: end ?? '' },
    { id: 'kind', index: kindIndex ?? null, text: '' },
    { id: 'mandatory', checked: mandatory ?? null, text: '' },
  ],
});

const may2026 = { startDate: new Date('2026-05-01T00:00:00'), endDate: new Date('2026-05-31T00:00:00') };

const render = (settings: Partial<PlannerSettings> | null) =>
  renderHook(() =>
    useHolidays({
      settings: settings as PlannerSettings | null,
      ...may2026,
    })
  );

beforeEach(() => {
  fetchDayOffsForRange.mockReset().mockResolvedValue([]);
  loggerWarn.mockReset();
  loggerError.mockReset();
});

describe('useHolidays — Day-off general-days path (W3.4)', () => {
  it('stays inert while dayOffBoardId is empty — empty map, zero fetches (W5.3: no custom fallback)', async () => {
    const { result } = render({ dayOffBoardId: '' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchDayOffsForRange).not.toHaveBeenCalled();
    expect(result.current.holidaysByDate.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('routes a mandatory general item into blocking Holiday entries — one per calendar day, weekends included', async () => {
    // 2026-05-08 = Friday, 2026-05-09 = Saturday: expansion must NOT skip them
    // (buildDayInfo's priority chain owns day classification — CONTRACT.md §6.3).
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', name: 'Passover bridge', start: '2026-05-07', end: '2026-05-10', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(4));

    expect([...result.current.holidaysByDate.keys()].sort()).toEqual([
      '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10',
    ]);
    expect(result.current.holidaysByDate.get('2026-05-09')).toEqual({
      date: '2026-05-09',
      nameHe: 'Passover bridge', // item NAME is the contract field (§4)
      nameEn: 'Passover bridge',
      halfDay: false, // whole days only (D6)
      blocking: true,
      source: 'dayoff',
    });
  });

  it('clips the expansion to the visible window on both ends (inclusive)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', start: '2026-04-20', end: '2026-06-10', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(31)); // exactly May 2026
    expect(result.current.holidaysByDate.has('2026-04-30')).toBe(false);
    expect(result.current.holidaysByDate.has('2026-05-01')).toBe(true);
    expect(result.current.holidaysByDate.has('2026-05-31')).toBe(true);
    expect(result.current.holidaysByDate.has('2026-06-01')).toBe(false);
  });

  it('mandatory=false general items surface as NON-blocking (display-only, no capacity effect)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', name: 'Purim party', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: false }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.get('2026-05-12')).toMatchObject({
      blocking: false,
      source: 'dayoff',
      nameHe: 'Purim party',
    });
  });

  it('accepts the contract checkbox string form checked="true" as mandatory', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: 'true' }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.get('2026-05-12')!.blocking).toBe(true);
  });

  it('an UNMAPPED mandatory column reads every general item as NON-blocking (contract §4)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      // The item even carries a checked mandatory cell — without the mapping it must be ignored.
      dayOffItem({ id: '1', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render({ ...dayOffSettings, dayOffMandatoryColumnId: '' });
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.get('2026-05-12')!.blocking).toBe(false);
  });

  it('skips PERSONAL items (kind label-ID match) — they belong to the absence channel', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-04', end: '2026-05-06', kindIndex: KIND_PERSONAL, mandatory: true }),
      dayOffItem({ id: '2', start: '2026-05-20', end: '2026-05-20', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.has('2026-05-20')).toBe(true);
    expect(result.current.holidaysByDate.has('2026-05-04')).toBe(false);
  });

  it('empty kind falls back to person-presence: personless ⇒ general (kept), with person ⇒ personal (skipped)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', start: '2026-05-05', end: '2026-05-05', kindIndex: null, mandatory: true }),
      dayOffItem({ id: '2', personId: 100, start: '2026-05-06', end: '2026-05-06', kindIndex: null, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.has('2026-05-05')).toBe(true);
    expect(result.current.holidaysByDate.has('2026-05-06')).toBe(false);
    expect(loggerWarn).not.toHaveBeenCalled(); // empty kind is NOT drift
  });

  it('warn-logs settings drift once when a NON-empty kind label matches neither configured ID', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', start: '2026-05-05', end: '2026-05-05', kindIndex: 99, mandatory: true }),
      dayOffItem({ id: '2', start: '2026-05-06', end: '2026-05-06', kindIndex: 99, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    // Fallback keeps the items visible (no person ⇒ general).
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(2));
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(String(loggerWarn.mock.calls[0][0])).toContain('2 day-off item(s)');
  });

  it('same-day collision between general items: blocking wins over non-blocking', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', name: 'Optional event', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: false }),
      dayOffItem({ id: '2', name: 'Office closed', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.get('2026-05-12')).toMatchObject({
      blocking: true,
      nameHe: 'Office closed',
    });
  });

  it('board entries flow by mandatory flag: optional⇒display-only, mandatory⇒blocking (W5.3: board is the sole source)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', name: 'Optional event', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: false }),
      dayOffItem({ id: '2', name: 'Board closure', start: '2026-05-13', end: '2026-05-13', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(2));

    expect(result.current.holidaysByDate.get('2026-05-12')).toMatchObject({ source: 'dayoff', blocking: false, nameHe: 'Optional event' });
    expect(result.current.holidaysByDate.get('2026-05-13')).toMatchObject({ source: 'dayoff', blocking: true, nameHe: 'Board closure', halfDay: false });
  });

  it('fails loudly on a half-configured mapping — no fetch, error set, empty map (W5.3: no custom fallback)', async () => {
    const { result } = render({ ...dayOffSettings, dayOffEmployeeColumnId: '', dayOffEndDateColumnId: '' });
    await waitFor(() => expect(result.current.error).toBe('dayoff_misconfigured'));
    expect(fetchDayOffsForRange).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledTimes(1);
    const msg = String(loggerError.mock.calls[0][0]);
    expect(msg).toContain('dayOffEmployeeColumnId');
    expect(msg).toContain('dayOffEndDateColumnId');
    expect(msg).not.toContain('dayOffStartDateColumnId,');
    expect(result.current.holidaysByDate.size).toBe(0);
  });

  it('surfaces a fetch failure as error with an empty map (W5.3: no custom fallback)', async () => {
    fetchDayOffsForRange.mockRejectedValue(new Error('boom'));
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.error).toBe('fetch_failed'));
    expect(loggerError).toHaveBeenCalled();
    expect(result.current.holidaysByDate.size).toBe(0);
  });

  it('passes the window day-keys and the mapped dayOff* column slice to the fetch', async () => {
    render(dayOffSettings);
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(1));
    expect(fetchDayOffsForRange).toHaveBeenCalledWith('vac-board', '2026-05-01', '2026-05-31', {
      dayOffEmployeeColumnId: 'person',
      dayOffStartDateColumnId: 'start',
      dayOffEndDateColumnId: 'end',
      dayOffKindColumnId: 'kind',
      dayOffMandatoryColumnId: 'mandatory',
    });
  });

  it('REPLACES board-sourced entries on window change — a hard-deleted company day disappears (§7)', async () => {
    fetchDayOffsForRange.mockResolvedValueOnce([
      dayOffItem({ id: '1', start: '2026-05-12', end: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result, rerender } = renderHook(
      ({ start, end }: { start: Date; end: Date }) =>
        useHolidays({ settings: dayOffSettings as PlannerSettings, startDate: start, endDate: end }),
      { initialProps: { start: may2026.startDate, end: may2026.endDate } }
    );
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));

    // The item was deleted on the board: the June re-read returns nothing.
    fetchDayOffsForRange.mockResolvedValueOnce([]);
    rerender({ start: new Date('2026-06-01T00:00:00'), end: new Date('2026-06-30T00:00:00') });
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(0));
  });

  it('drops items with a malformed/missing date instead of guessing (contract §2)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', start: '2026-05-12', kindIndex: KIND_GENERAL, mandatory: true }), // no end
      dayOffItem({ id: '2', start: 'not-a-date', end: '2026-05-13', kindIndex: KIND_GENERAL, mandatory: true }),
      dayOffItem({ id: '3', start: '2026-05-20', end: '2026-05-20', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(dayOffSettings);
    await waitFor(() => expect(result.current.holidaysByDate.size).toBe(1));
    expect(result.current.holidaysByDate.has('2026-05-20')).toBe(true);
  });

  it('a stale in-flight board read for the OLD window resolving late cannot clobber the NEW window map (futureClobber pattern, W3.8)', async () => {
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

    const { result, rerender } = renderHook(
      ({ start, end }: { start: Date; end: Date }) =>
        useHolidays({ settings: dayOffSettings as PlannerSettings, startDate: start, endDate: end }),
      { initialProps: { start: may2026.startDate, end: may2026.endDate } }
    );
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(1));
    rerender({ start: new Date('2026-06-01T00:00:00'), end: new Date('2026-06-30T00:00:00') }); // navigate before the May read lands
    await waitFor(() => expect(fetchDayOffsForRange).toHaveBeenCalledTimes(2));

    releaseJune([dayOffItem({ id: 'J', name: 'יום חברה', start: '2026-06-03', end: '2026-06-03', kindIndex: KIND_GENERAL, mandatory: true })]);
    await waitFor(() => expect(result.current.holidaysByDate.has('2026-06-03')).toBe(true));

    // The May response arrives LAST — it must be dropped, not published.
    releaseMay([dayOffItem({ id: 'M', start: '2026-05-04', end: '2026-05-04', kindIndex: KIND_GENERAL, mandatory: true })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.holidaysByDate.has('2026-05-04')).toBe(false); // stale window dropped
    expect(result.current.holidaysByDate.has('2026-06-03')).toBe(true); // fresh window intact
    expect(result.current.isLoading).toBe(false);
  });
});
