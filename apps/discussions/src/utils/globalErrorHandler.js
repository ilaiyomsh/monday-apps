/**
 * Global Error Handler
 * תופס כל השגיאות שלא טופלו ורושם אותן ל-logger — ההצגה למשתמש נעשית
 * דרך ה-UI sink (useUiErrorSink) שמאזין לרשומות ERROR (ui-sink-plan.md, Phase 1).
 */

import { handleGlobalChunkError } from './lazyRetry';
import logger from './logger';

/**
 * החלטה על כישלון טעינת משאב (script/link/img), מופרדת לפונקציה טהורה לצורך בדיקות.
 *
 * chunk-load אמיתי → החזרת true (הקורא מפעיל preventDefault ורענון חד-פעמי כבר בוצע).
 * כל כישלון משאב אחר (IMG שבור / CSS / script שאינו chunk) חייב להירשם — WARN עם url+tag,
 * כדי שלא ייעלם בשקט — ואז החזרת false כך שברירת המחדל של הדפדפן ממשיכה.
 * (מקביל ל-@mapps/error-kit/browser globalErrorHandler ול-port של team-people-column.)
 *
 * @param {{target?: any}} event  אירוע ה-error מהמאזין ב-capture phase
 * @param {*} win  ה-window (מוזרק לבדיקות)
 * @returns {boolean} true אם זוהה chunk וטופל (הקורא יפעיל preventDefault)
 */
export const handleResourceError = (event, win) => {
    const w = win ?? (typeof window !== 'undefined' ? window : undefined);
    const target = event?.target;
    // שגיאת JS אמיתית מגיעה עם target === window; המאזין ב-bubble phase מטפל בה.
    if (!target || target === w) return false;
    const tag = target.tagName;
    if (tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'IMG') return false;
    const url = target.src || target.href || '';
    // אירועי שגיאת משאב חסרי message; ה-detector מזהה chunk לפי טקסט ה-message, לכן נבנה
    // pseudo-error עם message ניטרלי שלא "מתחזה" ל-chunk-load (אחרת IMG שבור היה מפעיל רענון).
    const pseudoError = new Error(`Failed to load resource: ${url}`);
    if (handleGlobalChunkError(pseudoError)) return true; // הקורא מפעיל preventDefault
    logger.warn('globalErrorHandler', 'Resource failed to load', { url, tag });
    return false;
};

/**
 * טיפול בשגיאה גלובלית
 */
export const handleGlobalError = (error, context = {}) => {
    // נקודת הרישום היחידה במסלול הגלובלי. logger.emit מטביע __loggedId על השגיאה
    // (חוזה log-once §3.1) ומפעיל את ה-UI sink שמציג את הטוסט.
    const functionName = context.functionName || 'GlobalErrorHandler';
    logger.error(functionName, 'Global error caught', error);
};

/**
 * טיפול ב-unhandled promise rejections
 */
export const setupGlobalErrorHandlers = () => {
    // טיפול בכישלון טעינה של משאבים (script/link tags) — לא bubbles, נדרש capture
    // שימושי לכישלון של ה-bundle הראשי או של preload tags כשה-CDN החזיר HTML
    window.addEventListener('error', (event) => {
        // chunk → preventDefault (handleResourceError already ran the one-shot reload);
        // כל כישלון משאב אחר נרשם בתוך handleResourceError ב-WARN (url+tag) ולא נבלע.
        if (handleResourceError(event, window)) {
            event.preventDefault();
        }
    }, true);

    // טיפול ב-unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason;

        // chunk-load failures (deploy חדש, רשת נופלת, MIME type) — refresh חד-פעמי
        if (handleGlobalChunkError(error)) {
            event.preventDefault();
            return;
        }

        // בדיקה אם זו שגיאת Monday API
        if (error && typeof error === 'object') {
            // אם יש response עם errors, זו שגיאת Monday API
            if (error.response && error.response.errors) {
                handleGlobalError(error, { 
                    functionName: 'UnhandledPromiseRejection',
                    source: 'unhandledrejection'
                });
                event.preventDefault(); // מונע הדפסה לקונסול
                return;
            }
            
            // אם יש message שמכיל "Graphql" או "monday", זו כנראה שגיאת Monday API
            if (error.message && (
                error.message.includes('Graphql') || 
                error.message.includes('graphql') ||
                error.message.includes('monday') ||
                error.message.includes('Monday')
            )) {
                handleGlobalError(error, { 
                    functionName: 'UnhandledPromiseRejection',
                    source: 'unhandledrejection'
                });
                event.preventDefault();
                return;
            }
        }
        
        // שגיאות אחרות - נרשום דרך logger (אבל לא נמנע את ההדפסה הרגילה של הדפדפן)
        logger.error('globalErrorHandler', 'Unhandled promise rejection', error);
    });

    // טיפול ב-uncaught errors
    window.addEventListener('error', (event) => {
        const error = event.error;

        // "ResizeObserver loop completed with undelivered notifications" — הדפדפן
        // פולט את זה כשקולבק של ResizeObserver גורם ל-reflow נוסף (מקור נפוץ:
        // ה-ResponsiveContainer של recharts). זו התראה שפירה, בלי אובייקט error
        // (event.error === null), ואסור שתציג טוסט למשתמש. מתעלמים בשקט.
        if (typeof event.message === 'string' && event.message.includes('ResizeObserver loop')) {
            event.preventDefault();
            return;
        }

        // chunk-load failures (deploy חדש, רשת נופלת, MIME type) — refresh חד-פעמי
        if (handleGlobalChunkError(error)) {
            event.preventDefault();
            return;
        }

        // בדיקה אם זו שגיאת Monday API
        if (error && typeof error === 'object') {
            // אם יש response עם errors, זו שגיאת Monday API
            if (error.response && error.response.errors) {
                handleGlobalError(error, { 
                    functionName: 'UncaughtError',
                    source: 'error'
                });
                event.preventDefault();
                return;
            }
            
            // אם יש message שמכיל "Graphql" או "monday", זו כנראה שגיאת Monday API
            if (error.message && (
                error.message.includes('Graphql') || 
                error.message.includes('graphql') ||
                error.message.includes('monday') ||
                error.message.includes('Monday')
            )) {
                handleGlobalError(error, { 
                    functionName: 'UncaughtError',
                    source: 'error'
                });
                event.preventDefault();
                return;
            }
        }
        
        // שגיאות אחרות - נרשום דרך logger (אבל לא נמנע את ההדפסה הרגילה של הדפדפן)
        logger.error('globalErrorHandler', 'Uncaught error', error);
    });
};

const globalErrorHandlerExports = {
    handleGlobalError,
    setupGlobalErrorHandlers
};
export default globalErrorHandlerExports;

