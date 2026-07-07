import { EffortDisplayMode } from '../types/settings.types';
import type { ZoomLevel } from '../types/gantt.types';
import { getWorkDaysPerWeek, getAverageWorkDaysPerMonth } from './workDaysUtils';

/**
 * getDefaultEffortModeByZoom - Returns the default effort display mode for a given zoom level
 */
export function getDefaultEffortModeByZoom(zoomLevel: ZoomLevel): EffortDisplayMode {
  switch (zoomLevel) {
    case 'day':
      return 'hours_day';
    case 'week':
      return 'hours_week';
    case 'month':
    case 'quarter':
      return 'days_month';
    default:
      return 'hours_day';
  }
}

/**
 * formatNum - Formats a number to 1 decimal place, but removes .0 if it's a whole number
 */
export const formatNum = (n: number): string => {
  return Number(n.toFixed(1)).toString();
};

/**
 * formatEffort - Formats the effort based on the selected mode
 * @param hoursPerDay - Number of hours allocated per day
 * @param durationDays - Number of working days in the allocation
 * @param mode - The selected EffortDisplayMode
 * @param settings - The max hours settings and work days
 * @returns Formatted effort string
 */
export function formatEffort(
  hoursPerDay: number,
  durationDays: number,
  mode: EffortDisplayMode,
  settings: { 
    maxHoursPerDay: number; 
    maxHoursPerWeek: number; 
    maxHoursPerMonth: number;
    workDays: number[];
  }
): string {
  const workDaysPerWeek = getWorkDaysPerWeek(settings.workDays || [0, 1, 2, 3, 4]);

  switch (mode) {
    case 'hours_day':
      return `${formatNum(hoursPerDay)} ש'/יום`;
    case 'hours_week':
      return `${formatNum(hoursPerDay * workDaysPerWeek)} ש'/שבוע`;
    case 'days_month':
      return `${formatNum((hoursPerDay / settings.maxHoursPerDay) * settings.maxHoursPerMonth)} ש'/חודש`;
    case 'fte':
      return `${formatNum((hoursPerDay / settings.maxHoursPerDay) * 100)}% אחוז משרה`;
    case 'total_hours':
      return `${formatNum(hoursPerDay * durationDays)} שעות`;
    default:
      return `${formatNum(hoursPerDay)} ש'/יום`;
  }
}

/**
 * isOverCapacity - Checks if the allocation is over capacity (FTE > 1)
 * @param hoursPerDay - Number of hours allocated per day
 * @param maxHoursPerDay - Max hours per day setting
 * @returns true if over capacity
 */
export function isOverCapacity(hoursPerDay: number, maxHoursPerDay: number): boolean {
  return hoursPerDay > maxHoursPerDay;
}
