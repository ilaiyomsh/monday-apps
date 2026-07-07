import { useMemo } from 'react';
import { format, startOfDay, endOfDay } from 'date-fns';
import type { Task, Employee, Holiday } from '../types/gantt.types';
import type { AbsencesByEmployee } from '../types/entities/holiday.types';
import { isLoadCountedDay } from '../utils/workDaysUtils';

export interface EmployeeLoadData {
  // Map<employeeId, Map<dateKey 'yyyy-MM-dd', hoursAllocatedThatDay>>
  loadByEmployee: Map<string, Map<string, number>>;
}

/**
 * Aggregates each employee's daily allocation hours across all of their projects.
 * Used to power the per-employee load row in the Employees tab.
 *
 * Hours on days the employee is unavailable (weekend, full company holiday,
 * personal day-off) are EXCLUDED — the day behaves like a weekend and doesn't
 * exist in the load math (so an allocation on a day-off never inflates load).
 */
export const useEmployeeLoad = (
  allocations: Task[],
  employees: Employee[],
  timelineStart: Date,
  timelineEnd: Date,
  settings?: { workDays?: number[] } | null,
  holidaysByDate?: Map<string, Holiday>,
  absencesByEmployee?: AbsencesByEmployee
): EmployeeLoadData => {
  const workDays = settings?.workDays || [0, 1, 2, 3, 4];

  const employeeIds = useMemo(() => new Set(employees.map((e) => String(e.id))), [employees]);

  return useMemo(() => {
    const loadByEmployee = new Map<string, Map<string, number>>();
    const viewStart = startOfDay(timelineStart);
    const viewEnd = endOfDay(timelineEnd);

    allocations.forEach((task) => {
      if (!task.startDate || !task.endDate) return;
      const empId = (task as any).employeeId;
      if (!empId || !employeeIds.has(String(empId))) return;

      const itemStart = startOfDay(new Date(task.startDate));
      const itemEnd = endOfDay(new Date(task.endDate));
      const start = itemStart < viewStart ? viewStart : itemStart;
      const end = itemEnd > viewEnd ? viewEnd : itemEnd;
      if (start > end) return;

      let dailyMap = loadByEmployee.get(String(empId));
      if (!dailyMap) {
        dailyMap = new Map<string, number>();
        loadByEmployee.set(String(empId), dailyMap);
      }
      const absenceMap = absencesByEmployee?.get(String(empId));

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateKey = format(d, 'yyyy-MM-dd');
        if (!isLoadCountedDay(d, dateKey, workDays, holidaysByDate, absenceMap)) continue;
        const cur = dailyMap.get(dateKey) || 0;
        dailyMap.set(dateKey, cur + (task.hoursPerDay || 0));
      }
    });

    return { loadByEmployee };
  }, [allocations, employeeIds, timelineStart, timelineEnd, workDays, holidaysByDate, absencesByEmployee]);
};
