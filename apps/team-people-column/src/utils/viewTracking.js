/**
 * viewTracking.js — automatic view/tab usage tracking (decision D3). A view is reported
 * at most ONCE per session as a `view_open` usage event (kind='usage'), so navigating
 * back and forth doesn't re-ship. Ships through logger.track() — inert until the Axiom
 * sink is active. Plain-JS port of @axis/app-core usage/viewTracking.ts.
 */
import { useEffect, useRef } from 'react';

/** Pure, dedup'd view tracker over a logger. One `view_open` per distinct view per instance. */
export function createViewTracker(logger) {
  const seen = new Set();
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

// One tracker per logger, module-scoped, so the hook dedups across every component and
// mount for the whole session (not per-component-instance) — StrictMode double-mount safe.
const trackers = new WeakMap();

/**
 * Thin React hook: reports `view` once per session when it mounts / changes. Pass the app's
 * shared logger. `dims` are read at fire time; the effect re-runs only on logger/view change.
 */
export function useViewTracking(logger, view, dims) {
  // dims is read at fire time via a ref, so the effect depends only on [logger, view]
  // (stable) — no exhaustive-deps disable needed, which keeps this portable across the
  // apps' differing ESLint configs.
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
