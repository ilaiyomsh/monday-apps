/**
 * Global Error Handler
 * תופס כל השגיאות שלא טופלו ורושם אותן ל-logger — ההצגה למשתמש נעשית
 * דרך ה-UI sink (useUiErrorSink) שמאזין לרשומות ERROR (ui-sink-plan.md, Phase 1).
 */

import { handleGlobalChunkError } from './lazyRetry';
import logger from './logger';

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
        const target = event.target;
        if (!target || target === window) return;
        const tag = target.tagName;
        if (tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'IMG') return;
        // pseudo-error לטובת ה-pattern matcher (resource errors אין להם message)
        const url = target.src || target.href || '';
        const pseudoError = new Error(`Failed to load module script: ${url}`);
        if (handleGlobalChunkError(pseudoError)) {
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

