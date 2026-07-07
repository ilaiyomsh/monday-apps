import { format } from 'date-fns';
import type { Holiday } from '../types/entities/holiday.types';

/**
 * בדיקה האם יום הוא יום עבודה
 * @param date - התאריך לבדיקה
 * @param workDays - מערך של ימי עבודה (0=ראשון, 1=שני, ..., 6=שבת)
 */
export function isWorkingDay(date: Date, workDays: number[]): boolean {
  return workDays.includes(date.getDay());
}

/**
 * Whether an allocation's hours on a given day should COUNT toward load.
 *
 * Per the load model, allocation hours that fall on a day the employee is not
 * available (weekend, full company holiday, or personal day-off) are NOT
 * counted — the day behaves like a weekend and simply doesn't exist in the
 * math. Half-day holidays still count (capacity is merely halved elsewhere).
 *
 * `absenceMap` is the employee's own per-day absence map (the inner map of
 * AbsencesByEmployee); pass undefined for company/role contexts that resolve
 * absence per-allocation by passing the relevant employee's map.
 */
export function isLoadCountedDay(
  date: Date,
  dateKey: string,
  workDays: number[],
  holidaysByDate?: Map<string, Holiday>,
  absenceMap?: Map<string, unknown>
): boolean {
  if (!isWorkingDay(date, workDays)) return false;
  const holiday = holidaysByDate?.get(dateKey);
  if (holiday?.blocking && !holiday.halfDay) return false; // full company holiday
  if (absenceMap?.has(dateKey)) return false; // personal day-off
  return true;
}

/**
 * ספירת ימי עבודה בטווח תאריכים.
 *
 * אם מועבר `holidaysByDate`, ימי חברה כלליים (חג חוסם מלא — לא חצי יום)
 * מתנהגים כמו סוף שבוע ולא נספרים. ימי חופש אישיים אינם מועברים לכאן ולכן
 * אינם משפיעים על ספירת ימי ההקצאה (הבר נשאר שלם עליהם).
 * @param startDate - תאריך התחלה
 * @param endDate - תאריך סיום
 * @param workDays - מערך של ימי עבודה
 * @param holidaysByDate - אופציונלי: מפת חגי חברה להחרגה (כמו סוף שבוע)
 */
export function countWorkingDays(
  startDate: Date,
  endDate: Date,
  workDays: number[],
  holidaysByDate?: Map<string, Holiday>
): number {
  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);

  // נרמל תאריכים לתחילת היום כדי למנוע בעיות של שעות
  current.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    if (isWorkingDay(current, workDays)) {
      const holiday = holidaysByDate?.get(format(current, 'yyyy-MM-dd'));
      // Full company holiday (blocking, not half-day) counts like a weekend.
      if (!(holiday?.blocking && !holiday.halfDay)) {
        count++;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * מספר ימי עבודה בשבוע
 */
export function getWorkDaysPerWeek(workDays: number[]): number {
  return workDays.length;
}

/**
 * מספר ימי עבודה ממוצע בחודש
 * מבוסס על 52 שבועות בשנה / 12 חודשים
 */
export function getAverageWorkDaysPerMonth(workDays: number[]): number {
  const daysPerWeek = getWorkDaysPerWeek(workDays);
  return (daysPerWeek * 52) / 12;
}
