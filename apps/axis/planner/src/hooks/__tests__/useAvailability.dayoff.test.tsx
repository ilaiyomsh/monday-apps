/**
 * W3.8 (DAY-OFF-INTEGRATION) — the cross-cutting W3 surface, chained:
 * mocked `fetchDayOffsForRange` → REAL `useEmployeeAbsences` (W3.3 personal
 * channel) + REAL `useHolidays` (W3.4 general channel) → REAL `useAvailability`
 * capacity math. Locks the plan §2 routing semantics end-to-end:
 *
 * - personal → AbsencesByEmployee: zeroes the employee's day, employee STAYS
 *   in the role capacity denominator (free% drops);
 * - general+mandatory → holidaysByDate{blocking}: zeroes EVERYONE, EXCLUDED
 *   from role denominators;
 * - general+optional (mandatory=false) → display-only: NO capacity effect;
 * - weekend days inside an expanded range are reclassified by buildDayInfo
 *   (CONTRACT.md §6.3 — expansion never skips, the math stays authoritative);
 * - D2 approval policy ON/OFF flows through to capacity.
 *
 * Per-hook behavior is locked unit-style in `useEmployeeAbsences.dayoff` /
 * `useHolidays.dayoff`; this suite proves the channels compose.
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
import { useHolidays } from '../useHolidays';
import { useAvailability } from '../useAvailability';
import type { Employee } from '../../types/gantt.types';
import type { PlannerSettings } from '../../types/settings.types';

// Vacations-board mapping (W3.1 + W3.4 keys). Label IDs are stable monday ids.
const KIND_PERSONAL = '1';
const KIND_GENERAL = '2';
const APPROVED = '10';
const PENDING = '11';

const chainSettings = {
  dayOffBoardId: 'vac-board',
  dayOffEmployeeColumnId: 'person',
  dayOffStartDateColumnId: 'start',
  dayOffEndDateColumnId: 'end',
  dayOffKindColumnId: 'kind',
  dayOffKindPersonalLabelId: KIND_PERSONAL,
  dayOffKindGeneralLabelId: KIND_GENERAL,
  dayOffTypeColumnId: 'type',
  dayOffMandatoryColumnId: 'mandatory',
  dayOffApprovalRequired: false,
  dayOffApprovalColumnId: 'approval',
  dayOffApprovedLabelIds: [APPROVED],
} as Partial<PlannerSettings>;

interface ItemSpec {
  id: string;
  name?: string;
  personId?: number | string;
  start?: string;
  end?: string;
  kindIndex?: number | string | null;
  typeText?: string;
  approvalIndex?: number | string | null;
  /** checkbox `checked` value; omit to simulate an empty checkbox cell */
  mandatory?: boolean | string;
}

/** Builds a raw monday item shaped like fetchDayOffsForRange's output (both hooks read it). */
const dayOffItem = ({ id, name, personId, start, end, kindIndex, typeText, approvalIndex, mandatory }: ItemSpec) => ({
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
    { id: 'type', index: 5, text: typeText ?? '' },
    { id: 'approval', index: approvalIndex ?? null, text: '' },
    { id: 'mandatory', checked: mandatory ?? null, text: '' },
  ],
});

const makeEmployee = (overrides: Partial<Employee>): Employee => ({
  id: overrides.id || 'emp-1',
  name: overrides.name || 'Alice',
  role: overrides.role || 'Engineer',
  capabilities: overrides.capabilities || [],
  allocationPercentage: overrides.allocationPercentage ?? 100,
  ...overrides,
});

// May 2026: 05-05 Tue, 05-06 Wed, 05-07 Thu, 05-08 Fri, 05-09 Sat, 05-10 Sun.
const may2026 = { startDate: new Date('2026-05-01T00:00:00'), endDate: new Date('2026-05-31T00:00:00') };

/** The full W3 pipeline: both producers feeding the real availability math. */
const useW3Chain = ({ settings, employees }: { settings: PlannerSettings; employees: Employee[] }) => {
  const absences = useEmployeeAbsences({ enabled: true, settings, ...may2026 });
  const holidays = useHolidays({ settings, ...may2026 });
  const availability = useAvailability({
    employees,
    timelineStart: may2026.startDate,
    timelineEnd: may2026.endDate,
    workDays: [0, 1, 2, 3, 4], // Sun..Thu (default Israeli work week)
    maxHoursPerDay: 8,
    holidaysByDate: holidays.holidaysByDate,
    absencesByEmployee: absences.absencesByEmployee,
  });
  return { absences, holidays, availability };
};

