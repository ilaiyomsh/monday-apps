import { useMemo } from 'react';
import { format, startOfDay, endOfDay, startOfWeek, startOfQuarter } from 'date-fns';
import type { Task, ZoomLevel, WorkloadMap, WorkloadEntry } from '../types/gantt.types';
import { isWorkingDay } from '../utils/workDaysUtils';

/**
 * Hook to calculate workload for a set of tasks across the displayed days.
 * Single source of truth: always computed from the provided tasks (the same
 * allocations that draw the bars) — no separate workload-items fetch.
 */
export const useWorkloadCalculator = (
  tasks: Task[],
  displayDays: Date[],
  zoomLevel: ZoomLevel,
  settings?: any
): WorkloadMap => {
  return useMemo(() => {
    const workload = new Map<string, number>();
    const result = new Map<string, WorkloadEntry>();

    const isMonthly = zoomLevel === 'month';
    const isWeekly = zoomLevel === 'week';
    const isQuarterly = zoomLevel === 'quarter';
    
    if (displayDays.length === 0) return result;
    const viewStart = startOfDay(displayDays[0]);
    const viewEnd = endOfDay(displayDays[displayDays.length - 1]);

    const workDays = settings?.workDays || [0, 1, 2, 3, 4];
    const maxHoursPerDay = settings?.maxHoursPerDay || 8.5;
    const maxHoursPerWeek = settings?.maxHoursPerWeek || 42.5;
    const maxHoursPerMonth = settings?.maxHoursPerMonth || 182;

    tasks.forEach((item) => {
      if (!item.startDate || !item.endDate) return;
      
      const itemStart = startOfDay(new Date(item.startDate));
      const itemEnd = endOfDay(new Date(item.endDate));

      // Calculate intersection with view
      const start = itemStart < viewStart ? viewStart : itemStart;
      const end = itemEnd > viewEnd ? viewEnd : itemEnd;

      if (start > end) return;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (!isWorkingDay(d, workDays)) continue;

        let key = format(d, 'yyyy-MM-dd');
        if (isMonthly || isWeekly) {
          key = format(startOfWeek(d, { weekStartsOn: 0 }), 'yyyy-ww');
        } else if (isQuarterly) {
          key = format(startOfQuarter(d), 'yyyy-Qq');
        }
        
        workload.set(key, (workload.get(key) || 0) + (item.hoursPerDay || 0));
      }
    });

    // Convert to WorkloadEntry with status
    workload.forEach((hours, key) => {
      const threshold = isWeekly ? maxHoursPerWeek : isMonthly ? maxHoursPerMonth : isQuarterly ? maxHoursPerMonth * 3 : maxHoursPerDay;
      
      let status: WorkloadEntry['status'] = 'normal';
      if (hours > threshold) status = 'overload';
      else if (hours < threshold) status = 'light';

      result.set(key, { key, hours, status });
    });

    return result;
  }, [tasks, displayDays, zoomLevel, settings]);
};
