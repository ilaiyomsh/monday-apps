import { useMemo } from 'react';
import { 
  format, 
  startOfDay,
  endOfDay
} from 'date-fns';
import type { Task, Employee, RoleCapacity, Holiday } from '../types/gantt.types';
import type { AbsencesByEmployee } from '../types/entities/holiday.types';
import { isLoadCountedDay } from '../utils/workDaysUtils';

export interface CompanyLoadData {
  capacities: RoleCapacity[];
  loadByRole: Map<string, Map<string, number>>; // role -> dateKey (yyyy-MM-dd) -> allocatedHours
}

/**
 * Calculates total capacity for each role from employee data
 */
const calculateCapacities = (employees: Employee[], maxHoursPerDay: number = 8.5): RoleCapacity[] => {
  const capacitiesMap = new Map<string, RoleCapacity>();

  employees.forEach(emp => {
    const role = emp.role;
    const percentage = emp.allocationPercentage;
    const dailyHours = (percentage / 100) * maxHoursPerDay;

    if (!capacitiesMap.has(role)) {
      capacitiesMap.set(role, {
        role,
        totalDailyHours: 0,
        employeeCount: 0
      });
    }

    const current = capacitiesMap.get(role)!;
    current.totalDailyHours += dailyHours;
    current.employeeCount += 1;
  });

  return Array.from(capacitiesMap.values());
};

/**
 * Hook to calculate company load across roles.
 * Always calculates daily-based load (yyyy-MM-dd keys).
 */
export const useCompanyLoad = (
  allocations: Task[],
  employees: Employee[],
  // Rule 2: timelineStart/timelineEnd here are the LOAD window (the full loaded
  // data extent — earliest loaded past .. all future), NOT the scroll-bounded
  // render window. GanttProvider passes dataWindow.start/end so company load is
  // computed over every loaded allocation incl. past + inactive-project ones.
  timelineStart: Date,
  timelineEnd: Date,
  settings?: any,
  boardId?: string,
  holidaysByDate?: Map<string, Holiday>,
  absencesByEmployee?: AbsencesByEmployee
): CompanyLoadData => {
  const capacities = useMemo(() => calculateCapacities(employees, settings?.maxHoursPerDay), [employees, settings?.maxHoursPerDay]);

  const workDays = settings?.workDays || [0, 1, 2, 3, 4];

  // Create employee lookup map for resolving official roles
  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach(emp => map.set(emp.id, emp));
    return map;
  }, [employees]);

  return useMemo(() => {
    const loadByRole = new Map<string, Map<string, number>>();
    const viewStart = startOfDay(timelineStart);
    const viewEnd = endOfDay(timelineEnd);

    // Single source of truth: load is computed from the same allocations that
    // draw the bars (no separate workload-items fetch). This guarantees the
    // circle and the bars beneath it can never disagree.
    const sourceItems = allocations;

    // Pre-index items by the EMPLOYEE'S OFFICIAL ROLE (not the allocation's role/capability)
    // This ensures that when an employee is allocated with a capability different from their
    // official role, the hours are still counted against their official role's capacity
    const itemsByRole = new Map<string, Task[]>();
    sourceItems.forEach(item => {
      if (!item.startDate || !item.endDate) return;

      // Look up employee's official role using employeeId
      const employeeId = (item as any).employeeId;
      const employee = employeeId ? employeeById.get(employeeId) : null;
      // Use employee's official role if found, otherwise fall back to allocation's role
      const officialRole = employee?.role || item.role || '';
      const normalizedRole = officialRole.trim().toLowerCase();

      if (!itemsByRole.has(normalizedRole)) {
        itemsByRole.set(normalizedRole, []);
      }
      itemsByRole.get(normalizedRole)!.push(item);
    });

    capacities.forEach(cap => {
      const dailyMap = new Map<string, number>();
      const normalizedCapRole = (cap.role || '').trim().toLowerCase();

      // Get only items matching this role - O(1) lookup
      const roleItems = itemsByRole.get(normalizedCapRole) || [];

      roleItems.forEach(item => {
        const itemStart = startOfDay(new Date(item.startDate));
        const itemEnd = endOfDay(new Date(item.endDate));
        const start = itemStart < viewStart ? viewStart : itemStart;
        const end = itemEnd > viewEnd ? viewEnd : itemEnd;

        if (start > end) return;

        // Resolve this allocation's employee so we can drop hours on days that
        // employee is personally off — those don't count toward load (same rule
        // as the per-employee row; keeps circles and bars consistent).
        const absenceMap = absencesByEmployee?.get(String((item as any).employeeId));

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateKey = format(d, 'yyyy-MM-dd');
          if (!isLoadCountedDay(d, dateKey, workDays, holidaysByDate, absenceMap)) continue;

          const currentHours = dailyMap.get(dateKey) || 0;
          dailyMap.set(dateKey, currentHours + (item.hoursPerDay || 0));
        }
      });

      loadByRole.set(cap.role, dailyMap);
    });

    return { capacities, loadByRole };
  }, [allocations, capacities, timelineStart, timelineEnd, workDays, employeeById, holidaysByDate, absencesByEmployee]);
};