// Two 100%-FTE engineers: employee `100` takes the absences; `200` is the control.
const employees = [
  makeEmployee({ id: '100', name: 'Alice' }),
  makeEmployee({ id: '200', name: 'Bob' }),
];

const render = (settings: Partial<PlannerSettings>) =>
  renderHook(() => useW3Chain({ settings: settings as PlannerSettings, employees }));

const waitSettled = async (result: { current: ReturnType<typeof useW3Chain> }) => {
  await waitFor(() => {
    expect(result.current.absences.isLoading).toBe(false);
    expect(result.current.holidays.isLoading).toBe(false);
  });
};

beforeEach(() => {
  fetchDayOffsForRange.mockReset().mockResolvedValue([]);
  loggerWarn.mockReset();
  loggerError.mockReset();
});

describe('W3 surface chained — Day-off board → absence/holiday channels → availability math (W3.8)', () => {
  it('personal absence zeroes the employee day AND drops them from the role capacity denominator (#88 isLoadCountedDay)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-05', end: '2026-05-05', kindIndex: KIND_PERSONAL, typeText: 'חופשה', approvalIndex: APPROVED }),
    ]);
    const { result } = render(chainSettings);
    await waitSettled(result);

    const alice = result.current.availability.byEmployee.get('100')!.byDate.get('2026-05-05')!;
    expect(alice).toMatchObject({ hours: 0, dayFactor: 0, reason: 'absence', absenceClassification: 'חופשה' });
    const bob = result.current.availability.byEmployee.get('200')!.byDate.get('2026-05-05')!;
    expect(bob).toMatchObject({ hours: 8, reason: 'workday' });

    const roleDay = result.current.availability.byRole[0].byDate.get('2026-05-05')!;
    expect(roleDay.hours).toBe(8); // only Bob supplies hours
    expect(roleDay.capacity).toBe(8); // #88: absence EXCLUDED from the denominator → capacity = Bob only (not 16)
    expect(roleDay.availableEmployees).toBe(1);
    expect(roleDay.totalEmployees).toBe(2); // headcount unchanged — only capacity drops
    expect(roleDay.reason).toBe('workday'); // personal absences are never lifted to the role row
  });

  it('general mandatory company day zeroes EVERYONE via the holiday channel and is EXCLUDED from role denominators', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', name: 'גשר חג', start: '2026-05-05', end: '2026-05-05', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(chainSettings);
    await waitSettled(result);

    // routed to holidaysByDate, NOT to the per-employee absence map
    expect(result.current.holidays.holidaysByDate.get('2026-05-05')).toMatchObject({ blocking: true, source: 'dayoff' });
    expect(result.current.absences.absencesByEmployee.size).toBe(0);

    for (const empId of ['100', '200']) {
      const day = result.current.availability.byEmployee.get(empId)!.byDate.get('2026-05-05')!;
      expect(day).toMatchObject({ hours: 0, dayFactor: 0, reason: 'holiday', holidayKey: '2026-05-05' });
    }
    const roleDay = result.current.availability.byRole[0].byDate.get('2026-05-05')!;
    expect(roleDay.capacity).toBe(0); // excluded from the denominator (unlike a personal absence)
    expect(roleDay.availableEmployees).toBe(0);
    expect(roleDay.reason).toBe('holiday');
    expect(roleDay.holidayKey).toBe('2026-05-05');
  });

  it('general mandatory=false day has NO capacity effect — identical to a plain workday, name surfaced as informational only', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', name: 'יום בחירות', start: '2026-05-05', end: '2026-05-05', kindIndex: KIND_GENERAL, mandatory: false }),
    ]);
    const { result } = render(chainSettings);
    await waitSettled(result);

    const withDay = result.current.availability.byEmployee.get('100')!.byDate.get('2026-05-05')!;
    expect(withDay).toMatchObject({ hours: 8, dayFactor: 1, reason: 'workday', informationalHolidayKey: '2026-05-05' });

    const roleWith = result.current.availability.byRole[0].byDate.get('2026-05-05')!;
    const roleControl = result.current.availability.byRole[0].byDate.get('2026-05-06')!; // plain Wednesday
    expect(roleWith.hours).toBe(roleControl.hours);
    expect(roleWith.capacity).toBe(roleControl.capacity);
    expect(roleWith.availableEmployees).toBe(roleControl.availableEmployees);
    expect(roleWith.reason).toBe('workday');
    expect(roleWith.informationalHolidayKey).toBe('2026-05-05'); // the only difference: the name surfaces
    expect(roleControl.informationalHolidayKey).toBeUndefined();
  });

  it('weekend days inside an expanded absence range are reclassified as weekend by the math (§6.3)', async () => {
    // Thu 05-07 .. Sun 05-10: the expansion emits ALL four days (locked in the
    // W3.3 suite); buildDayInfo must reclassify Fri+Sat to weekend here.
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-07', end: '2026-05-10', kindIndex: KIND_PERSONAL, typeText: 'חופשה' }),
    ]);
    const { result } = render(chainSettings);
    await waitSettled(result);

    const byDate = result.current.availability.byEmployee.get('100')!.byDate;
    expect(byDate.get('2026-05-07')!.reason).toBe('absence'); // Thu
    expect(byDate.get('2026-05-08')!.reason).toBe('weekend'); // Fri — absence entry exists but weekend wins
    expect(byDate.get('2026-05-09')!.reason).toBe('weekend'); // Sat
    expect(byDate.get('2026-05-10')!.reason).toBe('absence'); // Sun
  });

  it('one board read routes each kind to its channel only; a blocking general day wins over a personal absence on the same date', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: 'P', personId: 100, start: '2026-05-05', end: '2026-05-06', kindIndex: KIND_PERSONAL, typeText: 'מחלה' }),
      dayOffItem({ id: 'G', name: 'יום חברה', start: '2026-05-06', end: '2026-05-06', kindIndex: KIND_GENERAL, mandatory: true }),
    ]);
    const { result } = render(chainSettings);
    await waitSettled(result);

    // channel isolation: general never leaks into the absence map, personal never into holidays
    expect([...result.current.holidays.holidaysByDate.keys()]).toEqual(['2026-05-06']);
    expect([...result.current.absences.absencesByEmployee.get('100')!.keys()].sort()).toEqual(['2026-05-05', '2026-05-06']);
    expect(result.current.absences.absencesByEmployee.size).toBe(1);

    const alice = result.current.availability.byEmployee.get('100')!.byDate;
    expect(alice.get('2026-05-05')!.reason).toBe('absence');
    expect(alice.get('2026-05-06')!.reason).toBe('holiday'); // blocking holiday outranks the absence (priority chain)
    expect(result.current.availability.byEmployee.get('200')!.byDate.get('2026-05-06')!.reason).toBe('holiday');
    expect(result.current.availability.byRole[0].byDate.get('2026-05-06')!.capacity).toBe(0);
  });

  it('D2 ON chained: only approved items reduce capacity — a pending request leaves the day a full workday', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-05', end: '2026-05-05', kindIndex: KIND_PERSONAL, approvalIndex: APPROVED }),
      dayOffItem({ id: '2', personId: 200, start: '2026-05-05', end: '2026-05-05', kindIndex: KIND_PERSONAL, approvalIndex: PENDING }),
    ]);
    const { result } = render({ ...chainSettings, dayOffApprovalRequired: true });
    await waitSettled(result);

    expect(result.current.availability.byEmployee.get('100')!.byDate.get('2026-05-05')!.reason).toBe('absence');
    expect(result.current.availability.byEmployee.get('200')!.byDate.get('2026-05-05')!).toMatchObject({
      hours: 8,
      reason: 'workday', // pending under D2-ON: no capacity deduction
    });
  });

  it('D2 OFF chained: a pending request DOES zero the day (all personal items count)', async () => {
    fetchDayOffsForRange.mockResolvedValue([
      dayOffItem({ id: '1', personId: 100, start: '2026-05-05', end: '2026-05-05', kindIndex: KIND_PERSONAL, approvalIndex: PENDING }),
    ]);
    const { result } = render({ ...chainSettings, dayOffApprovalRequired: false });
    await waitSettled(result);

    expect(result.current.availability.byEmployee.get('100')!.byDate.get('2026-05-05')!).toMatchObject({
      hours: 0,
      reason: 'absence',
    });
  });
});
