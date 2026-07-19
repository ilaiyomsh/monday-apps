/**
 * viewTracking.ts — automatic view/tab usage tracking (decision D3). A view is reported at
 * most ONCE per session as a `view_open` usage event (kind='usage'), so re-renders and
 * back/forth navigation don't re-ship. Ships through logger.track() — inert until the Axiom
 * sink is active. TypeScript port of the error-guard viewTracking template.
 */
import { useEffect, useRef } from 'react';

type ViewDims = Record<string, unknown>;

/** The one method view-tracking needs from the shared logger. */
export interface TrackLogger {
  track: (event: string, dims?: ViewDims | null) => void;
}

export interface ViewTracker {
  track: (view: string, dims?: ViewDims) => void;
  reset: () => void;
}

/** Pure, dedup'd view tracker over a logger. One `view_open` per distinct view per instance. */
export function createViewTracker(logger: TrackLogger): ViewTracker {
  const seen = new Set<string>();
  return {
    /** Report a view the first time it's seen this session; dims fold into the message (D4). */
    track(view: string, dims?: ViewDims): void {
      if (!view || seen.has(view)) return;
      seen.add(view);
      logger.track('view_open', { view, ...(dims ?? {}) });
    },
    /** Clear the dedup memory (tests / explicit session reset). */
    reset(): void {
      seen.clear();
    },
  };
}

// One tracker per logger, module-scoped, so the hook dedups across every component and mount
// for the whole session (not per-component-instance) — StrictMode double-mount safe.
const trackers = new WeakMap<TrackLogger, ViewTracker>();

/**
 * Thin React hook: reports `view` once per session when it mounts / changes. Pass the app's
 * shared logger. `dims` are read at fire time; the effect re-runs only on logger/view change.
 */
export function useViewTracking(logger: TrackLogger, view: string, dims?: ViewDims): void {
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  useEffect(() => {
    let tracker = trackers.get(logger);
    if (!tracker) {
      tracker = createViewTracker(logger);
      trackers.set(logger, tracker);
    }
    tracker.track(view, dimsRef.current);
  }, [logger, view]);
}
