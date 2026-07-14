import type { ZoomLevel } from '../types/gantt.types';

// #90 perf/unified-load: when true, the critical path uses the unified bundle
// (lean allocations + aggregate reported hours + batched project metadata in two
// round-trips). Requires reportedHoursColumnId + timeLogsAllocationColumnId to be
// set; otherwise the code falls back to the legacy per-allocation heavy fetch.
export const USE_UNIFIED_LOAD = true;

// Pixels per day for each zoom level
export const PIXELS_PER_DAY: Record<ZoomLevel, number> = {
  day: 100,      // 1 day = 100px
  week: 14.28,   // 7 days ≈ 100px (100/7)
  month: 3.28,   // 30.5 days ≈ 100px (100/30.5)
  quarter: 1.1,  // 91 days ≈ 100px (100/91)
};

// Initial days per zoom level
export const INITIAL_DAYS: Record<ZoomLevel, { past: number; future: number }> = {
  day: { past: 30, future: 60 },
  week: { past: 60, future: 120 },
  month: { past: 180, future: 365 },
  quarter: { past: 365, future: 730 },
};

// Batch size per zoom level (days to load when reaching edge)
export const DAYS_BATCH: Record<ZoomLevel, number> = {
  day: 30,
  week: 60,
  month: 90,
  quarter: 180,
};

// Minimum buffer in days (how many days ahead of edge to trigger loading)
export const MIN_BUFFER_DAYS: Record<ZoomLevel, number> = {
  day: 14,
  week: 30,
  month: 60,
  quarter: 120,
};

// Centralized configuration for performance optimization
export const CONFIG = {
  // Layout dimensions
  rowHeight: 48,
  groupHeaderHeight: 48,
  sidebarWidth: 240,
  headerHeight: 64, // 2 levels * 32px each
  headerLevelHeight: 32,

  // Virtualization buffers
  verticalBuffer: 5,      // Extra rows to render above/below viewport
  horizontalBuffer: 100,  // Extra pixels to render left/right of viewport

  // Infinite scroll settings
  infiniteScrollBuffer: 800,  // Increase buffer to trigger loading much earlier
  daysBatch: 60,              // Load 60 days at a time for smoother expansion

  // Initial timeline range
  initialPastDays: 60,        // Start with more days in the past
  initialFutureDays: 120,     // Start with more days in the future

  // Animation
  transitionDuration: 200,

  // Minimum track rows for expanded groups with PM/project type bar (2 * 48px = 96px)
  minExpandedTrackRows: 2,
} as const;

// Floating ProjectSummaryCard height: exactly 2 track rows (= 96px) so the card's
// two internal rows (PM/type bar + hours metrics) line up 1:1 with the Gantt row
// grid. The minimal expanded block (≤1 track) is padded up to this height so the
// card's bottom lines up with the project block's bottom without cramping.
export const PROJECT_CARD_HEIGHT = CONFIG.rowHeight * 2;

// Projects view — focus/summary visual separation (all tunable in one place):
// • SUMMARY_TRACKS_GAP — neutral gap opened between a project's summary (header)
//   row and its first allocation track. Deliberately larger than the ~0px gap
//   between the allocation tracks themselves, so the summary reads as a distinct
//   band above the allocations.
// • FOCUS_BLOCK_GAP — neutral gap opened ABOVE the focused project's header and
//   BELOW its last track, detaching the focused block from its neighbours.
// • DIMMED_OPACITY — opacity applied to the CONTENT of non-focused rows in focus
//   mode (never to the row/sticky-sidebar container — that reintroduces the
//   timeline-bleed-through bug documented in VirtualRowList).
export const SUMMARY_TRACKS_GAP = 10;
export const FOCUS_BLOCK_GAP = 10;
export const DIMMED_OPACITY = 0.25;

// Gap FILL colors. Gaps must NOT read as a separator stripe — they blend with
// the surface around them and rely on a shadow for the actual separation:
// • summary↔tracks gap → white (the summary card + allocation rows are all white),
//   so the gap is invisible as colour; the header's drop shadow does the split.
// • focus block gap → the page background, so the focused block floats above the
//   page like a lifted card (shadow supplied by the focus edges).
export const GAP_COLOR_SUMMARY = 'var(--color-bg-surface)';
export const GAP_COLOR_FOCUS = 'var(--color-bg-app)';

// Legacy exports for backwards compatibility
export const ROW_HEIGHT = CONFIG.rowHeight;
export const HEADER_HEIGHT = CONFIG.headerHeight;
export const SIDEBAR_WIDTH = CONFIG.sidebarWidth;

export const DEFAULT_ZOOM: ZoomLevel = 'month';

// Snap unit in days for each zoom level (for grid interactions)
// Day = 1 day, Week = 7 days, Month = ~30 days, Quarter = ~91 days
export const SNAP_DAYS: Record<ZoomLevel, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 91,
};

// Dynamic start date - 30 days before today
export const GLOBAL_START_DATE = new Date(
  new Date().getFullYear(),
  new Date().getMonth(),
  new Date().getDate() - CONFIG.initialPastDays
);
