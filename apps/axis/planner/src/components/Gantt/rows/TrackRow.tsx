import React, { memo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, addMonths, format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { Task, GroupId } from '../../../types/gantt.types';
import { TaskBar } from '../TaskBar';
import { SNAP_DAYS } from '../../../utils/constants';
import { useGantt } from '../../../hooks/useGantt';
import { useLocale } from '../../../hooks/useLocale';
import { useSettings } from '../../../contexts/SettingsContext';
import { countWorkingDays } from '../../../utils/workDaysUtils';

interface TrackRowProps {
  items: Task[];
  groupId: GroupId;
  trackIndex: number;
  // Rule 4: the owning project is not in the active set. When "show past" is ON,
  // its bars render DIMMED (when past is hidden they aren't rendered at all).
  isInactiveProject?: boolean;
}

/**
 * TrackRow renders multiple non-overlapping tasks in a single row
 * Uses track packing to efficiently display tasks without vertical overlap
 */
export const TrackRow: React.FC<TrackRowProps> = memo(({ items, groupId, trackIndex, isInactiveProject }) => {
  const { getDateByX, getXByDate, openModal, sidebarWidth, zoomLevel, pixelsPerDay, viewMode, holidaysByDate, hidePastAllocations } = useGantt();
  // Rule 4: dim only when the inactive project's PAST bars are SHOWN. When past
  // is hidden they aren't rendered, so there's nothing to dim.
  const isDimmed = !!isInactiveProject && !hidePastAllocations;
  const locale = useLocale();
  const { t } = useTranslation();
  const { settings } = useSettings();
  // `originLeft`/`rowTop` are the viewport coords of the Gantt-area content
  // origin and the row's top, captured at mousedown so the portaled drag labels
  // can be positioned without reading the ref during render. Stable for the
  // duration of a drag (no auto-scroll while drag-creating).
  const [selection, setSelection] = useState<{ startX: number; currentX: number; originLeft: number; rowTop: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ left: number; width: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Get snap unit for current zoom level
  const snapDays = SNAP_DAYS[zoomLevel];
  const pixelsPerSnapUnit = pixelsPerDay * snapDays;

  // Background: rows holding a real allocation are white; empty padding tracks
  // are gray so they continue the (gray) project card above them seamlessly.
  const rowBg = items.length === 0 ? 'bg-bg-app' : 'bg-bg-surface';

  // Helper to snap X coordinate to the start of the cell at that position
  const snapToCellStart = useCallback((x: number) => {
    if (zoomLevel === 'month' || zoomLevel === 'quarter') {
      const date = getDateByX(x);
      return getXByDate(startOfMonth(date));
    }
    if (zoomLevel === 'week') {
      const date = getDateByX(x);
      return getXByDate(startOfWeek(date, { weekStartsOn: 0 }));
    }
    return Math.floor(x / pixelsPerSnapUnit) * pixelsPerSnapUnit;
  }, [pixelsPerSnapUnit, zoomLevel, getDateByX, getXByDate]);

  // Helper to snap X for selection drag (matches the previous behavior)
  const snapToGrid = useCallback((x: number) => {
    if (zoomLevel === 'month' || zoomLevel === 'quarter') {
      // Snap to actual month boundaries instead of fixed pixel intervals
      const date = getDateByX(x);
      const monthStart = startOfMonth(addDays(date, 5));
      return getXByDate(monthStart);
    }
    return Math.round(x / pixelsPerSnapUnit) * pixelsPerSnapUnit;
  }, [pixelsPerSnapUnit, zoomLevel, getDateByX, getXByDate]);

  // Compute the snapped cell (left + width) under a given raw X
  const cellAt = useCallback((rawX: number) => {
    const left = snapToCellStart(rawX);
    let width: number;
    if (zoomLevel === 'month' || zoomLevel === 'quarter') {
      const startDate = getDateByX(left);
      const nextMonth = addMonths(startOfMonth(startDate), 1);
      width = getXByDate(nextMonth) - left;
    } else {
      width = pixelsPerSnapUnit;
    }
    return { left, width };
  }, [snapToCellStart, zoomLevel, getDateByX, getXByDate, pixelsPerSnapUnit]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle left click on the empty area
    if (e.button !== 0 || (e.target as HTMLElement).closest('.task-bar-container')) return;

    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Adjust for sidebar and snap to grid
    const rawStartX = e.clientX - rect.left - sidebarWidth;
    if (rawStartX < 0) return;

    const startX = snapToGrid(rawStartX);
    // Gantt-area content origin in the viewport = row left + sticky sidebar.
    const originLeft = rect.left + sidebarWidth;
    const rowTop = rect.top;
    setSelection({ startX, currentX: startX, originLeft, rowTop });

    let currentSelectionX = startX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rawX = moveEvent.clientX - rect.left - sidebarWidth;
      currentSelectionX = snapToGrid(rawX);
      setSelection({ startX, currentX: currentSelectionX, originLeft, rowTop });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      const finalStartX = Math.min(startX, currentSelectionX);
      const finalEndX = Math.max(startX, currentSelectionX);

      let startDate: Date;
      let endDate: Date;

      if (zoomLevel === 'month' || zoomLevel === 'quarter') {
        // Both positions are already snapped to month starts by snapToGrid.
        startDate = startOfMonth(addDays(getDateByX(finalStartX), 5));
        // endMonth is the month cell the cursor lands in — include it fully
        // (through its last day). finalEndX >= finalStartX, so endMonth is never
        // before the start month; a single-cell click yields one full month.
        const endMonth = startOfMonth(addDays(getDateByX(finalEndX), 5));
        endDate = endOfMonth(endMonth);
      } else {
        // Ensure minimum selection of one snap unit
        const adjustedEndX = finalEndX <= finalStartX ? finalStartX + pixelsPerSnapUnit : finalEndX;
        startDate = getDateByX(finalStartX);
        // finalEndX is the EXCLUSIVE right boundary (start of the cell *after*
        // the last selected one). Step back one snap unit so endDate is the
        // last cell actually inside the selection — otherwise the range (and
        // the day count) bleeds one cell past what the user dragged over.
        endDate = getDateByX(adjustedEndX - pixelsPerSnapUnit);

        if (zoomLevel === 'week') {
          startDate = startOfWeek(startDate, { weekStartsOn: 0 });
          endDate = endOfWeek(endDate, { weekStartsOn: 0 });
        }
      }

      // Open modal with snapped dates (format preserves local timezone)
      openModal({
        groupId,
        startDate: format(startDate, "yyyy-MM-dd'T'HH:mm:ss"),
        endDate: format(endDate, "yyyy-MM-dd'T'HH:mm:ss"),
        hoursPerDay: 4,
        role: '',
      });

      setSelection(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [getDateByX, openModal, groupId, snapToGrid, pixelsPerSnapUnit, zoomLevel, sidebarWidth]);

  const showHoverHint = viewMode === 'projects' || viewMode === 'employees';

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!showHoverHint || selection) return;
    if ((e.target as HTMLElement).closest('.task-bar-container')) {
      setHoverCell(null);
      return;
    }
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = e.clientX - rect.left - sidebarWidth;
    if (rawX < 0) {
      setHoverCell(null);
      return;
    }
    setHoverCell(cellAt(rawX));
  }, [showHoverHint, selection, sidebarWidth, cellAt]);

  const handleMouseLeave = useCallback(() => {
    setHoverCell(null);
  }, []);

  return (
    <div
      ref={rowRef}
      className={`flex h-full group hover:bg-bg-hover transition-colors ${rowBg}`}
      data-track-index={trackIndex}
      data-group-id={groupId}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Sidebar Part */}
      <div 
        className={`sticky left-0 z-30 ${rowBg} border-r border-border-subtle h-full`}
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        dir={locale.dir}
      >
        {/* First track of a group could show summary info */}
        {trackIndex === 0 && items.length > 0 && (
          <div className="h-full flex items-center px-4 text-xs text-text-subtle">
            {/* Optional: Show first task info in sidebar */}
          </div>
        )}
      </div>

      {/* Gantt Area - contains multiple TaskBars */}
      <div className={`relative flex-1 ${rowBg} group-hover:bg-bg-hover select-none border-b border-border-faint`}>
        {items.map((task) => (
          <div key={task.id} className="task-bar-container">
            <TaskBar task={task} isDimmed={isDimmed} />
          </div>
        ))}

        {/* Hover hint — skeleton of a new allocation with a centered plus glyph.
             Background/border match the drag-create selection overlay so the two
             affordances feel like the same gesture. */}
        {showHoverHint && hoverCell && !selection && (
          <div
            className="absolute top-2 bottom-2 flex items-center justify-center pointer-events-none z-[8] bg-accent/20 border border-accent/50 rounded-md text-accent"
            style={{ left: `${hoverCell.left}px`, width: `${hoverCell.width}px` }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Selection Overlay */}
        {selection && (() => {
          const finalStartX = Math.min(selection.startX, selection.currentX);
          const finalEndX = Math.max(selection.startX, selection.currentX);

          let startDate: Date;
          let endDate: Date;
          let overlayLeft: number;
          let overlayWidth: number;
          if (zoomLevel === 'month' || zoomLevel === 'quarter') {
            startDate = startOfMonth(addDays(getDateByX(finalStartX), 5));
            // Mirror handleMouseUp: include the cursor's month through its last
            // day, and fill the overlay across that whole month (up to the next
            // month's start) so the highlight matches the selected range.
            const endMonth = startOfMonth(addDays(getDateByX(finalEndX), 5));
            endDate = endOfMonth(endMonth);
            overlayLeft = getXByDate(startDate);
            overlayWidth = Math.max(1, getXByDate(addMonths(endMonth, 1)) - overlayLeft);
          } else {
            const adjustedEndX = finalEndX <= finalStartX ? finalStartX + pixelsPerSnapUnit : finalEndX;
            startDate = getDateByX(finalStartX);
            // Step back one snap unit: finalEndX is the exclusive right boundary
            // (start of the cell after the last selected one). See handleMouseUp.
            endDate = getDateByX(adjustedEndX - pixelsPerSnapUnit);
            if (zoomLevel === 'week') {
              startDate = startOfWeek(startDate, { weekStartsOn: 0 });
              endDate = endOfWeek(endDate, { weekStartsOn: 0 });
            }
            overlayLeft = finalStartX;
            overlayWidth = Math.max(1, finalEndX - finalStartX);
          }

          const wd = settings?.workDays || [0, 1, 2, 3, 4];
          const days = startDate <= endDate ? Math.max(1, countWorkingDays(startDate, endDate, wd, holidaysByDate)) : 1;

          // Labels are portaled to <body> with viewport coords (captured at
          // mousedown): rendered in-row they'd sit at top:-22px and be painted
          // over by the GROUP/section header row above (which carries a higher
          // z-index). Same approach as the TaskBar resize tooltip.
          const { originLeft, rowTop } = selection;
          const labelTop = rowTop - 2;

          return (
            <>
              <div
                className="absolute top-2 bottom-2 bg-accent/20 border border-accent/50 rounded-md z-10 pointer-events-none"
                style={{ left: `${overlayLeft}px`, width: `${overlayWidth}px` }}
              />
              {createPortal(
                <>
                  {/* Start date label */}
                  <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{ left: `${originLeft + overlayLeft}px`, top: `${labelTop}px`, transform: 'translate(-50%, -100%)' }}
                  >
                    <div className="bg-bg-inverted text-white text-xs font-medium px-2 py-0.5 rounded shadow-lg whitespace-nowrap">
                      {format(startDate, 'dd/MM')}
                    </div>
                  </div>
                  {/* End date + days labels */}
                  <div
                    className="fixed z-[9999] pointer-events-none flex items-center gap-1"
                    style={{ left: `${originLeft + overlayLeft + overlayWidth}px`, top: `${labelTop}px`, transform: 'translate(-50%, -100%)' }}
                  >
                    <div className="bg-bg-inverted text-white text-xs font-medium px-2 py-0.5 rounded shadow-lg whitespace-nowrap">
                      {format(endDate, 'dd/MM')}
                    </div>
                    <div className="bg-accent text-white text-xs font-medium px-2 py-0.5 rounded shadow-lg whitespace-nowrap">
                      {t('taskBar.tooltip.daysCount', { count: days })}
                    </div>
                  </div>
                </>,
                document.body
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
});

TrackRow.displayName = 'TrackRow';
