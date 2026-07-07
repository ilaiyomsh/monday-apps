import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { addDays, differenceInDays, eachDayOfInterval, startOfDay, startOfWeek, startOfMonth, startOfQuarter } from 'date-fns';
import { CONFIG, PIXELS_PER_DAY, INITIAL_DAYS, DAYS_BATCH, MIN_BUFFER_DAYS } from '../utils/constants';
import type { ZoomLevel } from '../types/gantt.types';

interface UseInfiniteTimelineProps {
  zoomLevel: ZoomLevel;
  initialPastDays?: number;
  initialFutureDays?: number;
  // Rule 1: fired (debounced) when the user scrolls near the left/past edge, so
  // the data layer can fetch one more year of past allocations. The hook only
  // EXPOSES the trigger — useAllocations owns the window-cursor bound advance.
  onReachPastEdge?: () => void;
  // True while a past fetch is already in flight — guards against re-firing the
  // trigger (and against programmatic-scroll false positives during centering).
  isPastFetchInFlight?: boolean;
}

interface DrillRequest {
  anchor: Date;
  viewportX: number;
}

interface UseInfiniteTimelineReturn {
  timelineStart: Date;
  timelineEnd: Date;
  displayDays: Date[];
  totalWidth: number;
  handleScroll: (scrollLeft: number, clientWidth: number, scrollWidth: number) => void;
  getXByDate: (date: Date | string) => number;
  getDateByX: (x: number) => Date;
  getWidthByDates: (start: Date | string, end: Date | string) => number;
  pixelsPerDay: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Register a pending drill-down. Call this BEFORE changing zoomLevel; the
   * next zoom reset will anchor the timeline around `anchor` (instead of
   * today) and place it at `viewportX` (instead of viewport center).
   */
  requestDrillDown: (req: DrillRequest) => void;
}

/**
 * Align a date to the grid boundary for the given zoom level.
 * Ensures timelineStart always falls on a grid-aligned date so that
 * pixel↔date conversions match the visual grid columns.
 */
const alignToGrid = (date: Date, zoom: ZoomLevel): Date => {
  if (zoom === 'week') return startOfWeek(date, { weekStartsOn: 0 });
  if (zoom === 'month') return startOfMonth(date);
  if (zoom === 'quarter') return startOfMonth(date);
  return startOfDay(date); // day zoom - already aligned
};

/**
 * Hook for managing infinite horizontal scrolling timeline
 * Dynamically loads more days as user scrolls to edges
 */
