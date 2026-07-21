import React, { useCallback, useState, useMemo, useEffect, useRef, lazy } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { DragEndEvent } from '@dnd-kit/core';
import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import { VirtualRowList } from './VirtualRowList';
import { useGantt } from '../../hooks/useGantt';
import { useSettings } from '../../contexts/SettingsContext';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import type { Task, ZoomLevel } from '../../types/gantt.types';
import { TaskBarOverlay } from './TaskBarOverlay';
import { ResizeHandle } from './ResizeHandle';
import { FilterDropdown } from './FilterDropdown';
import { AllocationsErrorBanner } from './AllocationsErrorBanner';
import { findOverlappingAllocations } from '../../utils/overlapUtils';
import { FreeFallLoader } from '../ui';
import { SNAP_DAYS } from '../../utils/constants';
import { LazyBoundary } from '../ui/LazyBoundary';
import { useLocale } from '../../hooks/useLocale';
import { logger } from '../../utils/Logger';
import { useViewTracking } from '../../utils/viewTracking';

// Lazy-load SettingsDialog - only loaded when user clicks settings
const SettingsDialog = lazy(() =>
  import('../Settings/SettingsDialog').then(m => ({ default: m.SettingsDialog }))
);

// Buffer days per zoom level for scrollToToday - exceeds MIN_BUFFER_DAYS
// to ensure we don't trigger timeline extension during scroll animation
const SCROLL_BUFFER_DAYS: Record<ZoomLevel, number> = {
  day: 20,
  week: 40,
  month: 80,
  quarter: 150,
};

/**
 * GanttChart - Main container component for the Gantt chart
 * Features:
 * - RTL layout support
 * - Drag and drop task movement
 * - Zoom level controls
 * - Infinite scroll timeline
 * - Vertical virtualization
 */
