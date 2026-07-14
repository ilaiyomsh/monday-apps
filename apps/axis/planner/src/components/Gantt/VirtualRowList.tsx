import React, { useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isSameDay, startOfMonth, startOfQuarter, startOfWeek, format } from 'date-fns';
import { useGantt } from '../../hooks/useGantt';
import { useRightClickPan } from '../../hooks/useRightClickPan';
import { CONFIG } from '../../utils/constants';
import { RowRenderer } from './rows/RowRenderer';
import { isWorkingDay } from '../../utils/workDaysUtils';
import { TimelineHeader } from './TimelineHeader';

/**
 * VirtualRowList - High performance virtualized row list with infinite scroll
 */
export const VirtualRowList: React.FC = () => {
  const { 
    flattenedRows,
    totalHeight,
    totalWidth,
    displayDays,
    pixelsPerDay,
    zoomLevel,
    getXByDate,
    handleTimelineScroll,
    setScrollTop,
    setScrollLeft,
    scrollLeft,
    containerWidth,
    containerRef,
    sidebarWidth,
    settings,
  } = useGantt();

  const { isPanning, handlers } = useRightClickPan({ containerRef });

  const workDays = settings?.workDays || [0, 1, 2, 3, 4];

  // Vertical virtualization using tanstack/virtual
  const rowVirtualizer = useVirtualizer({
    count: flattenedRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback((index: number) => flattenedRows[index]?.height ?? CONFIG.rowHeight, [flattenedRows]),
    overscan: CONFIG.verticalBuffer,
  });

  // Use passive scroll listener for better performance on mobile/low-power devices
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollHandler = (e: Event) => {
      const target = e.target as HTMLDivElement;
      const { scrollTop, scrollLeft, clientWidth, scrollWidth } = target;

      // Update scroll state
      setScrollTop(scrollTop);
      setScrollLeft(scrollLeft);

      // Trigger infinite scroll check
      handleTimelineScroll(scrollLeft, clientWidth, scrollWidth);
    };

    container.addEventListener('scroll', scrollHandler, { passive: true });
    return () => container.removeEventListener('scroll', scrollHandler);
  }, [setScrollTop, setScrollLeft, handleTimelineScroll, containerRef]);

  // Today marker position
  const todayX = useMemo(() => getXByDate(new Date()), [getXByDate]);

  /**
   * Helper to group days into grid units based on zoom level
   */
  const gridUnits = useMemo(() => {
    const units: Array<{ key: string; width: number; isWknd?: boolean; isToday?: boolean; isMonthStart?: boolean; isQuarterStart?: boolean }> = [];
    
    if (zoomLevel === 'day') {
      displayDays.forEach(day => {
        units.push({
          key: day.toISOString(),
          width: pixelsPerDay,
          isWknd: !isWorkingDay(day, workDays),
          isToday: isSameDay(day, new Date()),
          isMonthStart: isSameDay(day, startOfMonth(day)),
          isQuarterStart: isSameDay(day, startOfQuarter(day))
        });
      });
      return units;
    }

    // For other zoom levels, group by the secondary unit
    let currentUnit: { key: string; width: number; date: Date } | null = null;
    
    const getStartOfUnit = (d: Date) => {
      if (zoomLevel === 'week') return startOfWeek(d, { weekStartsOn: 0 });
      if (zoomLevel === 'month') return startOfMonth(d);
      return startOfQuarter(d);
    };

    for (const day of displayDays) {
      const unitDate = getStartOfUnit(day);
      const unitKey = format(unitDate, 'yyyy-MM-dd');
      
      if (currentUnit && currentUnit.key !== unitKey) {
        units.push({
          key: currentUnit.key,
          width: currentUnit.width,
          isMonthStart: isSameDay(currentUnit.date, startOfMonth(currentUnit.date)),
          isQuarterStart: isSameDay(currentUnit.date, startOfQuarter(currentUnit.date))
        });
        currentUnit = null;
      }
      
      if (!currentUnit) {
        currentUnit = {
          key: unitKey,
          width: 0,
          date: unitDate
        };
      }
      currentUnit.width += pixelsPerDay;
    }
    
    if (currentUnit) {
      units.push({
        key: currentUnit.key,
        width: currentUnit.width,
        isMonthStart: isSameDay(currentUnit.date, startOfMonth(currentUnit.date)),
        isQuarterStart: isSameDay(currentUnit.date, startOfQuarter(currentUnit.date))
      });
    }
    
    return units;
  }, [zoomLevel, displayDays, pixelsPerDay, workDays]);

  /**
   * Visible grid units for horizontal virtualization
   */
  const { visibleGridUnits, gridOffsetLeft } = useMemo(() => {
    if (containerWidth <= 0) return { visibleGridUnits: gridUnits, gridOffsetLeft: 0 };

    let currentX = 0;
    let startIndex = -1;
    let endIndex = gridUnits.length;
    let offsetLeft = 0;

    const buffer = CONFIG.horizontalBuffer;

    for (let i = 0; i < gridUnits.length; i++) {
      const unit = gridUnits[i];
      const unitRight = currentX + unit.width;

      // Check if unit is visible (with buffer)
      if (startIndex === -1 && unitRight >= scrollLeft - buffer) {
        startIndex = i;
        offsetLeft = currentX;
      }
      
      if (startIndex !== -1 && currentX > scrollLeft + containerWidth + buffer) {
        endIndex = i;
        break;
      }

      currentX += unit.width;
    }

    return {
      visibleGridUnits: gridUnits.slice(Math.max(0, startIndex), endIndex),
      gridOffsetLeft: offsetLeft
    };
  }, [gridUnits, scrollLeft, containerWidth]);

  return (
    <div
      ref={containerRef}
      className={`gantt-virtual-list flex-1 overflow-auto custom-scrollbar ${isPanning ? 'cursor-grabbing select-none' : ''}`}
      onContextMenu={handlers.onContextMenu}
      onMouseDown={handlers.onMouseDown}
      style={{
        height: 'calc(100vh - 200px)',
        position: 'relative',
        // Timeline always LTR — independent of UI direction. RTL on the
        // scroll container would invert the horizontal scroll math used by
        // useHorizontalVirtualization and the TaskBar drag/resize handlers.
        // Keep this LTR in both languages.
        direction: 'ltr',
      }}
    >
      {/* Sticky Timeline Header - inside scroll container */}
      <TimelineHeader />
      
      {/* Virtual content container */}
      <div
        style={{
          height: totalHeight + 100, // Add 100px extra space at the bottom
          width: totalWidth + sidebarWidth + 200, // Add 200px safety padding at the end
          position: 'relative',
          minWidth: '100%',
          paddingBottom: '100px', // Visual padding at the bottom
        }}
      >

        {/* Grid lines (background) - NOT displayed under GROUP header rows */}
        <div
            className="absolute pointer-events-none z-[5]"
          style={{
            left: sidebarWidth + gridOffsetLeft,
            top: 0,
            bottom: 100,
            height: totalHeight
          }}
        >
          {/* Build grid lines by iterating through all rows and rendering grid units per row */}
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = flattenedRows[virtualRow.index];
            // Skip grid lines for GROUP header rows
            if (row?.type === 'GROUP') {
              return null;
            }

            // Render grid for this row
            return (
              <div key={`grid-${virtualRow.index}`} style={{ display: 'flex', position: 'absolute', top: virtualRow.start, width: '100%', height: virtualRow.size }}>
                {visibleGridUnits.map((unit) => {
                  let borderColorValue = 'rgb(255, 255, 255, 0.5)'; // white/50

                  if (zoomLevel === 'day') {
                    borderColorValue = 'rgb(255, 255, 255, 0.6)'; // white/60
                  } else {
                    if (unit.isQuarterStart) { borderColorValue = 'rgb(255, 255, 255, 0.6)'; } // white/60
                    else if (unit.isMonthStart) { borderColorValue = 'rgb(255, 255, 255, 0.6)'; } // white/60
                    else { borderColorValue = 'rgb(255, 255, 255, 0.5)'; } // white/50
                  }

                  return (
                    <div
                      key={`${virtualRow.index}-${unit.key}`}
                      style={{ 
                        width: unit.width, 
                        borderRightWidth: '2px', 
                        borderRightStyle: 'solid',
                        borderRightColor: borderColorValue
                      }}
                      className={`
                        flex-shrink-0 h-full
                        ${unit.isWknd ? 'bg-bg-app/50' : ''}
                        ${unit.isToday ? 'bg-accent-bg-soft/30' : ''}
                      `}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        
        {/* Today marker line */}
        <div 
          className="absolute top-0 w-[1px] bg-danger/25 z-20 pointer-events-none"
          style={{ 
            left: sidebarWidth + todayX,
            height: totalHeight
          }}
        />

        {/* Virtual rows */}
        <div
          style={{
            position: 'relative',
            height: rowVirtualizer.getTotalSize(),
            width: '100%',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = flattenedRows[virtualRow.index];
            if (!row) return null;

            // Allow overflow for GROUP rows to show floating ProjectSummaryCard
            const isGroupRow = row.type === 'GROUP';
            // Separator space reserved on this row (already part of virtualRow.size).
            // Rendered as SOLID spacers (not row-level opacity, which would make the
            // sticky sidebar translucent and bleed the timeline through). Each spacer
            // is filled to BLEND with its neighbour surface — never a contrasting
            // stripe — so separation reads from the shadow, not a colour band.
            const gapTop = row.gapTop ?? 0;
            const gapBottom = row.gapBottom ?? 0;
            // The focused block floats above its (dimmed) neighbours like a hovered
            // allocation bar: a strong drop shadow on its top (header) and bottom
            // (last track) edges, plus the uniform translateY lift below.
            const focusShadow =
              row.focusEdge === 'top'
                ? '0 -11px 26px -6px rgba(0,0,0,0.30)'
                : row.focusEdge === 'bottom'
                ? '0 11px 26px -6px rgba(0,0,0,0.30)'
                : undefined;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  overflow: isGroupRow ? 'visible' : undefined,
                  display: 'flex',
                  flexDirection: 'column',
                  // Lift the focused block above its neighbours so its shadow
                  // reads correctly. The GROUP row must stay ABOVE its own track
                  // rows — it hosts the floating ProjectSummaryCard (z-60 within
                  // the row), which the track rows would otherwise cover.
                  //   focused group row : 37  (card-host, top of the block)
                  //   focused track rows: 36  (above neighbours, below the card)
                  //   normal group row  : 35
                  zIndex: isGroupRow ? (row.focusBlock ? 37 : 35) : row.focusBlock ? 36 : undefined,
                  transform: row.focusBlock ? 'translateY(-3px)' : undefined,
                  transition: 'opacity 150ms ease, transform 150ms ease, box-shadow 150ms ease',
                }}
              >
                {gapTop > 0 && (
                  <div style={{ height: gapTop, flexShrink: 0, background: row.gapTopColor }} />
                )}
                {/* Content box — the soft focus shadow hugs THIS edge (the real
                    block boundary), not the blended spacer. */}
                <div style={{ flex: '1 1 auto', minHeight: 0, boxShadow: focusShadow }}>
                  <RowRenderer row={row} />
                </div>
                {gapBottom > 0 && (
                  <div style={{ height: gapBottom, flexShrink: 0, background: row.gapBottomColor }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
