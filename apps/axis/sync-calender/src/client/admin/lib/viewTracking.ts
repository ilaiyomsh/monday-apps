// viewTracking.ts — automatic view/tab usage tracking (decision D3). A view is
// reported at most ONCE per session as a `view_open` usage event (kind='usage'),
// so navigating back and forth between tabs doesn't re-ship. Ships through
// logger.track() — inert until a remote transport is attached (see logger.ts).
// TypeScript port of the plain-JS viewTracking used by the other client apps.
import { useEffect, useRef } from 'react';

type Dims = Record<string, unknown>;

/** Anything with a track() method — duck-typed so any logger-shaped object works. */
export interface TrackLogger {
  track(event: string, dims?: Dims): void;
}

export interface ViewTracker {
  track(view: string, dims?: Dims): void;
  reset(): void;
}

/** Pure, dedup'd view tracker over a logger. One `view_open` per distinct view per instance. */
export function createViewTracker(logger: TrackLogger): ViewTracker {
  const seen = new Set<string>();
  return {
    /** Report a view the first time it's seen this session; dims fold into the message (D4). */
    track(view, dims) {
      if (!view || seen.has(view)) return;
      seen.add(view);
      logger.track('view_open', { view, ...(dims || {}) });
    },
    /** Clear the dedup memory (tests / explicit session reset). */
    reset() {
      seen.clear();
    },
  };
}

// One tracker per logger, module-scoped, so the hook dedups across every component
// and mount for the whole session (not per-component-instance) — StrictMode
// double-mount safe.
const trackers = new WeakMap<TrackLogger, ViewTracker>();

/**
 * Thin React hook: reports `view` once per session when it mounts / changes. Pass
 * the app's shared logger. `dims` are read at fire time via a ref, so the effect
 * depends only on [logger, view].
 */
export function useViewTracking(logger: TrackLogger, view: string, dims?: Dims): void {
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
