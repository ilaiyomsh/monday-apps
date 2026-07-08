import React, { useMemo, useState, useEffect } from 'react';
import { useDndContext, Active } from '@dnd-kit/core';
import type { Task } from '../../types/gantt.types';
import { useGantt } from '../../hooks/useGantt';
import { formatDateRange, getDynamicDates } from '../../utils/dateUtils';
import { useLocale } from '../../hooks/useLocale';
import { softenColor, getContrastColor } from '../../utils/colorUtils';
import { SNAP_DAYS } from '../../utils/constants';

interface TaskBarOverlayProps {
  task: Task;
}

/**
 * TaskBarOverlay - A lightweight, non-interactive version of TaskBar
 * used specifically for the DragOverlay to ensure smooth performance.
 */
export const TaskBarOverlay: React.FC<TaskBarOverlayProps> = ({ task }) => {
  const { getWidthByDates, pixelsPerDay, viewMode, zoomLevel } = useGantt();
  const locale = useLocale();
  const { active } = useDndContext();
  const [debouncedDatesText, setDebouncedDatesText] = useState('');

  // Get snap unit for current zoom level
  const snapDays = SNAP_DAYS[zoomLevel];
  const pixelsPerSnapUnit = pixelsPerDay * snapDays;

  // Get delta from active transform
  const delta = active?.rect?.current?.translated
    ? { x: active.rect.current.translated.left - (active.rect.current.initial?.left || 0) }
    : null;

  const width = useMemo(() => {
    const w = getWidthByDates(task.startDate, task.endDate);
    return Math.max(w, pixelsPerDay);
  }, [task.startDate, task.endDate, getWidthByDates, pixelsPerDay]);

  // Debounced date calculation to avoid jitter and excessive updates
  useEffect(() => {
    if (!delta) {
      setDebouncedDatesText(formatDateRange(task.startDate, task.endDate, { lang: locale.culture }));
      return;
    }

    const timer = setTimeout(() => {
      const { startDate, endDate } = getDynamicDates(
        task.startDate,
        task.endDate,
        delta.x,
        pixelsPerSnapUnit,
        snapDays
      );
      setDebouncedDatesText(formatDateRange(startDate, endDate, { lang: locale.culture }));
    }, 50); // Small debounce for smoothness

    return () => clearTimeout(timer);
  }, [task.startDate, task.endDate, delta?.x, pixelsPerSnapUnit, snapDays, locale.culture]);

  const showAvatar = viewMode === 'projects' && width >= 40;
  const showEmployeeName = viewMode === 'projects' && width > 80;
  const showProjectName = viewMode === 'employees';
  const showDateRange = width > 140;

  const softBarColor = task.color ? softenColor(task.color) : null;

  const style: React.CSSProperties = {
    width: `${width}px`,
    height: '36px',
    backgroundColor: softBarColor || 'var(--color-monday-blue)',
    borderRadius: '18px',
    display: 'flex',
    alignItems: 'center',
    color: softBarColor ? getContrastColor(softBarColor) : 'white',
    boxShadow: 'var(--shadow-dnd-drag)',
    opacity: 0.9,
    cursor: 'grabbing',
    pointerEvents: 'none',
  };

  return (
    <div style={style} className="select-none overflow-hidden text-base font-semibold">
      <div className="flex items-center w-full px-2 gap-2 relative h-full">
        {/* Projects view: avatar + employee name */}
        {showAvatar && (
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold flex-shrink-0 border border-white/30 overflow-hidden">
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

        {/* Employees view: project name */}
        {showProjectName && (
          <span className="truncate text-xs font-bold min-w-0 flex-1">
            {task.projectName || task.name}
          </span>
        )}

        {/* Dynamic Date Range during drag */}
        {showDateRange && (
          <span className="text-xs bg-black/40 px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap font-bold shadow-sm ring-1 ring-white/20 animate-in fade-in duration-200">
            {debouncedDatesText}
          </span>
        )}
      </div>
    </div>
  );
};