export const useInfiniteTimeline = ({
  zoomLevel,
  onReachPastEdge,
  isPastFetchInFlight,
}: UseInfiniteTimelineProps): UseInfiniteTimelineReturn => {
  const { past: initialPast, future: initialFuture } = INITIAL_DAYS[zoomLevel];
  const daysBatch = DAYS_BATCH[zoomLevel];
  const minBufferDays = MIN_BUFFER_DAYS[zoomLevel];

  // Timeline boundaries - aligned to grid boundary to match visual columns
  const [timelineStart, setTimelineStart] = useState<Date>(() =>
    alignToGrid(startOfDay(addDays(new Date(), -initialPast)), zoomLevel)
  );
  const [timelineEnd, setTimelineEnd] = useState<Date>(() =>
    startOfDay(addDays(new Date(), initialFuture))
  );
  
  // Track if initial scroll has been performed
  const hasInitializedScroll = useRef(false);
  
  // Reference to previous start for scroll adjustment
  const prevStartRef = useRef<Date>(timelineStart);
  const containerRef = useRef<HTMLDivElement>(null);
  // Debounce timer for the near-past-edge fetch-more trigger (Rule 1). The
  // visual render-prepend stays immediate; only the DATA fetch is debounced.
  const pastEdgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Current pixels per day based on zoom level
  const pixelsPerDay = PIXELS_PER_DAY[zoomLevel];
  
  // Generate array of all days in the current timeline
  const displayDays = eachDayOfInterval({
    start: timelineStart,
    end: timelineEnd,
  });
  
  // Total width of the timeline
  const totalWidth = displayDays.length * pixelsPerDay;

  // Pending drill-down: when set, the next zoom reset anchors the timeline
  // range around `anchor` and places it at `viewportX` instead of centering on
  // today. Consumed (and cleared) by the centering layout effect below.
  const drillRequestRef = useRef<DrillRequest | null>(null);
  const requestDrillDown = useCallback((req: DrillRequest) => {
    drillRequestRef.current = req;
  }, []);

  // Reset timeline when zoom level changes
  useEffect(() => {
    const { past, future } = INITIAL_DAYS[zoomLevel];
    const anchor = drillRequestRef.current?.anchor ?? new Date();
    setTimelineStart(alignToGrid(startOfDay(addDays(anchor, -past)), zoomLevel));
    setTimelineEnd(startOfDay(addDays(anchor, future)));
    hasInitializedScroll.current = false;
  }, [zoomLevel]);

  // Ensure we always have enough content to scroll
  useEffect(() => {
    if (!containerRef.current) return;
    
    const clientWidth = containerRef.current.clientWidth;
    if (clientWidth === 0) return;

    const requiredWidth = clientWidth + (minBufferDays * pixelsPerDay * 2);
    
    // If content is too small - expand
    if (totalWidth < requiredWidth) {
      const daysNeeded = Math.ceil((requiredWidth - totalWidth) / pixelsPerDay);
      setTimelineEnd(prev => addDays(prev, Math.max(daysNeeded, daysBatch)));
    }
  }, [totalWidth, pixelsPerDay, minBufferDays, daysBatch, zoomLevel]);

  /**
   * Convert a date to X position in pixels
   */
  const getXByDate = useCallback((date: Date | string): number => {
    const d = typeof date === 'string' ? new Date(date) : date;
    const diff = differenceInDays(d, timelineStart);
    return diff * pixelsPerDay;
  }, [timelineStart, pixelsPerDay]);
  
  /**
   * Convert an X position to a date
   */
  const getDateByX = useCallback((x: number): Date => {
    const daysToAdd = Math.round(x / pixelsPerDay);
    return addDays(timelineStart, daysToAdd);
  }, [timelineStart, pixelsPerDay]);
  
  /**
   * Calculate width in pixels between two dates
   */
  const getWidthByDates = useCallback((
    start: Date | string, 
    end: Date | string
  ): number => {
    const s = typeof start === 'string' ? new Date(start) : start;
    const e = typeof end === 'string' ? new Date(end) : end;
    const diff = differenceInDays(e, s) + 1; // +1 to include end date
    return Math.max(diff * pixelsPerDay, pixelsPerDay); // Minimum 1 day width
  }, [pixelsPerDay]);
  
  /**
   * Handle scroll events for infinite loading
   * Using LTR scroll behavior for consistency
   */
  const handleScroll = useCallback((
    scrollLeft: number, 
    clientWidth: number, 
    scrollWidth: number
  ) => {
    // Calculate buffer in days instead of pixels for zoom sensitivity
    const bufferPixels = minBufferDays * pixelsPerDay;
    
    // Load PAST days when scrolling to the left edge (render-prepend immediate)
    if (scrollLeft < bufferPixels) {
      setTimelineStart(prev => alignToGrid(addDays(prev, -daysBatch), zoomLevel));
      // Rule 1: also debounce-trigger a +1yr past DATA fetch, guarded by the
      // in-flight flag so it doesn't re-fire while a window is already loading.
      if (!isPastFetchInFlight && onReachPastEdge) {
        if (pastEdgeTimerRef.current) clearTimeout(pastEdgeTimerRef.current);
        pastEdgeTimerRef.current = setTimeout(() => onReachPastEdge(), 300);
      }
    }

    // Load FUTURE days when scrolling to the right edge (render-only)
    if (scrollLeft + clientWidth >= scrollWidth - bufferPixels) {
      setTimelineEnd(prev => addDays(prev, daysBatch));
    }
  }, [pixelsPerDay, minBufferDays, daysBatch, zoomLevel, onReachPastEdge, isPastFetchInFlight]);
  
  /**
   * Adjust scroll position when loading past days
   * This prevents the viewport from jumping when new days are prepended
   * When we add days to the past (left side in LTR), we need to adjust scrollLeft
   * to maintain the same visual position
   */
  useLayoutEffect(() => {
    if (prevStartRef.current.getTime() !== timelineStart.getTime()) {
      const daysAdded = differenceInDays(prevStartRef.current, timelineStart);
      
      if (daysAdded > 0 && containerRef.current) {
        const widthAdded = daysAdded * pixelsPerDay;
        // Add to scrollLeft to maintain the same visual position
        // since we're adding content to the left
        containerRef.current.scrollLeft += widthAdded;
      }
      
      prevStartRef.current = timelineStart;
    }
  }, [timelineStart, pixelsPerDay]);

  // Clear the past-edge debounce timer on unmount.
  useEffect(() => () => {
    if (pastEdgeTimerRef.current) clearTimeout(pastEdgeTimerRef.current);
  }, []);

  // Track zoom level for centering control
  const prevZoomRef = useRef<ZoomLevel>(zoomLevel);
  const centerRafRef = useRef<number | null>(null);

  /**
   * Initial scroll to center "Today" in the visible Gantt area.
   * Runs ONLY on:
   * 1. Initial load (hasInitializedScroll = false)
   * 2. Zoom level change (prevZoomRef !== zoomLevel)
   *
   * Because the container element may not exist yet (a loading screen is shown
   * while data is fetched), we use a requestAnimationFrame retry loop.  The loop
   * is very short-lived — it runs for at most a few frames until the container
   * mounts, then performs the centering + pre-expand and stops.
   */
  useLayoutEffect(() => {
    const isZoomChange = prevZoomRef.current !== zoomLevel;
    if (hasInitializedScroll.current && !isZoomChange) return;

    // Cancel any pending retry from a previous render
    if (centerRafRef.current !== null) {
      cancelAnimationFrame(centerRafRef.current);
      centerRafRef.current = null;
    }

    const centerOnToday = (): boolean => {
      if (!containerRef.current || containerRef.current.clientWidth <= 0) return false;

      // If a drill-down was requested, pin the anchor date to the cursor
      // position from the click. Otherwise center "today" in the viewport.
      const drill = drillRequestRef.current;

      // Race guard: useLayoutEffect (this code) runs BEFORE the zoom-reset
      // useEffect on a zoom change. On the first run for the drill, timelineStart
      // is still the previous zoom's value — computing getXByDate against it
      // produces a wrong position and the subsequent reset would clobber it
      // (defaulting back to today because we'd have cleared drillRequestRef).
      // Instead, defer until the reset has applied — detected by timelineStart
      // matching exactly what the reset effect would produce for this drill.
      // The next render (triggered by the reset's setState) updates getXByDate,
      // and this effect re-runs automatically via its deps.
      if (drill) {
        const { past } = INITIAL_DAYS[zoomLevel];
        const expectedStart = alignToGrid(startOfDay(addDays(drill.anchor, -past)), zoomLevel);
        if (timelineStart.getTime() !== expectedStart.getTime()) {
          return false; // do NOT clear drillRequestRef; wait for next render
        }
      }

      const anchorDate = drill?.anchor ?? new Date();
      const anchorX = getXByDate(anchorDate);
      const viewportOffset = drill
        ? drill.viewportX
        : containerRef.current.clientWidth / 2;

      const targetScroll = anchorX + CONFIG.sidebarWidth - viewportOffset;
      const finalScroll = Math.max(0, targetScroll);

      containerRef.current.scrollLeft = finalScroll;
      hasInitializedScroll.current = true;
      prevZoomRef.current = zoomLevel;
      drillRequestRef.current = null;

      // Pre-expand the past timeline if the initial scroll position falls inside the
      // buffer zone. Without this, the first left-drag immediately triggers a timeline
      // expansion mid-gesture, causing a scroll jump that confuses the DnD system and
      // makes it feel like you can't drag left until you first drag right.
      const bufferPixels = minBufferDays * pixelsPerDay;
      if (finalScroll < bufferPixels) {
        setTimelineStart(prev => alignToGrid(addDays(prev, -daysBatch), zoomLevel));
      }
      return true;
    };

    // Try immediately (works on zoom change when container already exists)
    if (centerOnToday()) return;

    // Container not ready yet (loading screen visible) — retry each frame.
    // No attempt limit: the app can take 10+ seconds to load from Monday.com API.
    // The effect's cleanup cancels the loop on unmount, so there's no leak risk.
    const retry = () => {
      if (!centerOnToday()) {
        centerRafRef.current = requestAnimationFrame(retry);
      }
    };
    centerRafRef.current = requestAnimationFrame(retry);

    return () => {
      if (centerRafRef.current !== null) {
        cancelAnimationFrame(centerRafRef.current);
        centerRafRef.current = null;
      }
    };
  }, [getXByDate, zoomLevel, minBufferDays, pixelsPerDay, daysBatch]);
  
  return {
    requestDrillDown,
    timelineStart,
    timelineEnd,
    displayDays,
    totalWidth,
    handleScroll,
    getXByDate,
    getDateByX,
    getWidthByDates,
    pixelsPerDay,
    containerRef,
  };
};