export const GanttChart: React.FC = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  // Usage telemetry (D3): report the gantt view once per session (StrictMode-safe).
  useViewTracking(logger, 'gantt');
  const {
    zoomLevel,
    setZoomLevel,
    viewMode,
    setViewMode,
    updateTask,
    pixelsPerDay,
    flattenedRows,
    openModal,
    loading,
    getXByDate,
    containerRef,
    sidebarWidth,
    rawAllocations,
    timelineStart,
    timelineEnd,
    pendingDelete,
    undoDelete,
  } = useGantt();

  // Scroll so today's red marker lands at the absolute center of the viewport
  // (including the sticky sidebar). The "היום" button uses smooth scroll;
  // tab-switches use instant so there's no flicker as content swaps.
  const scrollToToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!containerRef.current) return;

    const today = new Date();
    const todayX = getXByDate(today);
    // Place today at clientWidth/2 from the container's left edge. The sidebar
    // is sticky within the scroll container, so we add sidebarWidth to keep
    // today centered against the actual viewport, not just the gantt area.
    const scrollPos = todayX + sidebarWidth - containerRef.current.clientWidth / 2;
    const finalScroll = Math.max(0, scrollPos);

    // Switch to instant near timeline edges — smooth scroll races with the
    // infinite-timeline extension and can land in the wrong place.
    const daysFromStart = differenceInDays(today, timelineStart);
    const daysFromEnd = differenceInDays(timelineEnd, today);
    const bufferDays = SCROLL_BUFFER_DAYS[zoomLevel];
    const isNearEdge = daysFromStart < bufferDays || daysFromEnd < bufferDays;
    const effectiveBehavior: ScrollBehavior = behavior === 'instant' || isNearEdge ? 'instant' : 'smooth';

    containerRef.current.scrollTo({ left: finalScroll, behavior: effectiveBehavior });
  }, [getXByDate, containerRef, sidebarWidth, timelineStart, timelineEnd, zoomLevel]);

  // Center today on every tab opening — initial mount + viewMode change.
  // Wait via RAF until the container is laid out (clientWidth > 0); otherwise
  // the math collapses to scrollLeft=0 and today ends up at the far right.
  const lastCenteredViewModeRef = useRef<typeof viewMode | null>(null);
  useEffect(() => {
    if (lastCenteredViewModeRef.current === viewMode) return;
    let cancelled = false;
    let rafId = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const c = containerRef.current;
      if (!c || c.clientWidth <= 0) {
        rafId = requestAnimationFrame(tryScroll);
        return;
      }
      scrollToToday('instant');
      lastCenteredViewModeRef.current = viewMode;
    };
    rafId = requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [viewMode, scrollToToday]);

  // Configure drag sensors with activation constraint
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Get snap unit in days for current zoom level
  const snapDays = SNAP_DAYS[zoomLevel];
  const pixelsPerSnapUnit = pixelsPerDay * snapDays;

  // Handle drag end - update task dates with zoom-level snapping
  // Week: snap start→Sunday, end→Saturday
  // Month: snap start→1st, end→last day of month
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, delta } = event;
    if (!active) {
      setActiveTask(null);
      return;
    }

    const task = active.data.current as Task;
    if (!task) {
      setActiveTask(null);
      return;
    }

    // Right (future): snap to zoom-level grid. Left (past): snap to individual days.
    const daysDiff = delta.x >= 0
      ? Math.round(delta.x / pixelsPerSnapUnit) * snapDays
      : Math.round(delta.x / pixelsPerDay);

    if (daysDiff !== 0) {
      const currentStart = parseISO(task.startDate);
      const currentEnd = parseISO(task.endDate);
      const newStart = addDays(currentStart, daysDiff);
      const newEnd = addDays(currentEnd, daysDiff);

      // Format dates preserving local timezone (toISOString shifts to UTC, causing off-by-one in Israel TZ)
      const formatDate = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm:ss");

      // Check for overlap before updating
      if (task.employeeId && task.projectId) {
        const overlapResult = findOverlappingAllocations(
          task.employeeId,
          task.projectId.toString(),
          formatDate(newStart),
          formatDate(newEnd),
          rawAllocations,
          task.id
        );

        if (overlapResult.hasOverlap) {
          setActiveTask(null);
          return;
        }
      }

      updateTask(active.id as string, {
        startDate: formatDate(newStart),
        endDate: formatDate(newEnd),
      });
    }

    setActiveTask(null);
  }, [pixelsPerSnapUnit, snapDays, pixelsPerDay, updateTask, rawAllocations]);

  // Count active rows for display
  const activeRowCount = flattenedRows.length;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const { settings, updateSettings: updateGlobalSettings } = useSettings();

  // Auto-scroll during drag operations
  useAutoScroll({
    containerRef,
    isActive: activeTask !== null,
    edgeThreshold: 120,
    scrollSpeed: 8,
  });

  // Modifiers: right = snap to zoom-level grid; left = free (per-day resolution)
  const directionalSnap = useCallback(
    ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => {
      const snappedX = transform.x >= 0
        ? Math.round(transform.x / pixelsPerSnapUnit) * pixelsPerSnapUnit
        : transform.x; // no snap for leftward (past) movement
      return { ...transform, x: snappedX };
    },
    [pixelsPerSnapUnit]
  );
  const modifiers = useMemo(() => [restrictToHorizontalAxis, directionalSnap], [directionalSnap]);

  // Handle drag start - set active task for overlay
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTask(event.active.data.current as Task);
  }, []);

  return (
    <DndContext 
      sensors={sensors} 
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      modifiers={modifiers}
      autoScroll={{ layoutShiftCompensation: false }}
    >
      <div className="flex flex-col h-full bg-bg-surface rounded-xl shadow-2xl border border-border-subtle overflow-hidden">
        <AllocationsErrorBanner />
        <header className="relative flex items-center justify-between px-6 py-4 bg-bg-surface border-b border-border-faint flex-shrink-0" dir={locale.dir}>
          {/* Start side - View Mode Tabs */}
          <div className="flex items-center">
            <div className="flex items-center gap-2 bg-bg-section p-1 rounded-lg">
              <button
                onClick={() => setViewMode('projects')}
                className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${
                  viewMode === 'projects'
                    ? 'bg-bg-surface shadow-sm text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t('gantt.viewMode.projects')}
              </button>
              <button
                onClick={() => setViewMode('employees')}
                className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${
                  viewMode === 'employees'
                    ? 'bg-bg-surface shadow-sm text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t('gantt.viewMode.employees')}
              </button>
            </div>
          </div>

          {/* Center - Zoom Controls + Today Button */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
            {/* Zoom Controls */}
            <div className="flex items-center gap-2 bg-bg-section p-1 rounded-lg">
              <button
                onClick={() => setZoomLevel('quarter')}
                className={`px-3 py-1.5 text-sm font-bold rounded transition-all ${
                  zoomLevel === 'quarter'
                    ? 'bg-bg-surface shadow text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t('gantt.zoom.quarter')}
              </button>
              <button
                onClick={() => setZoomLevel('month')}
                className={`px-3 py-1.5 text-sm font-bold rounded transition-all ${
                  zoomLevel === 'month'
                    ? 'bg-bg-surface shadow text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t('gantt.zoom.month')}
              </button>
              <button
                onClick={() => setZoomLevel('week')}
                className={`px-3 py-1.5 text-sm font-bold rounded transition-all ${
                  zoomLevel === 'week'
                    ? 'bg-bg-surface shadow text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t('gantt.zoom.week')}
              </button>
              <button
                onClick={() => setZoomLevel('day')}
                className={`px-3 py-1.5 text-sm font-bold rounded transition-all ${
                  zoomLevel === 'day'
                    ? 'bg-bg-surface shadow text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {t('gantt.zoom.day')}
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-6 bg-border-default" />

            {/* Today Button */}
            <button
              onClick={() => scrollToToday()}
              className="px-4 py-1.5 bg-accent text-white rounded-lg hover:bg-accent-hover transition-all duration-150 font-bold text-sm shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-95"
            >
              {t('gantt.toolbar.today')}
            </button>
          </div>

          {/* End side - Filter, Settings */}
          <div className="flex items-center gap-4">
            {/* Filter Dropdown */}
            <FilterDropdown />

            {/* Settings Button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-text-muted rounded-lg hover:bg-bg-hover hover:text-text-secondary transition-all duration-150 hover:scale-105 hover:shadow-md"
              aria-label={t('gantt.toolbar.settings')}
              title={t('gantt.toolbar.settings')}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </header>
        
        {/* Main Gantt Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <VirtualRowList />
          
          {/* Resize Handle for Sidebar */}
          <ResizeHandle />
          
          {/* Loading Overlay - only on initial load when no data exists */}
          {loading && flattenedRows.length === 0 && (
            <div className="absolute inset-0 bg-bg-surface/40 backdrop-blur-[1px] z-[100] flex items-center justify-center transition-all duration-300">
              <div className="flex flex-col items-center gap-3 p-6 bg-bg-surface rounded-2xl shadow-xl border border-border-faint">
                <FreeFallLoader size={48} />
                <span className="text-sm font-bold text-text-muted">{t('gantt.loading')}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Settings Dialog - Lazy loaded */}
      <LazyBoundary>
        <SettingsDialog
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </LazyBoundary>

      {/* Drag Overlay for smoother performance */}
      {createPortal(
        <DragOverlay>
          {activeTask && <TaskBarOverlay task={activeTask} />}
        </DragOverlay>,
        document.body
      )}

      {/* Undo Delete Toast */}
      {pendingDelete && createPortal(
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 bg-bg-inverted text-white pl-5 pr-2 py-2.5 rounded-lg shadow-xl animate-in slide-in-from-bottom-4 fade-in duration-300"
          dir={locale.dir}
        >
          <span className="text-sm font-medium">{t('gantt.deleteToast.message')}</span>
          <button
            onClick={undoDelete}
            className="px-3 py-1 text-sm font-bold text-accent hover:bg-white/10 rounded-md transition-colors"
          >
            {t('gantt.deleteToast.undo')}
          </button>
        </div>,
        document.body
      )}

    </DndContext>
  );
};
