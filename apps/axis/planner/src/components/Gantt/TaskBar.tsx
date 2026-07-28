import React, { memo, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import { differenceInDays, format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../types/gantt.types';
import { useGantt } from '../../hooks/useGantt';
import { useSettings } from '../../contexts/SettingsContext';
import { CONFIG, SNAP_DAYS } from '../../utils/constants';
import { formatNum } from '../../utils/effortUtils';
import { countWorkingDays } from '../../utils/workDaysUtils';
import { formatDateRange, getDynamicDates } from '../../utils/dateUtils';
import { useLocale } from '../../hooks/useLocale';
import { softenColor, getContrastColor } from '../../utils/colorUtils';
import { ContextMenu } from './ContextMenu';

interface TaskBarProps {
  task: Task;
  // Rule 4: render the bar muted (inactive-project bar with "show past" ON).
  // Visual-only opacity via the --opacity-bar-inactive token; composes over both
  // project-color and utilization-colored bars and leaves text contrast intact.
  isDimmed?: boolean;
}

/**
 * TaskBar - Draggable task bar component with performance optimizations
 * Uses React.memo and useMemo for efficient re-renders
 * Supports RTL layout
 */
export const TaskBar: React.FC<TaskBarProps> = memo(({ task, isDimmed }) => {
  const { t } = useTranslation();
  const locale = useLocale();
  const {
    getXByDate,
    getWidthByDates,
    getDateByX,
    pixelsPerDay,
    openModal,
    viewMode,
    updateTask,
    deleteAllocation,
    zoomLevel,
    holidaysByDate,
    showToast,
  } = useGantt();

  // Get snap unit for current zoom level
  const snapDays = SNAP_DAYS[zoomLevel];
  const pixelsPerSnapUnit = pixelsPerDay * snapDays;
  const { settings } = useSettings();

  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Calculate working days duration (only counting work days)
  const durationDays = useMemo(() => {
    if (!settings?.workDays) {
      return Math.max(1, differenceInDays(new Date(task.endDate), new Date(task.startDate)) + 1);
    }
    return Math.max(1, countWorkingDays(
      new Date(task.startDate),
      new Date(task.endDate),
      settings.workDays,
      holidaysByDate
    ));
  }, [task.startDate, task.endDate, settings?.workDays, holidaysByDate]);

  const hoursPerDay = task.hoursPerDay || 0;
  
  // מצב מקומי ל-Resize בזמן אמת
  const [resizeOffset, setResizeOffset] = useState<{ side: 'start' | 'end'; deltaX: number } | null>(null);
  const [resizePos, setResizePos] = useState<{ x: number; y: number } | null>(null);
  const [mouseDownPos, setMouseDownPos] = useState<{ x: number; y: number } | null>(null);
  const justResizedRef = useRef(false); // למניעת פתיחת מודאל אחרי resize

  // dnd-kit draggable hook
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: task,
  });

  const dynamicDragDatesText = useMemo(() => {
    if (!isDragging || !transform) return '';
    const { startDate, endDate } = getDynamicDates(
      task.startDate,
      task.endDate,
      transform.x,
      pixelsPerSnapUnit,
      snapDays
    );
    return formatDateRange(startDate, endDate, { lang: locale.culture });
  }, [isDragging, Math.round((transform?.x || 0) / (pixelsPerSnapUnit / 4)), task.startDate, task.endDate, pixelsPerSnapUnit, snapDays, locale.culture]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setMouseDownPos({ x: e.clientX, y: e.clientY });
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // אם זה עכשיו סיום resize, לא לפתוח מודאל
    if (justResizedRef.current) {
      justResizedRef.current = false;
      setMouseDownPos(null);
      return;
    }
    
    // אם היתה תנועה משמעותית של העכבר, זו גרירה ולא לחיצה
    if (mouseDownPos) {
      const deltaX = Math.abs(e.clientX - mouseDownPos.x);
      const deltaY = Math.abs(e.clientY - mouseDownPos.y);
      
      // אם העכבר זז יותר מ-5 פיקסלים, זו גרירה
      if (deltaX > 5 || deltaY > 5) {
        setMouseDownPos(null);
        return;
      }
    }
    
    setMouseDownPos(null);
    openModal(task);
  };

  const handleResizeStart = (e: React.MouseEvent, side: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    setMouseDownPos(null); // מאפס את מעקב העכבר
    justResizedRef.current = true; // מסמן שמתחיל resize

    const startX = e.clientX;
    let currentDeltaX = 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      currentDeltaX = moveEvent.clientX - startX;
      setResizePos({ x: moveEvent.clientX, y: moveEvent.clientY });
      if (side === 'end') {
        // Right resize: snap visual feedback to zoom-level grid
        const snappedDelta = Math.round(currentDeltaX / pixelsPerSnapUnit) * pixelsPerSnapUnit;
        setResizeOffset({ side, deltaX: snappedDelta });
      } else {
        // Left resize: free movement (pixel-level)
        setResizeOffset({ side, deltaX: currentDeltaX });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setResizePos(null);

      let newStart = parseISO(task.startDate);
      let newEnd = parseISO(task.endDate);

      if (side === 'end') {
        // Right resize: snap to grid units
        const snapUnitsMoved = Math.round(currentDeltaX / pixelsPerSnapUnit);
        const daysDiff = snapUnitsMoved * snapDays;
        if (daysDiff === 0) {
          setResizeOffset(null);
          return;
        }
        newEnd.setDate(newEnd.getDate() + daysDiff);
        // Snap end to grid boundary
        if (zoomLevel === 'week') {
          newEnd = endOfWeek(newEnd, { weekStartsOn: 0 });
        } else if (zoomLevel === 'month' || zoomLevel === 'quarter') {
          newEnd = endOfMonth(newEnd);
        }
      } else {
        // Left resize: intentionally free (no grid snapping).
        // The end date snaps to period boundaries (week/month) so billing periods align,
        // but the start date should allow any day — employees don't always start on a period boundary.
        const daysDiff = Math.round(currentDeltaX / pixelsPerDay);
        if (daysDiff === 0) {
          setResizeOffset(null);
          return;
        }
        newStart.setDate(newStart.getDate() + daysDiff);
      }

      // מניעת מצב שבו תאריך ההתחלה אחרי תאריך הסיום
      if (newStart <= newEnd) {
        // Preserve totalHours (king) and derive hoursPerDay based on new duration
        const workDays = settings?.workDays || [0, 1, 2, 3, 4];
        const newDays = Math.max(1, countWorkingDays(newStart, newEnd, workDays, holidaysByDate));
        const newHoursPerDay = (task.totalHours || 0) / newDays;

        // updateTask rethrows on a failed save (after reverting the optimistic state), so this
        // fire-and-forget call MUST catch — otherwise a failed resize is an unhandled rejection
        // and the user is never told the new dates did not persist.
        void updateTask(task.id, {
          startDate: format(newStart, "yyyy-MM-dd'T'HH:mm:ss"),
          endDate: format(newEnd, "yyyy-MM-dd'T'HH:mm:ss"),
          hoursPerDay: Math.round(newHoursPerDay * 10) / 10,
        }).catch(() => showToast(t('ganttProvider.toast.saveFailed'), 'error'));
      }

      setResizeOffset(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Handle right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Hide tooltip immediately when context menu opens
    setShowTooltip(false);
    setIsHovered(false);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Memoize position calculations
  const finalPosition = useMemo(() => {
    let left = getXByDate(task.startDate);
    let width = getWidthByDates(task.startDate, task.endDate);

    if (resizeOffset) {
      if (resizeOffset.side === 'start') {
        left += resizeOffset.deltaX;
        width -= resizeOffset.deltaX;
      } else {
        width += resizeOffset.deltaX;
      }
    }

    return { 
      left, 
      width: Math.max(width, pixelsPerDay) 
    };
  }, [task.startDate, task.endDate, getXByDate, getWidthByDates, resizeOffset, pixelsPerDay]);

  const resizeDate = useMemo(() => {
    if (!resizeOffset) return null;
    if (resizeOffset.side === 'start') {
      return getDateByX(finalPosition.left);
    }
    let date = getDateByX(finalPosition.left + finalPosition.width);
    if (zoomLevel === 'week') date = endOfWeek(date, { weekStartsOn: 0 });
    else if (zoomLevel === 'month' || zoomLevel === 'quarter') date = endOfMonth(date);
    return date;
  }, [resizeOffset, finalPosition, getDateByX, zoomLevel]);

  // Working-day count of the allocation as currently being resized
  const resizeDays = useMemo(() => {
    if (!resizeOffset || !resizeDate) return null;
    const start = resizeOffset.side === 'start' ? resizeDate : parseISO(task.startDate);
    const end = resizeOffset.side === 'end' ? resizeDate : parseISO(task.endDate);
    if (start > end) return null;
    const wd = settings?.workDays || [0, 1, 2, 3, 4];
    return Math.max(1, countWorkingDays(start, end, wd, holidaysByDate));
  }, [resizeOffset, resizeDate, task.startDate, task.endDate, settings?.workDays, holidaysByDate]);

  // Determine what content to show based on available width
  const showAvatar = viewMode === 'projects' && finalPosition.width >= 40;
  const showEmployeeName = viewMode === 'projects' && finalPosition.width > 80;
  const showProjectName = viewMode === 'employees';

  // Calculate utilization for conditional coloring
  const utilization = useMemo(() => {
    const reportedHours = task.reportedHours || 0;
    const totalHours = task.totalHours || 0;
    if (totalHours <= 0) return 0;
    return (reportedHours / totalHours) * 100;
  }, [task.reportedHours, task.totalHours]);

  // Calculate time progress for comparison with utilization
  const timeProgress = useMemo(() => {
    const start = parseISO(task.startDate);
    const end = parseISO(task.endDate);
    const today = new Date();

    const totalDays = differenceInDays(end, start) + 1;
    if (totalDays <= 0) return 100;

    // If task hasn't started yet
    if (today < start) return 0;

    // If task is complete
    if (today > end) return 100;

    const daysPassed = differenceInDays(today, start) + 1;
    return (daysPassed / totalDays) * 100;
  }, [task.startDate, task.endDate]);

  // Get utilization-based color
  const utilizationColor = useMemo(() => {
    // Only apply if reportedHoursColumnId is configured
    if (!settings?.reportedHoursColumnId) return null;

    if (utilization > 100) return 'var(--color-danger)'; // over budget — was: #e53935 (now unified to #ef4444)
    if (utilization > timeProgress * 1.2) return 'var(--color-warning)'; // burning 20%+ faster than expected — was: #fb8c00 (now unified to #f59e0b)
    if (timeProgress > 0 && utilization < timeProgress * 0.5) return 'var(--color-info)'; // behind schedule — was: #579bfc (now unified to #0073ea)
    return 'var(--color-success)'; // on track — was: #43a047 (now unified to #22c55e)
  }, [utilization, timeProgress, settings?.reportedHoursColumnId]);

  // Soften the project-color fill to a more delicate shade of the same hue.
  // Status (utilization) colors stay as-is; their bars keep white text.
  const softBarColor = task.color ? softenColor(task.color) : null;

  // Compute style with performance-optimized properties
  const style = useMemo((): React.CSSProperties => ({
    position: 'absolute',
    left: `${finalPosition.left}px`,
    width: `${finalPosition.width}px`,
    height: '36px',
    top: '6px',
    backgroundColor: utilizationColor || softBarColor || 'var(--color-monday-blue)',
    borderRadius: '18px',
    cursor: isDragging ? 'grabbing' : 'grab',
    display: 'flex',
    alignItems: 'center',
    color: (utilizationColor || !softBarColor) ? 'white' : getContrastColor(softBarColor),
    boxShadow: isDragging
      ? 'var(--shadow-dnd-drag)'
      : isHovered
      ? 'var(--shadow-dnd-active)'
      : 'var(--shadow-dnd)',
    zIndex: isDragging ? 100 : isHovered ? 20 : 10,
    opacity: isDragging ? 0.3 : isDimmed ? 'var(--opacity-bar-inactive)' : 1,
    filter: isHovered && !isDragging ? 'brightness(1.08)' : 'none',
    // Use translate3d for GPU acceleration - disabled during dragging as we use DragOverlay
    transform: transform && !isDragging
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : `translate3d(0, 0, 0)${isHovered && !isDragging ? ' scale(1.04)' : ''}`,
    transformOrigin: 'center center',
    transition: isDragging ? 'none' : `box-shadow ${CONFIG.transitionDuration}ms ease, opacity ${CONFIG.transitionDuration}ms ease, transform 150ms ease, filter 150ms ease`,
    willChange: isDragging ? 'transform' : 'auto',
  }), [finalPosition.left, finalPosition.width, softBarColor, isDragging, transform, utilizationColor, isHovered, isDimmed]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={(e) => {
        setIsHovered(true);
        setMousePos({ x: e.clientX, y: e.clientY });
        
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = setTimeout(() => {
          setShowTooltip(true);
        }, 500);
      }}
      onMouseMove={(e) => {
        if (isHovered) {
          // If tooltip is already showing, hide it on move
          if (showTooltip) {
            setShowTooltip(false);
          }

          setMousePos({ x: e.clientX, y: e.clientY });

          // Restart the delay timer on every move
          if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
          tooltipTimerRef.current = setTimeout(() => {
            setShowTooltip(true);
          }, 500);
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowTooltip(false);
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      }}
      className="group/bar select-none text-base font-semibold"
      data-task-id={task.id}
    >
      {/* Resize date tooltip */}
      {resizeOffset && resizeDate && resizePos && createPortal(
        <div
          className="fixed flex items-center gap-1 z-[9999] pointer-events-none"
          style={{
            left: resizePos.x,
            top: resizePos.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-bg-inverted text-white text-xs font-medium px-2 py-1 rounded shadow-lg whitespace-nowrap">
            {format(resizeDate, 'dd/MM')}
          </div>
          {resizeOffset.side === 'end' && resizeDays != null && (
            <div className="bg-accent text-white text-xs font-medium px-2 py-1 rounded shadow-lg whitespace-nowrap">
              {t('taskBar.tooltip.daysCount', { count: resizeDays })}
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Tooltip */}
      {showTooltip && !isDragging && !resizeOffset && createPortal(
        <div
          className="fixed p-3 bg-bg-inverted text-white text-xs rounded-lg shadow-xl z-[9999] min-w-[220px] pointer-events-none animate-in fade-in zoom-in-95 duration-200"
          style={{
            left: `${mousePos.x}px`,
            top: `${mousePos.y - 15}px`,
            transform: 'translate(-50%, -100%)'
          }}
          dir="rtl"
        >
          <div className="font-bold text-sm border-b border-white/20 pb-1.5 mb-1.5">
            {task.projectName || task.name}
          </div>
          <div className="space-y-1 text-xs">
            {task.capability && <div className="flex justify-between gap-4"><span className="text-white/70">{t('taskBar.tooltip.capability')}</span> <span className="font-medium">{task.capability}</span></div>}
            {task.userName && <div className="flex justify-between gap-4"><span className="text-white/70">{t('taskBar.tooltip.name')}</span> <span className="font-medium">{task.userName}</span></div>}
            {(() => {
              const dailyStandard = settings?.maxHoursPerDay || 8.5;
              const rawFte = dailyStandard > 0 ? (hoursPerDay / dailyStandard) * 100 : 0;
              const planPercent = rawFte > 0 ? Math.max(1, Math.round(rawFte)) : 0;
              const planHours = task.totalHours ?? 0;
              const actualPercent = Math.round(utilization || 0);
              const actualHours = task.reportedHours ?? 0;
              return (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-white/70">{t('taskBar.tooltip.planning')}</span>
                    <span className="font-medium">{t('taskBar.tooltip.percentHours', { percent: planPercent, hours: formatNum(planHours) })}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-white/70">{t('taskBar.tooltip.actual')}</span>
                    <span className="font-medium">{t('taskBar.tooltip.percentHours', { percent: actualPercent, hours: actualHours.toFixed(1) })}</span>
                  </div>
                </>
              );
            })()}
            <div className="flex justify-between gap-4 border-t border-white/10 pt-1 mt-1">
              <span className="text-white/70">{t('taskBar.tooltip.dates')}</span>
              <span dir="ltr">{format(parseISO(task.startDate), 'd/M/yy')} - {format(parseISO(task.endDate), 'd/M/yy')}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/70">{t('taskBar.tooltip.totalDays')}</span>
              <span className="font-medium">{durationDays}</span>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="flex items-center w-full px-2 gap-2 relative h-full" dir="ltr">
        {/* Resize Handle Start */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-white/30 z-30 transition-opacity"
          onMouseDown={(e) => handleResizeStart(e, 'start')}
          onPointerDown={(e) => e.stopPropagation()}
        />

        {/* Projects view: avatar + employee name */}
        {showAvatar && (
          <div
            className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/30 relative overflow-hidden"
          >
            {task.userPhotoUrl ? (
              <img
                src={task.userPhotoUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              task.userInitials || task.userName?.charAt(0)?.toUpperCase() || '?'
            )}
          </div>
        )}
        {showEmployeeName && (
          <span className="truncate text-xs font-bold min-w-0">
            {task.userName}
          </span>
        )}

        {/* Employees view: show project name */}
        {showProjectName && (
          <span className="truncate text-xs font-bold min-w-0">
            {task.projectName || task.name}
          </span>
        )}

        {/* Employees view: FTE % pinned to the right end of the bar.
            ml-auto in this LTR flex pushes it past the project name (which is
            min-width:0 + truncate, so it absorbs any leftover width). Hidden on
            very narrow bars to avoid clutter. */}
        {showProjectName && finalPosition.width > 60 && (() => {
          const dailyStandard = settings?.maxHoursPerDay || 8.5;
          const raw = dailyStandard > 0 ? (hoursPerDay / dailyStandard) * 100 : 0;
          // Round to nearest %, but never collapse a positive allocation to 0
          // — even sub-1% effort still counts as "some" load to the viewer.
          const ftePercent = raw > 0 ? Math.max(1, Math.round(raw)) : 0;
          return (
            <span className="text-xs font-bold ml-auto whitespace-nowrap flex-shrink-0">
              {ftePercent}%
            </span>
          );
        })()}

        {/* Drag indicator when dragging */}
        {isDragging && (
          <span className="text-xs bg-black/30 px-2 py-0.5 rounded-full mr-auto whitespace-nowrap font-bold shadow-sm ring-1 ring-white/20">
            {dynamicDragDatesText}
          </span>
        )}

        {/* Resize Handle End */}
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 hover:bg-white/30 z-30 transition-opacity"
          onMouseDown={(e) => handleResizeStart(e, 'end')}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </div>

      {/* Context Menu */}
      <ContextMenu
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
        options={[
          {
            label: t('taskBar.contextMenu.edit'),
            icon: (
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            ),
            onClick: () => openModal(task),
          },
          {
            label: t('allocation.button.duplicate'),
            icon: (
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ),
            onClick: () => openModal({ ...task, _duplicateSource: true }),
          },
          {
            label: t('allocation.button.delete'),
            icon: (
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            ),
            onClick: () => deleteAllocation(task.id),
            danger: true,
          },
        ]}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memo - only re-render if task data changed
  // Note: Internal hooks (useSettings, useGantt) will still trigger re-renders when their state changes
  return (
    prevProps.task.id === nextProps.task.id &&
    prevProps.task.name === nextProps.task.name &&
    prevProps.task.startDate === nextProps.task.startDate &&
    prevProps.task.endDate === nextProps.task.endDate &&
    prevProps.task.color === nextProps.task.color &&
    prevProps.task.userName === nextProps.task.userName &&
    prevProps.task.userPhotoUrl === nextProps.task.userPhotoUrl &&
    prevProps.task.hoursPerDay === nextProps.task.hoursPerDay &&
    prevProps.task.reportedHours === nextProps.task.reportedHours &&
    prevProps.task.role === nextProps.task.role &&
    prevProps.task.capability === nextProps.task.capability &&
    prevProps.isDimmed === nextProps.isDimmed
  );
});

TaskBar.displayName = 'TaskBar';
