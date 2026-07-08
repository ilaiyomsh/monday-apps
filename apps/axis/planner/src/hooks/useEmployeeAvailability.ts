import { useMemo } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import type { Task, Employee, TaskId } from '../types/gantt.types';
import type { PlannerSettings } from '../types/settings.types';
import { countWorkingDays, isWorkingDay } from '../utils/workDaysUtils';

export interface AvailabilityData {
  hoursPerDay: number;
  loadPercent: number;
}

/**
 * Hook to calculate current workload for each employee during a specific task's period.
 */
export const useEmployeeAvailability = (
  employees: Employee[],
  allTasks: Task[],
  taskStartDate: string,
  taskEndDate: string,
  currentTaskId: TaskId,
  settings: PlannerSettings
): Map<string, AvailabilityData> => {
  return useMemo(() => {
    const availabilityMap = new Map<string, AvailabilityData>();
    if (!taskStartDate || !taskEndDate || !settings) return availabilityMap;

    const startDate = new Date(taskStartDate);
    const endDate = new Date(taskEndDate);
    const workDays = settings.workDays || [0, 1, 2, 3, 4];
    const maxHoursPerDay = settings.maxHoursPerDay || 8.5;

    // Calculate working days in the period
    const workingDaysInPeriod = countWorkingDays(startDate, endDate, workDays);
    if (workingDaysInPeriod === 0) return availabilityMap;

    const viewStart = startOfDay(startDate);
    const viewEnd = endOfDay(endDate);

    employees.forEach(employee => {
      let totalAllocatedHoursInPeriod = 0;

      // Filter tasks for this employee
      const employeeTasks = allTasks.filter(t => 
        (t.employeeId === employee.userId || t.employeeId === employee.name || t.employeeId === employee.id)
      );

      employeeTasks.forEach(item => {
        if (!item.startDate || !item.endDate) return;

        const itemStart = startOfDay(new Date(item.startDate));
        const itemEnd = endOfDay(new Date(item.endDate));

        // Calculate intersection with the period
        const intersectStart = itemStart < viewStart ? viewStart : itemStart;
        const intersectEnd = itemEnd > viewEnd ? viewEnd : itemEnd;

        if (intersectStart <= intersectEnd) {
          // Count working days in the intersection
          for (let d = new Date(intersectStart); d <= intersectEnd; d.setDate(d.getDate() + 1)) {
            if (isWorkingDay(d, workDays)) {
              totalAllocatedHoursInPeriod += (item.hoursPerDay || 0);
            }
          }
        }
      });

      const averageHoursPerDay = totalAllocatedHoursInPeriod / workingDaysInPeriod;
      const loadPercent = (averageHoursPerDay / maxHoursPerDay) * 100;

      availabilityMap.set(employee.id, {
        hoursPerDay: averageHoursPerDay,
        loadPercent: loadPercent
      });
    });

    return availabilityMap;
  }, [employees, allTasks, taskStartDate, taskEndDate, currentTaskId, settings]);
};
