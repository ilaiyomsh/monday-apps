import { useState, useCallback, useRef } from 'react';
import { MondayApiError } from '../utils/mondayApi';
import logger from '../utils/logger';

const DEDUP_WINDOW_MS = 2000;

/**
 * Hook לניהול Toast notifications
 */
export const useToast = () => {
    const [toasts, setToasts] = useState([]);
    const [errorDetailsModal, setErrorDetailsModal] = useState(null);
    const recentErrorsRef = useRef(new Map());

    const showToast = useCallback((message, type = 'info', duration = 1500, errorDetails = null, onRetry = null, action = null) => {
        // מניעת כפילויות ב-toast שגיאה באותו חלון זמן
        if (type === 'error') {
            const fingerprint = message + (errorDetails?.errorCode || '');
            const now = Date.now();
            const lastShown = recentErrorsRef.current.get(fingerprint);
            if (lastShown && (now - lastShown) < DEDUP_WINDOW_MS) {
                return null;
            }
            recentErrorsRef.current.set(fingerprint, now);
            // ניקוי ערכים ישנים
            if (recentErrorsRef.current.size > 20) {
                for (const [key, time] of recentErrorsRef.current) {
                    if (now - time > DEDUP_WINDOW_MS) recentErrorsRef.current.delete(key);
                }
            }
        }

        const id = Date.now() + Math.random();
        // `action` (optional) renders a single labeled button — e.g. an "undo"
        // for deferred deletes / carry-forward. Shape: { label, onClick }.
        const newToast = { id, message, type, duration, errorDetails, onRetry, action };

        setToasts(prev => [...prev, newToast]);

        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const showSuccess = useCallback((message, duration = 1500) => {
        return showToast(message, 'success', duration);
    }, [showToast]);

    const showError = useCallback((message, duration) => {
        return showToast(message, 'error', duration);
    }, [showToast]);

    const showWarning = useCallback((message, duration) => {
        return showToast(message, 'warning', duration);
    }, [showToast]);

    const showInfo = useCallback((message, duration) => {
        return showToast(message, 'info', duration);
    }, [showToast]);

    // Persistent "loading" toast (spinner + message) that does NOT auto-hide
    // (duration 0). Returns the toast id so the caller removes it via removeToast
    // when the async op resolves — typically followed by showSuccess. Used for the
    // loader-toast → success pattern (task creation off the Tasks tab, carry-forward).
    const showLoading = useCallback((message) => {
        return showToast(message, 'loading', 0);
    }, [showToast]);

    /**
     * facade לוג-בלבד (Phase 1 של ui-sink-plan.md): רושם את השגיאה ל-logger —
     * וההצגה למשתמש נעשית אך ורק דרך ה-UI sink (useUiErrorSink) שמאזין לרשומות ERROR.
     *
     * החתימה נשמרה לתאימות עם הקוראים הקיימים; options.duration/options.onRetry
     * אינם בשימוש עוד (משך התצוגה נקבע ב-sink; retry ממומש ברמת ה-ErrorBoundary).
     *
     * @param {Error|MondayApiError|Object} error - שגיאה או response עם errors
     * @param {Object} options - אפשרויות נוספות
     * @param {Object} options.apiRequest - פרטי השאילתה (אם לא קיים ב-error)
     * @param {string} options.functionName - שם הפונקציה שביצעה את הקריאה
     * @returns {null} אין מזהה טוסט — ההצגה דרך ה-sink
     */
    const showErrorWithDetails = useCallback((error, options = {}) => {
        // רישום מרכזי דרך logger — אך ורק אם השגיאה לא נרשמה כבר
        // (safeApi / catch / globalErrorHandler מטביעים __loggedId בנקודת הרישום המוקדמת;
        // ראה חוזה ה-log-once §3.1). כך אנו נמנעים מהכפלת שגיאות שכבר נרשמו.
        // שגיאות "עירומות" (render/validation) שעוד לא נרשמו — נרשמות כאן פעם אחת,
        // וה-UI sink (שמאזין ל-emit) מציג את הטוסט. שגיאה שכבר נרשמה במעלה הזרם
        // כבר הוצגה דרך ה-sink ברגע הרישום המקורי.
        if (!error || error.__loggedId === undefined) {
            const fnName = options.functionName ||
                (error instanceof MondayApiError ? error.functionName : null) ||
                'showErrorWithDetails';
            if (error instanceof MondayApiError) {
                logger.apiError(fnName, error, {
                    query: error.apiRequest?.query,
                    rawResponse: error.response,
                });
            } else {
                logger.error(fnName, error?.message || 'Unhandled error', error);
            }
        }

        return null;
    }, []);

    const openErrorDetailsModal = useCallback((errorDetails) => {
        setErrorDetailsModal(errorDetails);
    }, []);

    const closeErrorDetailsModal = useCallback(() => {
        setErrorDetailsModal(null);
    }, []);

    return {
        toasts,
        errorDetailsModal,
        showToast,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        showLoading,
        showErrorWithDetails,
        removeToast,
        openErrorDetailsModal,
        closeErrorDetailsModal
    };
};

