import React, { memo, useMemo } from 'react';
import { format, startOfWeek, startOfMonth, startOfQuarter, endOfDay, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { EmployeeLoadRowData, ZoomLevel, DailyLoad, EmployeeAvailability } from '../../../types/gantt.types';
import { useGantt } from '../../../hooks/useGantt';
import { useLocale } from '../../../hooks/useLocale';
import { LoadCell, type LoadCellAbsenceInfo } from './LoadCell';
import { isWorkingDay } from '../../../utils/workDaysUtils';

interface Props {
  row: EmployeeLoadRowData;
}

const getPeriodKey = (date: Date, zoom: ZoomLevel): string => {
  if (zoom === 'day') return format(date, 'yyyy-MM-dd');
  if (zoom === 'week') return format(startOfWeek(date, { weekStartsOn: 0 }), 'yyyy-MM-dd');
  if (zoom === 'month') return format(startOfMonth(date), 'yyyy-MM-dd');
  if (zoom === 'quarter') return format(startOfQuarter(date), 'yyyy-MM-dd');
  return format(date, 'yyyy-MM-dd');
};

interface AggregatedPeriod {
  load: DailyLoad;
  absenceInfo?: LoadCellAbsenceInfo;
}

const aggregateLoad = (
  dailyLoads: Map<string, number>,
  periodStart: Date,
  periodEnd: Date,
  flatDailyCapacity: number,
  workDays: number[],
  employeeAvailability?: EmployeeAvailability
): AggregatedPeriod => {
  let totalAllocated = 0;
  let totalCapacity = 0;
  let workingDaysCount = 0;
  const absenceClassifications: string[] = [];
  const current = new Date(periodStart);
  const end = endOfDay(periodEnd);
  while (current <= end) {
    const key = format(current, 'yyyy-MM-dd');
    if (employeeAvailability) {
      const day = employeeAvailability.byDate.get(key);
      if (day && day.hours > 0) {
        totalCapacity += day.hours;
        workingDaysCount++;
        totalAllocated += dailyLoads.get(key) || 0;
      } else if (day && day.reason === 'absence') {
        // A personal day-off behaves like a weekend: it adds NO capacity to the
        // denominator AND its allocation hours are not counted (already excluded
        // from `dailyLoads`). We only record the classification so a fully-off
        // period can render an "absence" marker instead of an empty 0%.
        absenceClassifications.push(day.absenceClassification || '');
      }
    } else if (isWorkingDay(current, workDays)) {
      totalAllocated += dailyLoads.get(key) || 0;
      totalCapacity += flatDailyCapacity;
      workingDaysCount++;
    }
    current.setDate(current.getDate() + 1);
  }
  const totalAvailable = totalCapacity - totalAllocated;
  const utilization = totalCapacity > 0 ? (totalAllocated / totalCapacity) * 100 : 0;

  // Surface an absence label only when the period has no working capacity AND
  // no allocation — i.e. the cell would otherwise look empty. With allocation,
  // the red overload visuals carry the meaning ("scheduled on a day off").
  let absenceInfo: LoadCellAbsenceInfo | undefined;
  if (absenceClassifications.length > 0 && totalCapacity < 0.1 && totalAllocated < 0.1) {
    const firstNamed = absenceClassifications.find((c) => c.length > 0);
    absenceInfo = { classification: firstNamed || '' };
  }

  return {
    load: {
      date: format(periodStart, 'yyyy-MM-dd'),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      allocatedHours: totalAllocated,
      availableHours: totalAvailable,
      utilizationPercent: utilization,
      daysInPeriod: workingDaysCount,
    },
    absenceInfo,
  };
};

/**
 * EmployeeLoadRow — the single, always-visible per-employee row in the
 * Employees tab. The sidebar carries the employee's name, FTE and a chevron
 * (and participates in the focus/selection behavior); the circles show the
 * employee's PLANNED LOAD (allocated hours ÷ availability). Expanding the row
 * reveals the allocation tracks below.
 */
export const EmployeeLoadRow: React.FC<Props> = memo(({ row }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const {
    displayDays,
    pixelsPerDay,
    zoomLevel,
    getXByDate,
    sidebarWidth,
    settings,
    availability,
    toggleGroup,
    selectedEmployeeId,
    setSelectedEmployeeId,
  } = useGantt();
  const { dailyCapacity, dailyLoads, employee, role, expandable, isExpanded, groupId, loadGate } = row;
  const empAvail = availability?.byEmployee.get(employee.id);

  const workDays = settings?.workDays || [0, 1, 2, 3, 4];

  const columns = useMemo(() => {
    if (zoomLevel === 'day') {
      return displayDays.map((day) => ({
        key: format(day, 'yyyy-MM-dd'),
        x: getXByDate(day),
        width: pixelsPerDay,
        periodStart: startOfDay(day),
        periodEnd: endOfDay(day),
      }));
    }
    const periodMap = new Map<string, { count: number; start: Date; end: Date }>();
    const periodOrder: string[] = [];
    displayDays.forEach((day) => {
      const periodKey = getPeriodKey(day, zoomLevel);
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, { count: 0, start: day, end: day });
        periodOrder.push(periodKey);
      }
      const period = periodMap.get(periodKey)!;
      period.count++;
      if (day < period.start) period.start = day;
      if (day > period.end) period.end = day;
    });
    return periodOrder.map((key) => {
      const { count, start, end } = periodMap.get(key)!;
      return {
        key,
        x: getXByDate(start),
        width: count * pixelsPerDay,
        periodStart: startOfDay(start),
        periodEnd: endOfDay(end),
      };
    });
  }, [displayDays, zoomLevel, pixelsPerDay, getXByDate]);

  const isFocusMode = selectedEmployeeId !== null;
  const isSelected = isFocusMode && String(selectedEmployeeId) === String(employee.id);
  const hideGanttSide = isFocusMode && !isSelected;

  const handleSidebarClick = () => {
    if (groupId === undefined) return;
    if (isFocusMode) {
      setSelectedEmployeeId(isSelected ? null : groupId);
    } else {
      setSelectedEmployeeId(groupId);
    }
  };

  return (
    <div className="flex h-full group border-b border-border-faint hover:bg-bg-hover transition-colors">
      <div
        className={`sticky left-0 z-30 ${isSelected ? 'bg-accent-bg-soft' : 'bg-bg-surface'} group-hover:bg-bg-hover border-r border-border-subtle h-full transition-colors flex items-center gap-2 px-4 shadow-[var(--shadow-sticky-col)] cursor-pointer`}
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        dir="ltr"
        onClick={handleSidebarClick}
      >
        <div className="flex-1 flex flex-col overflow-hidden" dir={locale.dir} style={{ textAlign: 'left' }}>
          <span className={`text-sm truncate ${isSelected ? 'font-bold text-accent-text-strong' : 'font-medium text-text-secondary'}`} style={{ textAlign: 'left' }}>
            {employee.name}
          </span>
          <span className="text-xs text-text-subtle" style={{ textAlign: 'left' }}>
            {t('availability.employeeFte', { percent: employee.allocationPercentage })}
          </span>
        </div>
        <div
          className={`w-4 h-4 flex items-center justify-center transition-transform duration-200 flex-shrink-0 ${expandable && isExpanded ? 'rotate-90' : ''} ${expandable && !isFocusMode ? 'cursor-pointer hover:bg-bg-hover rounded' : ''}`}
          onClick={(e) => {
            if (!expandable || groupId === undefined || isFocusMode) return;
            e.stopPropagation();
            toggleGroup(groupId);
          }}
        >
          {expandable && (
            <svg className="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </div>
      <div className="relative flex-1 bg-bg-surface">
        {hideGanttSide ? null : columns.map((col) => {
          const { load, absenceInfo } = aggregateLoad(dailyLoads, col.periodStart, col.periodEnd, dailyCapacity, workDays, empAvail);
          // All-or-nothing reveal — identical logic to the company row: every
          // circle stays in skeleton until the load is computed for all periods
          // (past window settled); needsPast scopes only the per-cell error.
          const needsPast = !!loadGate && col.periodStart.getTime() < loadGate.settledFromTs;
          const cellError = needsPast && loadGate!.pastError ? { onRetry: loadGate!.onRetry } : null;
          const cellRecomputing = !!loadGate && loadGate.pastPending;
          return (
            <div
              key={col.key}
              style={{ position: 'absolute', left: col.x, width: col.width, height: '100%' }}
              className="border-l border-border-faint"
            >
              <LoadCell
                load={load}
                totalCapacity={dailyCapacity}
                zoomLevel={zoomLevel}
                absenceInfo={absenceInfo}
                employeeName={employee.name}
                roleName={role}
                ftePercent={employee.allocationPercentage}
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

EmployeeLoadRow.displayName = 'EmployeeLoadRow';
