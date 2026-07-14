import React, { memo, useMemo } from 'react';
import { format, startOfWeek, startOfQuarter, startOfMonth, endOfDay, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { Group, ZoomLevel, DailyLoad } from '../../../types/gantt.types';
import { useGantt } from '../../../hooks/useGantt';
import { useLocale } from '../../../hooks/useLocale';
import { useWorkloadCalculator } from '../../../hooks/useWorkloadCalculator';
import { LoadCell } from './LoadCell';
import { isWorkingDay } from '../../../utils/workDaysUtils';
import { ProjectSummaryCard } from '../ProjectSummaryCard';
import { ProjectSummaryBar } from '../ProjectSummaryBar';
import { DIMMED_OPACITY, SUMMARY_TRACKS_GAP } from '../../../utils/constants';

interface GroupHeaderRowProps {
  group: Group;
  isExpanded?: boolean;
  // Projects focus mode: a project other than the focused one. Its CONTENT is
  // faded (never the sticky-sidebar container — that bleeds the timeline through).
  dimmed?: boolean;
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
 * Aggregates daily load data into a period-based DailyLoad object
 */
const aggregateLoad = (
  dailyLoads: Map<string, number>,
  periodStart: Date,
  periodEnd: Date,
  capacity: number,
  workDays: number[]
): DailyLoad => {
  let totalAllocated = 0;
  let workingDaysCount = 0;
  
  // Clone start date to avoid mutation
  const current = new Date(periodStart);
  const end = endOfDay(periodEnd);

  while (current <= end) {
    if (isWorkingDay(current, workDays)) {
      const key = format(current, 'yyyy-MM-dd');
      totalAllocated += dailyLoads.get(key) || 0;
      workingDaysCount++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  const totalCapacity = capacity * workingDaysCount;
  const totalAvailable = totalCapacity - totalAllocated;
  const utilization = totalCapacity > 0 ? (totalAllocated / totalCapacity) * 100 : 0;
  
  return {
    date: format(periodStart, 'yyyy-MM-dd'),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    allocatedHours: totalAllocated,
    availableHours: totalAvailable,
    utilizationPercent: utilization,
    daysInPeriod: workingDaysCount
  };
};

/**
 * GroupHeaderRow - Displays group name and toggle expansion
 * RTL support with sticky sidebar
 */
export const GroupHeaderRow: React.FC<GroupHeaderRowProps> = memo(({ group, isExpanded, dimmed }) => {
  const {
    toggleGroup,
    totalWidth,
    openModal,
    viewMode,
    displayDays,
    pixelsPerDay,
    zoomLevel,
    settings,
    sidebarWidth,
    employees,
    getXByDate,
    bulkUpdateAllocationPM,
    selectedProjectId,
    setSelectedProjectId,
  } = useGantt();

  const locale = useLocale();
  const { t } = useTranslation();
  const isPlaceholder = group.id === 'new-placeholder-group';
  const isEmployeeView = viewMode === 'employees';

  // בתצוגת עובדים, למצוא את העובד הספציפי ולחשב את הקיבולת שלו
  const employee = isEmployeeView && !isPlaceholder 
    ? employees.find(e => e.id === group.id.toString()) 
    : undefined;

  const dailyCapacity = employee 
    ? (employee.allocationPercentage / 100) * (settings?.maxHoursPerDay || 8.5) 
    : 0;

  const workDays = settings?.workDays || [0, 1, 2, 3, 4];

  // Calculate workload from this group's own tasks (the bars) — single source.
  // Always use 'day' zoom to ensure daily granularity for aggregation.
  const workloadMap = useWorkloadCalculator(
    group.tasks,
    displayDays,
    'day',  // Always calculate at day granularity for correct aggregation
    settings
  );

  // המרת ה-WorkloadMap לפורמט של Map<dateKey, hours> עבור aggregateLoad
  const dailyLoadsMap = useMemo(() => {
    const map = new Map<string, number>();
    workloadMap.forEach((entry, key) => {
      map.set(key, entry.hours);
    });
    return map;
  }, [workloadMap]);

  /**
   * Create column definitions based on zoom level
   * Identical logic to CompanyLoadRow
   */
  const columns = useMemo(() => {
    if (!isEmployeeView || isPlaceholder) return [];

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
    const periodOrder: string[] = [];
    
    displayDays.forEach(day => {
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
  }, [displayDays, zoomLevel, pixelsPerDay, getXByDate, isEmployeeView, isPlaceholder]);

  // Projects view: clicking the row name focuses the project (mirror of the
  // employee focus). The chevron alone still toggles expand (when not focused).
  const isProjectView = viewMode === 'projects';
  const isProjectFocusMode = isProjectView && selectedProjectId !== null;
  const isSelectedProject = isProjectFocusMode && String(selectedProjectId) === String(group.id);

  const handleSidebarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaceholder) return; // placeholder: no-op on sidebar click
    if (isProjectView) {
      // Enter focus, switch focus, or toggle off if re-clicking the focused one.
      setSelectedProjectId(isSelectedProject ? null : group.id);
      return;
    }
    // Employees-view fallback header (rare): keep the plain expand toggle.
    toggleGroup(group.id);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaceholder) {
      openModal({ groupId: group.id });
    }
  };

  // Check if we should show the project summary card
  const showProjectCard = viewMode === 'projects' && !isPlaceholder && group.projectSummary && isExpanded;

  // "Summary surface" = an expanded/focused project. Its header row is DARK across
  // the full width (sidebar + timeline) with white text; everything below it —
  // card + allocation rows — is white. That dark→white contrast is the PRIMARY
  // separation (owner: header↔body matters more than card↔allocations), and makes
  // the focused project pop against the dimmed neighbours.
  // Applied whenever the card shows (also the always-expanded focused project).
  const summarySurface = !!showProjectCard || isSelectedProject;
  // Fade non-focused projects' CONTENT (not the sticky sidebar container).
  const dimContent: React.CSSProperties | undefined = dimmed ? { opacity: DIMMED_OPACITY } : undefined;

  return (
    <div
      className={`gantt-group-row flex h-full transition-colors ${
        showProjectCard ? '' : 'border-b border-border-subtle'
      } ${
        isPlaceholder ? 'bg-accent-bg-soft hover:bg-accent-bg-badge' : 'bg-bg-surface hover:bg-bg-hover'
      }`}
      style={{
        overflow: showProjectCard ? 'visible' : undefined,
        // Summary↔tracks separation: a downward shadow under the summary row (no
        // border line) so the color-A band above reads as raised over the tracks.
        boxShadow: showProjectCard ? '0 5px 7px -4px rgba(0,0,0,0.13)' : undefined,
      }}
    >
      {/* Sidebar - sticky on left, relative for absolute PM bar positioning */}
      <div
        className={`sticky left-0 z-50 border-r border-border-subtle h-full flex items-center px-4 gap-2 transition-colors relative shadow-[var(--shadow-sticky-col)] ${
          isPlaceholder ? 'bg-accent-bg-tint text-accent font-bold' : summarySurface ? 'bg-bg-inverted hover:bg-bg-inverted cursor-pointer' : 'bg-bg-app hover:bg-bg-hover cursor-pointer'
        }`}
        style={{ width: sidebarWidth, minWidth: sidebarWidth, overflow: showProjectCard ? 'visible' : undefined, cursor: isPlaceholder ? 'default' : 'pointer' }}
        dir="ltr"
        onClick={handleSidebarClick}
      >
        {/* Color strip - only in projects view (always pinned to the outer/left edge) */}
        {!isEmployeeView && !isPlaceholder && group.color && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
            style={{ backgroundColor: group.color, ...dimContent }}
          />
        )}

        {/* Group name — left-aligned, fills the row. Inner dir restored
            so Hebrew/Arabic content still renders with correct word order. */}
        <div className="flex-1 flex flex-col overflow-hidden text-left" dir={locale.dir} style={dimContent}>
          <span
            className={`overflow-hidden text-sm ${isPlaceholder ? 'text-accent' : summarySurface ? 'font-bold text-white' : 'font-bold text-text-secondary'}`}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: '1.2',
              textAlign: 'left',
            }}
          >
            {group.name}
          </span>
        </div>

        {/* Employees view: "Availability" label between name and chevron. */}
        {isEmployeeView && !isPlaceholder && (
          <span className="text-sm font-medium text-text-muted uppercase tracking-wide flex-shrink-0">
            {t('employeeLoad.rowAvailabilityLabel')}
          </span>
        )}

        {/* Chevron icon snapped to the visual RIGHT edge — hidden for placeholder.
            In projects view it owns the expand toggle (the rest of the row focuses);
            disabled during focus mode, where expansion is driven by the selection. */}
        {!isPlaceholder && (
          <div
            className={`w-4 h-4 flex items-center justify-center transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''} ${isProjectView && !isProjectFocusMode ? 'cursor-pointer hover:bg-bg-hover rounded' : ''}`}
            style={dimContent}
            onClick={(e) => {
              if (!isProjectView || isProjectFocusMode) return;
              e.stopPropagation();
              toggleGroup(group.id);
            }}
          >
            <svg className={`w-3 h-3 ${summarySurface ? 'text-white' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        )}


        {/* PM + Project Type bar - sidebar only. The card is WHITE, same as the
            header and the allocation rows. It is pushed down by the header's
            summary gap (marginTop = SUMMARY_TRACKS_GAP) so its two 48px rows line
            up 1:1 with the allocation tracks to its right (which start below that
            same gap). The block is padded to ≥ PROJECT_CARD_HEIGHT so the card
            never overhangs into the next project. */}
        {showProjectCard && (
          <div
            className={`absolute left-0 top-full w-full px-3 flex flex-col bg-bg-surface ${locale.isRtl ? 'border-r' : 'border-l'} border-border-subtle`}
            style={{ zIndex: 60, marginTop: SUMMARY_TRACKS_GAP }}
            onClick={(e) => e.stopPropagation()}
          >
            <ProjectSummaryCard
              summary={group.projectSummary!}
              projectId={group.id.toString()}
              employees={employees}
              onPMUpdate={(newManagerId?: string) => {
                if (newManagerId) {
                  bulkUpdateAllocationPM(group.id.toString(), newManagerId);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Timeline area - only opens modal for placeholder. Its background matches
          the sidebar/card (color A) whenever the summary surface is active, so the
          whole summary row reads as one band across sidebar + timeline. */}
      <div
        className={`flex-1 h-full flex items-center relative ${isPlaceholder ? 'bg-accent-bg-soft cursor-pointer' : summarySurface ? 'bg-bg-inverted' : 'bg-bg-app'}`}
        style={{ minWidth: totalWidth }}
        onClick={handleTimelineClick}
      >
        {/* Projects view: roll-up bar summarising the project's active allocations.
            Faded (content-only) for non-focused projects in focus mode. */}
        {viewMode === 'projects' && !isPlaceholder && (
          <div style={dimContent}>
            <ProjectSummaryBar group={group} />
          </div>
        )}

        {isEmployeeView && !isPlaceholder && columns.map((col) => {
          const load = aggregateLoad(dailyLoadsMap, col.periodStart, col.periodEnd, dailyCapacity, workDays);

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
              <LoadCell load={load} totalCapacity={dailyCapacity} zoomLevel={zoomLevel} />
            </div>
          );
        })}
      </div>
    </div>
  );
});

GroupHeaderRow.displayName = 'GroupHeaderRow';
