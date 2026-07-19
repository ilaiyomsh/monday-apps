/**
 * Automatic view/tab usage tracking (decision D3). A view is reported at most ONCE per
 * session as a `view_open` usage event (kind='usage'), so navigating back and forth doesn't
 * re-ship. Ships through the same logger.track() path — inert until the Axiom sink is active.
 */
import { useEffect } from 'react';
import type { Logger } from '../logger';

export interface ViewTracker {
  /** Report a view the first time it's seen this session; dims fold into the message (D4). */
  track(view: string, dims?: Record<string, unknown>): void;
  /** Clear the dedup memory (tests / explicit session reset). */
  reset(): void;
}

/** Pure, dedup'd view tracker over a logger. One `view_open` per distinct view per instance. */
export function createViewTracker(logger: Logger): ViewTracker {
  const seen = new Set<string>();
  return {
    track(view: string, dims?: Record<string, unknown>): void {
      if (!view || seen.has(view)) return;
      seen.add(view);
      logger.track('view_open', { view, ...(dims ?? {}) });
    },
    reset(): void {
      seen.clear();
    },
  };
}

// One tracker per logger, module-scoped, so the hook dedups across every component and mount
// for the whole session (not per-component-instance).
const trackers = new WeakMap<Logger, ViewTracker>();

/**
 * Thin React hook: reports `view` once per session when it mounts / changes. Pass the app's
 * shared logger. `dims` are read at fire time; the effect re-runs only on logger/view change.
 */
export function useViewTracking(logger: Logger, view: string, dims?: Record<string, unknown>): void {
  useEffect(() => {
    let tracker = trackers.get(logger);
    if (!tracker) {
      tracker = createViewTracker(logger);
      trackers.set(logger, tracker);
    }
    tracker.track(view, dims);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logger, view]);
}
