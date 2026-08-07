import logger from './logger';

const RETRY_STORAGE_PREFIX = 'lazy-retry:';
const CHUNK_LOAD_ERROR_PATTERNS = [
    /ChunkLoadError/i,
    /Failed to fetch dynamically imported module/i,
    /Importing a module script failed/i,
    /error loading dynamically imported module/i,
    // CDN החזיר index.html במקום הצ'אנק (deploy חדש + index.html ב-cache)
    /is not a valid JavaScript MIME type/i,
    /expected a JavaScript-or-Wasm module script/i,
    /Failed to load module script/i,                    // Chrome variant
    /NetworkError when attempting to fetch resource/i,  // Firefox
    /Failed to fetch/i,                                 // Chrome network failure
    /Load failed/i,                                     // iOS Safari
    /The network connection was lost/i,                 // iOS — connection drop
    /Unable to preload CSS/i,                           // Vite CSS preloader
    /dynamically imported module.*?(timeout|aborted)/i  // timeout/abort on dynamic import
];

const canUseBrowserApis = () => typeof window !== 'undefined' && !!window.sessionStorage;

export const isChunkLoadError = (error) => {
    const errorMessage = error?.message || String(error || '');
    return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
};

const getStorageKey = (moduleName) => `${RETRY_STORAGE_PREFIX}${moduleName}`;

const markRetryAttempt = (storageKey) => {
    try {
        window.sessionStorage.setItem(storageKey, '1');
    } catch (storageError) {
        logger.warn('lazyRetry', 'Failed to persist retry marker', { storageKey, storageError });
    }
};

const clearRetryAttempt = (storageKey) => {
    try {
        window.sessionStorage.removeItem(storageKey);
    } catch (storageError) {
        logger.warn('lazyRetry', 'Failed to clear retry marker', { storageKey, storageError });
    }
};

const hasRetried = (storageKey) => {
    try {
        return window.sessionStorage.getItem(storageKey) === '1';
    } catch (storageError) {
        logger.warn('lazyRetry', 'Failed to read retry marker', { storageKey, storageError });
        return false;
    }
};

/** @public error/observability boot layer — platform/convention-reached, guard-protected; knip must not report it. */
export const lazyRetry = (importer, moduleName = 'unknown-module') => () => {
    const storageKey = getStorageKey(moduleName);

    return importer()
        .then((module) => {
            if (canUseBrowserApis()) {
                clearRetryAttempt(storageKey);
            }
            return module;
        })
        .catch((error) => {
            if (!canUseBrowserApis() || !isChunkLoadError(error)) {
                throw error;
            }

            if (hasRetried(storageKey)) {
                // warn ולא error: כשל chunk-load אינו באג והוא לא אמור להקפיץ טוסט.
                // ה-throw שאחרי זה נתפס ב-ErrorBoundary שמציג מסך רענון ייעודי (ההצגה היחידה).
                logger.warn('lazyRetry', `Chunk failed to load after refresh: ${moduleName}`, { errorMessage: error?.message });
                throw error;
            }

            markRetryAttempt(storageKey);
            logger.warn('lazyRetry', 'Chunk load failed, refreshing once', {
                moduleName,
                errorMessage: error?.message
            });
            window.location.reload();

            return new Promise(() => {});
        });
};

/**
 * נסיון רענון יחיד עבור שגיאות chunk-load שלא קרו בתוך React.lazy —
 * למשל: כישלון של ה-bundle הראשי, preload של CSS, או dynamic import חיצוני.
 * משתמש באותו sessionStorage flag כדי למנוע reload-loop.
 *
 * @param {Error|*} error
 * @returns {boolean} true אם זוהתה שגיאת chunk וטופל reload (או נחסם בגלל retry קודם)
 */
export const handleGlobalChunkError = (error) => {
    if (!canUseBrowserApis() || !isChunkLoadError(error)) return false;

    const storageKey = getStorageKey('global');
    if (hasRetried(storageKey)) {
        // warn ולא error: כשל preload/chunk גלובלי (למשל preload tags באופליין) לא אמור
        // להקפיץ ערימת טוסטים. כשהרכיב יידרש בפועל — React.lazy יזרוק וה-ErrorBoundary
        // יציג מסך רענון. כאן רק מתעדים.
        logger.warn('lazyRetry', 'Global chunk error after refresh', { errorMessage: error?.message });
        return true;
    }

    markRetryAttempt(storageKey);
    logger.warn('lazyRetry', 'Global chunk error, refreshing once', {
        errorMessage: error?.message
    });
    window.location.reload();
    return true;
};

export default lazyRetry;
