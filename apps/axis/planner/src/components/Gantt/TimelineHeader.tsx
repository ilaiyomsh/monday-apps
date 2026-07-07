import React, { useMemo, useCallback } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, startOfYear, startOfQuarter } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useGantt } from '../../hooks/useGantt';
import type { ZoomLevel } from '../../types/gantt.types';
import { useLocale } from '../../hooks/useLocale';
import { useActiveProjects } from '../../contexts/ActiveProjectsContext';
import { CONFIG } from '../../utils/constants';
import { isWorkingDay } from '../../utils/workDaysUtils';
import { AddProjectDropdown } from './AddProjectDropdown';
import { ProjectFilterDropdown } from './ProjectFilterDropdown';

interface HeaderGroup {
  key: string;
  label: string;
  width: number;
}

/**
 * TimelineHeader - Renders the dual-level timeline header
 * Primary level: Shows larger time units (Week/Month/Year)
 * Secondary level: Shows smaller units (Day/Week/Month)
 */
export const TimelineHeader: React.FC = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const {
    zoomLevel,
    setZoomLevel,
    displayDays,
    pixelsPerDay,
    totalWidth,
    sidebarWidth,
    scrollLeft,
    containerWidth,
    containerRef,
    getDateByX,
    requestDrillDown,
    visibleDayRange,
    settings,
    searchQuery,
    setSearchQuery,
    viewMode,
    groups,
    addForceShownProject,
    absencesLoading,
    holidaysByDate,
  } = useGantt();

  const drillDownFromKey = useCallback((_key: string, event: React.MouseEvent<HTMLDivElement>) => {
    const nextZoom: ZoomLevel | null =
      zoomLevel === 'quarter' ? 'month'
      : zoomLevel === 'month' ? 'week'
      : zoomLevel === 'week' ? 'day'
      : null;
    if (!nextZoom) return;
    const el = containerRef.current;
    // Capture cursor position within the scroll container so we can pin the
    // exact date under the cursor to the same spot after the zoom change.
    // Using the *cell's start date* would put the cell's first day at the
    // cursor, making the cell appear to jump (a click at the middle of an
    // "April" cell would place April 1 — not mid-April — under the cursor).
    const containerRect = el?.getBoundingClientRect();
    const viewportX = containerRect ? event.clientX - containerRect.left : sidebarWidth;
    const internalX = scrollLeft + viewportX - sidebarWidth;
    const anchor = getDateByX(internalX);
    requestDrillDown({ anchor, viewportX });
    setZoomLevel(nextZoom);
  }, [zoomLevel, setZoomLevel, containerRef, sidebarWidth, scrollLeft, getDateByX, requestDrillDown]);

  const { allProjects, loading: projectsLoading, fetchAllProjectsLazy, refresh: refreshActiveProjects } = useActiveProjects();

  const workDays = settings?.workDays || [0, 1, 2, 3, 4];

  /**
   * Helper to group days into time buckets (weeks, months, etc.)
   */
  const getGroups = (
    startOfFn: (date: Date) => Date,
    labelFn: (date: Date) => string
  ): HeaderGroup[] => {
    const groups: HeaderGroup[] = [];
    let currentGroup: { key: string; count: number; label: string } | null = null;

    for (const day of displayDays) {
      const groupDate = startOfFn(day);
      const groupKey = format(groupDate, 'yyyy-MM-dd');

      if (currentGroup && currentGroup.key !== groupKey) {
        groups.push({
          key: currentGroup.key,
          label: currentGroup.label,
          width: currentGroup.count * pixelsPerDay
        });
        currentGroup = null;
      }

      if (!currentGroup) {
        currentGroup = {
          key: groupKey,
          count: 0,
          label: labelFn(day),
        };
      }
      currentGroup.count++;
    }

    if (currentGroup) {
      groups.push({
        key: currentGroup.key,
        label: currentGroup.label,
        width: currentGroup.count * pixelsPerDay
      });
    }

    return groups;
  };

  /**
   * Determine primary and secondary groups based on zoomLevel
   */
  const { primaryGroups, secondaryGroups, isDayView } = useMemo(() => {
    // 1. Daily View: Primary = Week, Secondary = Day
    if (zoomLevel === 'day') {
      return {
        isDayView: true,
        primaryGroups: getGroups(
          (d) => startOfWeek(d, { weekStartsOn: 0 }),
          (d) => {
            const start = startOfWeek(d, { weekStartsOn: 0 });
            const end = endOfWeek(d, { weekStartsOn: 0 });
            // Use a separator | to split later for styling
            return `${t('timeline.weekLabel', { week: format(start, 'w') })}|${format(start, 'd/M')} - ${format(end, 'd/M')}`;
          }
        ),
        secondaryGroups: [] // We'll map displayDays directly for secondary in day view
      };
    }
    
    // 2. Weekly View: Primary = Month + Year, Secondary = Week# + day-range
    if (zoomLevel === 'week') {
      return {
        isDayView: false,
        primaryGroups: getGroups(startOfMonth, (d) => {
          // bold|normal split, rendered as "<Month> <Year>" via the | separator
          return `${format(d, 'MMMM', { locale: locale.dateFnsLocale })}|${format(d, 'yyyy')}`;
        }),
        secondaryGroups: getGroups(
          (d) => startOfWeek(d, { weekStartsOn: 0 }),
          (d) => {
            const start = startOfWeek(d, { weekStartsOn: 0 });
            const end = endOfWeek(d, { weekStartsOn: 0 });
            const weekLabel = t('timeline.weekLabelShort', { week: format(start, 'w') });
            const startMonth = format(start, 'M');
            const endMonth = format(end, 'M');
            // bold|normal split: "W19" bold, "3 - 7" (or "3/5 - 2/6") normal & LTR
            const range = startMonth !== endMonth
              ? `${format(start, 'd')}/${startMonth} - ${format(end, 'd')}/${endMonth}`
              : `${format(start, 'd')} - ${format(end, 'd')}`;
            return `${weekLabel}|${range}`;
          }
        )
      };
    }

    // 3. Monthly View: Primary = Quarter, Secondary = Month
    if (zoomLevel === 'month') {
      return {
        isDayView: false,
        primaryGroups: getGroups(startOfQuarter, (d) => format(d, 'QQQ yyyy')),
        secondaryGroups: getGroups(startOfMonth, (d) => format(d, 'MMMM', { locale: locale.dateFnsLocale }))
      };
    }

    // 4. Quarterly View: Primary = Year, Secondary = Quarter
    return {
      isDayView: false,
      primaryGroups: getGroups(startOfYear, (d) => format(d, 'yyyy')),
      secondaryGroups: getGroups(startOfQuarter, (d) => {
        const quarter = format(d, 'Q');
        return t('timeline.quarterLabel', { quarter });
      })
    };
  }, [zoomLevel, displayDays, pixelsPerDay, t, locale.dateFnsLocale]);

  /**
   * Visible primary and secondary groups for horizontal virtualization
   */
  const { visiblePrimaryGroups, primaryOffsetLeft, visibleSecondaryGroups, secondaryOffsetLeft } = useMemo(() => {
    const getVisibleGroups = (groups: HeaderGroup[]) => {
      if (containerWidth <= 0) return { visible: groups, offset: 0 };
      
      let currentX = 0;
      let startIndex = -1;
      let endIndex = groups.length;
      let offsetLeft = 0;
      const buffer = CONFIG.horizontalBuffer;

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupRight = currentX + group.width;

        if (startIndex === -1 && groupRight >= scrollLeft - buffer) {
          startIndex = i;
          offsetLeft = currentX;
        }
        
        if (startIndex !== -1 && currentX > scrollLeft + containerWidth + buffer) {
          endIndex = i;
          break;
        }
        currentX += group.width;
      }

      return {
        visible: groups.slice(Math.max(0, startIndex), endIndex),
        offset: offsetLeft
      };
    };

    const primary = getVisibleGroups(primaryGroups);
    const secondary = getVisibleGroups(secondaryGroups);

    return {
      visiblePrimaryGroups: primary.visible,
      primaryOffsetLeft: primary.offset,
      visibleSecondaryGroups: secondary.visible,
      secondaryOffsetLeft: secondary.offset
    };
  }, [primaryGroups, secondaryGroups, scrollLeft, containerWidth]);

  return (
    <div 
      className="gantt-header sticky top-0 z-[60] bg-bg-surface border-b border-border-subtle flex"
      style={{ 
        height: `${CONFIG.headerHeight}px`,
        width: totalWidth + sidebarWidth,
        minWidth: '100%',
      }}
    >
      {/* Sidebar Header - sticky on left with search */}
      <div
        className="sticky left-0 z-50 bg-bg-app border-r border-border-subtle flex items-center justify-center px-3"
        style={{ width: sidebarWidth, minWidth: sidebarWidth, boxShadow: 'var(--shadow-header-col)' }}
        dir={locale.dir}
      >
        <div className="flex items-center gap-2 w-full">
          {/* Search Field */}
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={viewMode === 'projects' ? t('timeline.search.project') : t('timeline.search.employee')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[32px] ps-3 pe-8 border border-border-subtle rounded-lg text-sm bg-bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all placeholder:text-text-subtle"
              dir={locale.dir}
            />
            <svg
              className="absolute end-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute start-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-text-subtle hover:text-text-muted rounded-full hover:bg-bg-hover transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Add Project Button - only in projects view */}
          {viewMode === 'projects' && (
            <>
              <ProjectFilterDropdown iconOnly />
              <AddProjectDropdown
                activeProjects={null}
                allProjects={allProjects}
                visibleGroupIds={groups.filter(g => g.tasks.length > 0).map(g => g.id.toString())}
                onSelect={(projectId, projectName) => addForceShownProject(projectId, projectName)}
                loading={projectsLoading}
                onOpen={fetchAllProjectsLazy}
              />
              <button
                type="button"
                onClick={() => refreshActiveProjects()}
                disabled={projectsLoading}
                title={t('timeline.refreshTooltip')}
                className="p-1.5 rounded hover:bg-bg-hover disabled:opacity-50 transition"
                aria-label="Refresh projects"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={projectsLoading ? 'animate-spin' : ''}
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </>
          )}
          {/* Absences load in a separate fetch after the initial render — show
              a tiny inline spinner so the user knows the availability circles
              are not final yet. Only visible while that fetch is in flight. */}
          {absencesLoading && viewMode === 'employees' && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-section text-text-muted text-xs whitespace-nowrap"
              title={t('timeline.loadingAbsences')}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-spin"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{t('timeline.loadingAbsences')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Timeline Container - no transform needed, scrolls naturally with parent */}
      <div 
        className="flex flex-col h-full" 
        style={{ width: totalWidth }}
      >
        {/* 1. Primary Header (Upper) */}
        <div 
          className="flex border-b border-border-subtle"
          style={{ 
            height: CONFIG.headerLevelHeight,
            paddingLeft: primaryOffsetLeft 
          }}
        >
          {visiblePrimaryGroups.map((g) => {
            const [boldPart, normalPart] = g.label.includes('|') ? g.label.split('|') : [g.label, ''];
            
            return (
              <div 
                key={g.key}
                style={{ width: g.width }} 
                className="flex-shrink-0 border-r border-border-default flex items-center justify-center text-sm text-text-secondary bg-bg-app gap-2"
                dir="rtl"
              >
                <span className="font-bold">{boldPart}</span>
                {normalPart && (
                  <span className="font-normal opacity-70" dir="ltr">{normalPart}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* 2. Secondary Header (Lower) */}
        <div 
          className="flex" 
          style={{ 
            height: CONFIG.headerLevelHeight,
            paddingLeft: isDayView ? visibleDayRange.offsetLeft : secondaryOffsetLeft
          }}
        >
          {isDayView ? (
            // In day view, render each day individually for better precision
            displayDays.slice(visibleDayRange.startIndex, visibleDayRange.endIndex).map((day) => {
              // Company day-off (general Day-off entry) → name it on the column,
              // so e.g. שבועות reads under its date. Covers blocking + display-
              // only general days; personal absences are NOT in holidaysByDate.
              const holiday = holidaysByDate.get(format(day, 'yyyy-MM-dd'));
              const holidayName = holiday ? (locale.dir === 'rtl' ? holiday.nameHe : holiday.nameEn) : '';
              return (
                <div
                  key={day.toISOString()}
                  style={{ width: pixelsPerDay }}
                  className={`
                    flex-shrink-0 border-r border-border-faint flex flex-col items-center justify-center text-sm overflow-hidden px-0.5
                    ${holiday ? 'bg-accent-bg-soft' : !isWorkingDay(day, workDays) ? 'bg-bg-app' : 'bg-bg-surface'}
                  `}
                  title={holidayName || undefined}
                >
                  <span className="text-text-muted font-medium leading-tight" dir={locale.dir}>
                    {/* "יום ג 5/5" / "Wed 5/5" — drop the Hebrew geresh that
                        date-fns appends to short day names. */}
                    {`${format(day, 'EEE', { locale: locale.dateFnsLocale }).replace(/['׳ʼ]/g, '')} `}
                    <span dir="ltr">{format(day, 'd/M')}</span>
                  </span>
                  {holidayName && (
                    <span
                      className="text-[10px] font-semibold text-accent truncate max-w-full leading-tight"
                      dir={locale.dir}
                    >
                      {holidayName}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            // In week/month view, render the grouped secondary levels.
            // Labels may contain a "bold|normal" split (e.g. "W19|3 - 7") — the
            // bold part becomes the lead and the normal part is rendered LTR
            // so date ranges read left-to-right even in RTL.
            visibleSecondaryGroups.map((g) => {
              const [boldPart, normalPart] = g.label.includes('|') ? g.label.split('|') : [g.label, ''];
              const tooltip = normalPart ? `${boldPart} ${normalPart}` : boldPart;
              return (
                <div
                  key={g.key}
                  style={{ width: g.width }}
                  className="flex-shrink-0 border-r border-border-default flex items-center justify-center gap-1 text-xs text-text-secondary bg-bg-surface whitespace-nowrap overflow-hidden px-1 cursor-pointer hover:bg-bg-hover transition-colors"
                  dir="rtl"
                  title={t('timeline.drillDownTooltip', { label: tooltip, defaultValue: tooltip })}
                  onClick={(e) => drillDownFromKey(g.key, e)}
                >
                  <span className="font-bold truncate">{boldPart}</span>
                  {normalPart && (
                    <span className="font-normal opacity-70 truncate" dir="ltr">{normalPart}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
