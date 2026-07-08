import { useMemo } from 'react';
import { format, eachDayOfInterval } from 'date-fns';
import type {
  Employee,
  EmployeeAvailability,
  RoleAvailability,
  AvailabilityDayInfo,
  RoleAvailabilityDay,
  Holiday,
  EmployeeAbsence,
  AbsencesByEmployee,
} from '../types/gantt.types';
import { isWorkingDay } from '../utils/workDaysUtils';

interface Options {
  employees: Employee[];
  timelineStart: Date;
  timelineEnd: Date;
  workDays: number[];
  maxHoursPerDay: number;
  holidaysByDate: Map<string, Holiday>;
  absencesByEmployee?: AbsencesByEmployee;
}

export interface AvailabilityData {
  byRole: RoleAvailability[];
  byEmployee: Map<string, EmployeeAvailability>;
}

const buildDayInfo = (
  day: Date,
  workDays: number[],
  holiday: Holiday | undefined,
  absence: EmployeeAbsence | undefined,
  maxHoursPerDay: number,
  ftePercent: number
): AvailabilityDayInfo => {
  if (!isWorkingDay(day, workDays)) {
    return { hours: 0, dayFactor: 0, reason: 'weekend' };
  }
  // Only blocking holidays remove the day. Informational holidays (e.g.
  // Lag B'Omer) fall through to workday but surface their name via
  // `informationalHolidayKey` so the cell tooltip can still display it.
  const isBlockingHoliday = holiday?.blocking === true;
  if (isBlockingHoliday && !holiday!.halfDay) {
    return { hours: 0, dayFactor: 0, reason: 'holiday', holidayKey: holiday!.date };
  }
  // Personal absence (full day) overrides everything except weekend/full-holiday.
  if (absence) {
    return {
      hours: 0,
      dayFactor: 0,
      reason: 'absence',
      absenceClassification: absence.classification,
    };
  }
  if (isBlockingHoliday && holiday!.halfDay) {
    const hours = (ftePercent / 100) * maxHoursPerDay * 0.5;
    return { hours, dayFactor: 0.5, reason: 'halfDay', holidayKey: holiday!.date };
  }
  const hours = (ftePercent / 100) * maxHoursPerDay;
  const informationalHolidayKey = holiday && !isBlockingHoliday ? holiday.date : undefined;
  return { hours, dayFactor: 1, reason: 'workday', informationalHolidayKey };
};

export const useAvailability = ({
  employees,
  timelineStart,
  timelineEnd,
  workDays,
  maxHoursPerDay,
  holidaysByDate,
  absencesByEmployee,
}: Options): AvailabilityData => {
  return useMemo(() => {
    const days =
      timelineStart && timelineEnd && timelineStart <= timelineEnd
        ? eachDayOfInterval({ start: timelineStart, end: timelineEnd })
        : [];
    const dayKeys = days.map((d) => ({ date: d, key: format(d, 'yyyy-MM-dd') }));

    const byEmployee = new Map<string, EmployeeAvailability>();
    const roleMap = new Map<string, RoleAvailability>();

    employees.forEach((emp) => {
      const role = emp.role || '';
      if (!roleMap.has(role)) {
        roleMap.set(role, { role, totalEmployees: 0, byDate: new Map() });
      }
      roleMap.get(role)!.totalEmployees += 1;
    });

    employees.forEach((emp) => {
      const role = emp.role || '';
      const ftePercent = Math.max(0, Math.min(100, emp.allocationPercentage ?? 0));
      const empAvail: EmployeeAvailability = { employeeId: emp.id, byDate: new Map() };
      const roleAgg = roleMap.get(role)!;
      const empAbsences = absencesByEmployee?.get(emp.id);

      for (const { date, key } of dayKeys) {
        const holiday = holidaysByDate.get(key);
        const absence = empAbsences?.get(key);
        const info = buildDayInfo(date, workDays, holiday, absence, maxHoursPerDay, ftePercent);
        empAvail.byDate.set(key, info);

        const roleDay: RoleAvailabilityDay =
          roleAgg.byDate.get(key) ?? {
            hours: 0,
            capacity: 0,
            availableEmployees: 0,
            totalEmployees: roleAgg.totalEmployees,
            // Reason at role level mirrors the per-day classification (which
            // doesn't depend on which employee we're looking at). Initialised
            // to 'workday' and downgraded to weekend/holiday/halfDay as needed.
            reason: 'workday',
            holidayKey: undefined,
            informationalHolidayKey: undefined,
          };
        roleDay.hours += info.hours;
        // Per the load model: a personal day-off behaves EXACTLY like a weekend
        // — the day simply does not exist in the load math. An absent employee
        // contributes neither capacity nor allocation that day, so the role's
        // denominator reflects only the people actually available. (Previously
        // absences were added to capacity to drop free%; that inflated the
        // denominator and made load read artificially low.)
        if (info.dayFactor > 0) {
          roleDay.capacity += (ftePercent / 100) * maxHoursPerDay * info.dayFactor;
          roleDay.availableEmployees += 1;
        }
        // Lift weekend/holiday/halfDay reason to the role row. Personal absences
        // are NOT lifted — those are per-employee.
        if (info.reason === 'weekend' || info.reason === 'holiday' || info.reason === 'halfDay') {
          roleDay.reason = info.reason;
          roleDay.holidayKey = info.holidayKey;
        }
        if (info.informationalHolidayKey) {
          roleDay.informationalHolidayKey = info.informationalHolidayKey;
        }
        roleAgg.byDate.set(key, roleDay);
      }

      byEmployee.set(emp.id, empAvail);
    });

    const byRole = Array.from(roleMap.values()).sort((a, b) =>
      a.role.localeCompare(b.role, undefined, { sensitivity: 'base' })
    );

    return { byRole, byEmployee };
  }, [employees, timelineStart, timelineEnd, workDays, maxHoursPerDay, holidaysByDate, absencesByEmployee]);
};
