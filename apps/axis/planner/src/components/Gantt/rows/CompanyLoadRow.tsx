import React, { memo, useMemo } from 'react';
import { format, startOfWeek, startOfMonth, startOfQuarter, endOfDay, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { LoadRow as LoadRowType, ZoomLevel, DailyLoad, RoleAvailability } from '../../../types/gantt.types';
import { useGantt } from '../../../hooks/useGantt';
import { useLocale } from '../../../hooks/useLocale';
import { LoadCell } from './LoadCell';
import { isWorkingDay } from '../../../utils/workDaysUtils';

interface CompanyLoadRowProps {
  loadData: LoadRowType;
}

const getPeriodKey = (date: Date, zoom: ZoomLevel): string => {
  if (zoom === 'day') return format(date, 'yyyy-MM-dd');
  if (zoom === 'week') {
    // Use yyyy-MM-dd format to match TimelineHeader grouping
    const weekStart = startOfWeek(date, { weekStartsOn: 0 });
    return format(weekStart, 'yyyy-MM-dd');
  }
  if (zoom === 'month') {
    return format(startOfMonth(date), 'yyyy-MM-dd');
  }
  if (zoom === 'quarter') {
    return format(startOfQuarter(date), 'yyyy-MM-dd');
  }
  return format(date, 'yyyy-MM-dd');
};

/**
 * Aggregates daily load data into a period-based DailyLoad object.
 *
 * When `roleAvailability` is provided, per-day capacity is read from the
 * availability map — which already accounts for weekends, holidays, half-days,
 * and personal absences. Without it, falls back to flat (capacity × workingDays).
 */
const aggregateLoad = (
  dailyLoads: Map<string, number>,
  periodStart: Date,
  periodEnd: Date,
  flatDailyCapacity: number,
  workDays: number[],
  roleAvailability?: RoleAvailability
): DailyLoad => {
  let totalAllocated = 0;
  let totalCapacity = 0;
  let workingDaysCount = 0;
  const current = new Date(periodStart);
  const end = endOfDay(periodEnd);

  while (current <= end) {
    const key = format(current, 'yyyy-MM-dd');
    if (roleAvailability) {
      const day = roleAvailability.byDate.get(key);
      if (day && day.capacity > 0) {
        totalCapacity += day.capacity;
        workingDaysCount++;
        totalAllocated += dailyLoads.get(key) || 0;
      }
      // Days with capacity===0 (weekend/holiday/everyone absent) contribute
      // neither capacity nor allocation — load on such a day would still bleed
      // into utilization, so add allocations on workdays only.
    } else if (isWorkingDay(current, workDays)) {
      totalAllocated += dailyLoads.get(key) || 0;
      totalCapacity += flatDailyCapacity;
      workingDaysCount++;
    }
    current.setDate(current.getDate() + 1);
  }

  const totalAvailable = totalCapacity - totalAllocated;
  const utilization = totalCapacity > 0 ? (totalAllocated / totalCapacity) * 100 : 0;

  return {
    date: format(periodStart, 'yyyy-MM-dd'),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    allocatedHours: totalAllocated,
    availableHours: totalAvailable,
    utilizationPercent: utilization,
    daysInPeriod: workingDaysCount,
  };
};

/**
 * CompanyLoadRow displays the daily capacity and utilization for a specific role
 */
export const CompanyLoadRow: React.FC<CompanyLoadRowProps> = memo(({ loadData }) => {
  const { t } = useTranslation();
  const { role, capacity, dailyLoads, variant, totalAvailability, summary, loadGate } = loadData;
  const { displayDays, pixelsPerDay, zoomLevel, getXByDate, sidebarWidth, settings, availability } = useGantt();
  const locale = useLocale();

  const workDays = settings?.workDays || [0, 1, 2, 3, 4];
  const roleAvailability = useMemo(
    () => totalAvailability ?? availability?.byRole.find((r) => r.role === role),
    [availability, role, totalAvailability]
  );
  const isSummary = variant === 'summary';

  /**
   * Create column definitions based on zoom level
   * Each column knows its X position (calculated from date) and width
   */
  const columns = useMemo(() => {
    if (zoomLevel === 'day') {
      return displayDays.map(day => ({
        key: format(day, 'yyyy-MM-dd'),
        x: getXByDate(day),
        width: pixelsPerDay,
        periodStart: startOfDay(day),
        periodEnd: endOfDay(day)
      }));
    }
    
    const periodMap = new Map<string, { count: number, start: Date, end: Date }>();
    const periodOrder: string[] = []; // Track insertion order
    
    displayDays.forEach(day => {
      const periodKey = getPeriodKey(day, zoomLevel);
      if (!periodMap.has(periodKey)) {
        // Use the actual day as start/end, not the calendar week/month boundaries
        periodMap.set(periodKey, { count: 0, start: day, end: day });
        periodOrder.push(periodKey);
      }
      const period = periodMap.get(periodKey)!;
      period.count++;
      // Track actual first and last displayed days in this period
      if (day < period.start) period.start = day;
      if (day > period.end) period.end = day;
    });
    
    // Return columns in insertion order with X position calculated from start date
    return periodOrder.map(key => {
      const { count, start, end } = periodMap.get(key)!;
      return {
        key,
        x: getXByDate(start),
        width: count * pixelsPerDay,
        periodStart: startOfDay(start),
        periodEnd: endOfDay(end)
      };
    });
  }, [displayDays, zoomLevel, pixelsPerDay, getXByDate]);

  return (
    <div className="flex h-full group transition-colors border-b-2 border-border-default bg-bg-section hover:bg-bg-emphasis">
      {/* Sidebar: a single, non-collapsible company-average title. */}
      <div
        className="sticky left-0 h-full transition-colors flex items-center gap-2 px-4 shadow-[var(--shadow-sticky-col)] z-40 border-r border-border-default bg-bg-section"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        dir="ltr"
      >
        {/* Title pinned to the visual left (dir kept for correct Hebrew word order). */}
        <div className="flex-1 flex flex-col overflow-hidden" dir={locale.dir} style={{ textAlign: 'left' }}>
          <span className="font-bold text-text-primary text-sm truncate">
            {summary?.title}
          </span>
        </div>
      </div>

      {/* Gantt Area - Load Cells positioned absolutely like TaskBars */}
      <div className="relative flex-1 bg-bg-surface">
        {columns.map((col) => {
          const load = aggregateLoad(dailyLoads, col.periodStart, col.periodEnd, capacity.totalDailyHours, workDays, roleAvailability);

          // All-or-nothing reveal: EVERY circle stays in skeleton until the load
          // is computed for all periods (the background past window has settled),
          // instead of current/future circles popping in before the past lands.
          // needsPast still scopes the per-cell error/retry to the past window.
          const needsPast = !!loadGate && col.periodStart.getTime() < loadGate.settledFromTs;
          const cellError = needsPast && loadGate!.pastError ? { onRetry: loadGate!.onRetry } : null;
          const cellRecomputing = !!loadGate && loadGate.pastPending;

          return (
            <div
              key={col.key}
              style={{
                position: 'absolute',
                left: col.x,
                width: col.width,
                height: '100%'
              }}
              className="border-l border-border-faint"
            >
              <LoadCell
                load={load}
                totalCapacity={capacity.totalDailyHours}
                zoomLevel={zoomLevel}
                tooltipTitle={isSummary ? t('companyLoad.tooltipTitleCompany') : t('companyLoad.tooltipTitleRole', { role })}
                recomputing={cellRecomputing}
                error={cellError}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

CompanyLoadRow.displayName = 'CompanyLoadRow';
