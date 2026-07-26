/*
 * useUsageTracker — mounts ONCE at the app root (App.jsx) and feeds the usage
 * store (utils/usageMetrics.js) for the owner-only "מדדי שימוש" tab.
 *
 * Deliberately minimal so it can't hurt runtime perf:
 *   - records today's entry once (the store guards it to once-per-user-per-day);
 *   - ONE capture-phase click listener on document counts button/[role=button]
 *     clicks into an in-memory counter (no per-button wiring, no React state, no
 *     re-render);
 *   - the counter is flushed to storage on a throttle (every ~10s) and when the
 *     tab is hidden / on unmount — never on the click itself.
 */
import { useEffect } from 'react';
import { recordEntry, noteAction, flushActions } from '../utils/usageMetrics.js';

const FLUSH_MS = 10000;

export function useUsageTracker(userId) {
  useEffect(() => {
    if (!userId) return undefined;

    // record today's entry (store no-ops if already recorded for this UTC day)
    recordEntry(userId);

    const onClick = (e) => {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('button, [role="button"]')) {
        noteAction();
      }
    };
    document.addEventListener('click', onClick, true);

    const interval = setInterval(() => { flushActions(userId); }, FLUSH_MS);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushActions(userId);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
      flushActions(userId);
    };
  }, [userId]);
}

export default useUsageTracker;
