/**
 * useToast — the toast QUEUE. Mount once near the root.
 *
 * Division of labour (do not blur it):
 *   - This hook owns the queue and the imperative show* helpers for DELIBERATE
 *     user feedback ("הדוח הופק", "מפיק דוח…").
 *   - ERRORS are never pushed here directly by feature code. They go
 *     logger.error(...) → useUiErrorSink → showToast. One logged error = one
 *     toast, deduped by the logger's log-once. `showErrorWithDetails` below is
 *     the LOG-ONLY facade for that path.
 *
 * Ported from apps/discussions/src/hooks/useToast.js, minus the undo/retry
 * affordances this app has no use for.
 */
import { useState, useCallback, useRef } from 'react';
import logger from '../utils/logger';

const DEDUP_WINDOW_MS = 2000;
const DEDUP_MAP_MAX = 20;

export const useToast = () => {
  const [toasts, setToasts] = useState([]);
  const [errorDetailsModal, setErrorDetailsModal] = useState(null);
  const recentErrorsRef = useRef(new Map());
  // Monotonic id source — Date.now() collides when two toasts fire in the same
  // millisecond (which the sink's buffer replay does).
  const nextIdRef = useRef(0);

  const showToast = useCallback(
    (message, type = 'info', duration = 3000, errorDetails = null) => {
      // Suppress a repeat of the SAME error message inside a short window, so a
      // burst (e.g. one failure surfacing through two layers) shows once.
      if (type === 'error') {
        const fingerprint = `${message}|${errorDetails?.correlationId ?? ''}`;
        const now = Date.now();
        const lastShown = recentErrorsRef.current.get(fingerprint);
        if (lastShown && now - lastShown < DEDUP_WINDOW_MS) return null;
        recentErrorsRef.current.set(fingerprint, now);
        if (recentErrorsRef.current.size > DEDUP_MAP_MAX) {
          for (const [key, time] of recentErrorsRef.current) {
            if (now - time > DEDUP_WINDOW_MS) recentErrorsRef.current.delete(key);
          }
        }
      }

      const id = `t${++nextIdRef.current}`;
      setToasts((prev) => [...prev, { id, message, type, duration, errorDetails }]);
      return id;
    },
    []
  );

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showSuccess = useCallback(
    (message, duration = 3000) => showToast(message, 'success', duration),
    [showToast]
  );

  const showInfo = useCallback(
    (message, duration = 3000) => showToast(message, 'info', duration),
    [showToast]
  );

  /**
   * A persistent "working…" toast (duration 0 → no auto-hide, not closeable).
   * Returns the id; the caller MUST removeToast(id) when the operation settles.
   */
  const showLoading = useCallback((message) => showToast(message, 'loading', 0), [showToast]);

  /**
   * LOG-ONLY facade. Records the error through the single funnel; the DISPLAY
   * happens in useUiErrorSink, which listens for ERROR records. Skips the log
   * when the error was already logged upstream (`__loggedId` is stamped by the
   * logger at the first emit), so one failure stays one toast.
   *
   * Named `showErrorWithDetails` because the error-guard eslint rule recognises
   * it as a sanctioned catch handler alongside logger.* and throw.
   */
  const showErrorWithDetails = useCallback((error, options = {}) => {
    if (!error || error.__loggedId === undefined) {
      const fnName = options.functionName || 'showErrorWithDetails';
      logger.error(fnName, error?.message || 'unhandled_error', error);
    }
    return null;
  }, []);

  const openErrorDetailsModal = useCallback((details) => setErrorDetailsModal(details), []);
  const closeErrorDetailsModal = useCallback(() => setErrorDetailsModal(null), []);

  return {
    toasts,
    errorDetailsModal,
    showToast,
    showSuccess,
    showInfo,
    showLoading,
    showErrorWithDetails,
    removeToast,
    openErrorDetailsModal,
    closeErrorDetailsModal,
  };
};

export default useToast;
