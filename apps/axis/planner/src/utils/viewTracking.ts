/**
 * viewTracking.ts — automatic view/tab usage tracking (decision D3). A view is reported at
 * most ONCE per session as a `view_open` usage event (domainKind='usage'), so navigating back
 * and forth doesn't re-ship. Ships through logger.track() — inert until the Axiom sink is active.
 * TS port of @axis/app-core usage/viewTracking.ts, ref-based dims (no eslint-disable needed).
 */
import { useEffect, useRef } from 'react';

/** Minimal structural view of the logger this module needs (Logger.ts satisfies it). */
export interface TrackLogger {
  track(event: string, dims?: Record<string, unknown> | null): void;
}

export interface ViewTracker {
  /** Report a view the first time it's seen this session; dims fold into the message (D4). */
  track(view: string, dims?: Record<string, unknown>): void;
  /** Clear the dedup memory (tests / explicit session reset). */
  reset(): void;
}

/** Pure, dedup'd view tracker over a logger. One `view_open` per distinct view per instance. */
export function createViewTracker(logger: TrackLogger): ViewTracker {
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
// for the whole session (not per-component-instance) — React 19 StrictMode double-mount safe.
const trackers = new WeakMap<TrackLogger, ViewTracker>();

/**
 * Thin React hook: reports `view` once per session when it mounts / changes. Pass the app's
 * shared logger. `dims` are read at fire time via a ref, so the effect depends only on
 * [logger, view] (stable) — no exhaustive-deps disable needed.
 */
export function useViewTracking(
  logger: TrackLogger,
  view: string,
  dims?: Record<string, unknown>
): void {
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
