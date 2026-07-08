import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAvailability } from '../useAvailability';
import type { Employee, Holiday } from '../../types/gantt.types';

const makeEmployee = (overrides: Partial<Employee>): Employee => ({
  id: overrides.id || 'emp-1',
  name: overrides.name || 'Alice',
  role: overrides.role || 'Engineer',
  capabilities: overrides.capabilities || [],
  allocationPercentage: overrides.allocationPercentage ?? 100,
  ...overrides,
});

const makeRange = (start: string, end: string) => ({
  timelineStart: new Date(start + 'T00:00:00'),
  timelineEnd: new Date(end + 'T00:00:00'),
});

describe('useAvailability', () => {
  it('100% FTE on a workday gives full hours', () => {
    const employees = [makeEmployee({ id: 'a', allocationPercentage: 100 })];
    // 2026-05-05 is a Tuesday — included in Sun..Thu workdays.
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-05', '2026-05-05'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate: new Map<string, Holiday>(),
      })
    );
    const day = result.current.byEmployee.get('a')!.byDate.get('2026-05-05')!;
    expect(day.hours).toBe(8);
    expect(day.dayFactor).toBe(1);
    expect(day.reason).toBe('workday');
  });

  it('50% FTE on a workday gives half capacity', () => {
    const employees = [makeEmployee({ id: 'a', allocationPercentage: 50 })];
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-05', '2026-05-05'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate: new Map<string, Holiday>(),
      })
    );
    expect(result.current.byEmployee.get('a')!.byDate.get('2026-05-05')!.hours).toBe(4);
  });

  it('weekend yields zero with reason "weekend"', () => {
    const employees = [makeEmployee({ id: 'a' })];
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        // 2026-05-09 is Saturday.
        ...makeRange('2026-05-09', '2026-05-09'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate: new Map(),
      })
    );
    const d = result.current.byEmployee.get('a')!.byDate.get('2026-05-09')!;
    expect(d.hours).toBe(0);
    expect(d.reason).toBe('weekend');
  });

  it('full holiday yields zero with reason "holiday"', () => {
    const employees = [makeEmployee({ id: 'a' })];
    const holidaysByDate = new Map<string, Holiday>([
      ['2026-09-12', { date: '2026-09-12', nameEn: 'Rosh Hashana', nameHe: 'ראש השנה', halfDay: false, blocking: true, source: 'dayoff' }],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-09-12', '2026-09-12'),
        // Saturday — but workDays adds Saturday in this test only to isolate the "holiday on workday" branch.
        workDays: [0, 1, 2, 3, 4, 5, 6],
        maxHoursPerDay: 8,
        holidaysByDate,
      })
    );
    const d = result.current.byEmployee.get('a')!.byDate.get('2026-09-12')!;
    expect(d.hours).toBe(0);
    expect(d.reason).toBe('holiday');
  });

  it('half-day holiday yields half hours and reason "halfDay"', () => {
    const employees = [makeEmployee({ id: 'a' })];
    const holidaysByDate = new Map<string, Holiday>([
      ['2026-09-11', { date: '2026-09-11', nameEn: 'Erev Rosh Hashana', nameHe: 'ערב ראש השנה', halfDay: true, blocking: true, source: 'dayoff' }],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-09-11', '2026-09-11'),
        workDays: [0, 1, 2, 3, 4, 5, 6],
        maxHoursPerDay: 8,
        holidaysByDate,
      })
    );
    const d = result.current.byEmployee.get('a')!.byDate.get('2026-09-11')!;
    expect(d.hours).toBe(4);
    expect(d.dayFactor).toBe(0.5);
    expect(d.reason).toBe('halfDay');
  });

  it('per-employee absence overrides workday with reason "absence"', () => {
    const employees = [makeEmployee({ id: 'a' })];
    const absencesByEmployee = new Map([
      ['a', new Map([['2026-05-05', { employeeId: 'a', date: '2026-05-05', classification: 'חופש שנתי' }]])],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-05', '2026-05-05'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate: new Map(),
        absencesByEmployee,
      })
    );
    const day = result.current.byEmployee.get('a')!.byDate.get('2026-05-05')!;
    expect(day.hours).toBe(0);
    expect(day.reason).toBe('absence');
    expect(day.absenceClassification).toBe('חופש שנתי');
  });

  it('full holiday wins over absence', () => {
    const employees = [makeEmployee({ id: 'a' })];
    const holidaysByDate = new Map([
      ['2026-09-12', { date: '2026-09-12', nameEn: 'Rosh Hashana', nameHe: 'ראש השנה', halfDay: false, blocking: true, source: 'dayoff' as const }],
    ]);
    const absencesByEmployee = new Map([
      ['a', new Map([['2026-09-12', { employeeId: 'a', date: '2026-09-12', classification: 'חופש' }]])],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-09-12', '2026-09-12'),
        workDays: [0, 1, 2, 3, 4, 5, 6],
        maxHoursPerDay: 8,
        holidaysByDate,
        absencesByEmployee,
      })
    );
    const day = result.current.byEmployee.get('a')!.byDate.get('2026-09-12')!;
    expect(day.reason).toBe('holiday');
  });

  it('absence drops the role-level availableEmployees count', () => {
    const employees = [
      makeEmployee({ id: 'a', role: 'Engineer' }),
      makeEmployee({ id: 'b', role: 'Engineer' }),
    ];
    const absencesByEmployee = new Map([
      ['a', new Map([['2026-05-05', { employeeId: 'a', date: '2026-05-05' }]])],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-05', '2026-05-05'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate: new Map(),
        absencesByEmployee,
      })
    );
    const day = result.current.byRole[0].byDate.get('2026-05-05')!;
    expect(day.availableEmployees).toBe(1);
    expect(day.totalEmployees).toBe(2);
    expect(day.hours).toBe(8); // only employee b worked
  });

  it('aggregates capacity per role across employees', () => {
    const employees = [
      makeEmployee({ id: 'a', role: 'Engineer', allocationPercentage: 100 }),
      makeEmployee({ id: 'b', role: 'Engineer', allocationPercentage: 50 }),
    ];
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-05', '2026-05-05'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate: new Map(),
      })
    );
    const engineerDay = result.current.byRole[0].byDate.get('2026-05-05')!;
    expect(engineerDay.hours).toBe(12);
    expect(engineerDay.availableEmployees).toBe(2);
    expect(engineerDay.totalEmployees).toBe(2);
    expect(engineerDay.capacity).toBe(12); // 8 + 4
  });

  it('treats non-blocking holidays as workdays but flags them via informationalHolidayKey', () => {
    const employees = [makeEmployee({ id: 'a', role: 'Engineer', allocationPercentage: 100 })];
    const holidaysByDate = new Map<string, Holiday>([
      // Lag B'Omer is informational only — should NOT block the day.
      ['2026-05-05', { date: '2026-05-05', nameHe: 'ל"ג בעומר', nameEn: 'Lag BaOmer', halfDay: false, blocking: false, source: 'dayoff' }],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-05', '2026-05-05'),
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate,
      })
    );
    const empDay = result.current.byEmployee.get('a')!.byDate.get('2026-05-05')!;
    expect(empDay.reason).toBe('workday');
    expect(empDay.hours).toBe(8);
    expect(empDay.informationalHolidayKey).toBe('2026-05-05');
    const roleDay = result.current.byRole[0].byDate.get('2026-05-05')!;
    expect(roleDay.reason).toBe('workday');
    expect(roleDay.capacity).toBe(8);
    expect(roleDay.informationalHolidayKey).toBe('2026-05-05');
  });

  it('does not inflate capacity on weekends or holidays', () => {
    const employees = [makeEmployee({ id: 'a', role: 'Engineer', allocationPercentage: 100 })];
    const holidaysByDate = new Map<string, Holiday>([
      ['2026-05-04', { date: '2026-05-04', nameHe: 'X', nameEn: 'X', halfDay: false, blocking: true, source: 'dayoff' }],
    ]);
    const { result } = renderHook(() =>
      useAvailability({
        employees,
        ...makeRange('2026-05-02', '2026-05-04'), // Sat (weekend), Sun (workday), Mon (holiday)
        workDays: [0, 1, 2, 3, 4],
        maxHoursPerDay: 8,
        holidaysByDate,
      })
    );
    const days = result.current.byRole[0].byDate;
    expect(days.get('2026-05-02')!.capacity).toBe(0); // weekend
    expect(days.get('2026-05-03')!.capacity).toBe(8); // workday
    expect(days.get('2026-05-04')!.capacity).toBe(0); // holiday
  });
});
