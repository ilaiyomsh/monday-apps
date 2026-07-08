import { differenceInDays, addDays, parseISO } from 'date-fns';
import { useCallback } from 'react';
import type { ZoomLevel } from '../types/gantt.types';
import { PIXELS_PER_DAY, GLOBAL_START_DATE } from '../utils/constants';

interface CoordinateSystemReturn {
  getXByDate: (date: Date | string) => number;
  getDateByX: (x: number) => Date;
  getWidthByDates: (start: Date | string, end: Date | string) => number;
  pixelsPerDay: number;
  isDateInView: (date: Date | string, scrollLeft: number, viewportWidth: number) => boolean;
  isTaskInView: (startDate: Date | string, endDate: Date | string, scrollLeft: number, viewportWidth: number) => boolean;
}

/**
 * Hook for converting between dates and pixel coordinates
 * Supports dynamic timeline start for infinite scroll
 */
export const useCoordinateSystem = (
  zoomLevel: ZoomLevel, 
  timelineStart: Date = GLOBAL_START_DATE
): CoordinateSystemReturn => {
  const pixelsPerDay = PIXELS_PER_DAY[zoomLevel];

  /**
   * Convert a date to X position in pixels relative to timeline start
   */
  const getXByDate = useCallback((date: Date | string): number => {
    const d = typeof date === 'string' ? parseISO(date) : date;
    const diff = differenceInDays(d, timelineStart);
    return diff * pixelsPerDay;
  }, [timelineStart, pixelsPerDay]);

  /**
   * Convert X position in pixels to a date
   */
  const getDateByX = useCallback((x: number): Date => {
    const daysToAdd = Math.round(x / pixelsPerDay);
    return addDays(timelineStart, daysToAdd);
  }, [timelineStart, pixelsPerDay]);

  /**
   * Calculate width in pixels between two dates
   * Returns at least 1 day width
   */
  const getWidthByDates = useCallback((start: Date | string, end: Date | string): number => {
    const s = typeof start === 'string' ? parseISO(start) : start;
    const e = typeof end === 'string' ? parseISO(end) : end;
    const diff = differenceInDays(e, s) + 1; // +1 to include end date
    return Math.max(diff * pixelsPerDay, pixelsPerDay);
  }, [pixelsPerDay]);

  /**
   * Check if a date is visible in the current viewport
   * Useful for horizontal virtualization
   */
  const isDateInView = useCallback((
    date: Date | string,
    scrollLeft: number,
    viewportWidth: number,
    buffer: number = 100
  ): boolean => {
    const x = getXByDate(date);
    return x >= scrollLeft - buffer && x <= scrollLeft + viewportWidth + buffer;
  }, [getXByDate]);

  /**
   * Check if a task (date range) is visible in the current viewport
   * Returns true if any part of the task is visible
   */
  const isTaskInView = useCallback((
    startDate: Date | string,
    endDate: Date | string,
    scrollLeft: number,
    viewportWidth: number,
    buffer: number = 100
  ): boolean => {
    const taskStart = getXByDate(startDate);
    const taskEnd = getXByDate(endDate);
    const viewStart = scrollLeft - buffer;
    const viewEnd = scrollLeft + viewportWidth + buffer;
    
    // Task is visible if it overlaps with the viewport
    return taskEnd >= viewStart && taskStart <= viewEnd;
  }, [getXByDate]);

  return {
    getXByDate,
    getDateByX,
    getWidthByDates,
    pixelsPerDay,
    isDateInView,
    isTaskInView,
  };
};
