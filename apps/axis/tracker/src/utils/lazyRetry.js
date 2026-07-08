import logger from './logger';
import { recordReload } from './reloadDiag'; // ⚠️ TEMP diagnostic (#103) — להסיר אחרי איתור השורש

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

// תקרת reloadים אוטומטיים לכל session. ה-guards ה-per-module + ה-global נפרדים זה
// מזה, ולכן בלעדיהם כמה כשלי-chunk עלולים לשרשר 2-3 reloadים (הבאג שדווח, 2026-06-21).
// מונה אחד גלובלי חוסם את השרשור בלי תלות בכמה chunks נכשלים. נספר ב-sessionStorage,
// *לא* מתאפס על הצלחה — כך לכל היותר reload אוטומטי אחד לכל session; recovery נוסף
// (אם נדרש) עובר דרך מסך ה-chunk של ה-ErrorBoundary (רענון ידני).
const RELOAD_COUNT_KEY = `${RETRY_STORAGE_PREFIX}reload-count`;
export const MAX_AUTO_RELOADS = 1;

const autoReloadBudgetExhausted = () => {
    try {
        return Number(window.sessionStorage.getItem(RELOAD_COUNT_KEY) || '0') >= MAX_AUTO_RELOADS;
    } catch (storageError) {
        // sessionStorage לא זמין — לא חוסמים (שומר על נתיב ה-recovery הקיים)
        logger.warn('lazyRetry', 'Failed to read reload counter', { storageError });
        return false;
    }
};

const recordAutoReload = () => {
    try {
        const next = Number(window.sessionStorage.getItem(RELOAD_COUNT_KEY) || '0') + 1;
        window.sessionStorage.setItem(RELOAD_COUNT_KEY, String(next));
    } catch (storageError) {
        logger.warn('lazyRetry', 'Failed to persist reload counter', { storageError });
    }
};

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

            if (hasRetried(storageKey) || autoReloadBudgetExhausted()) {
                // warn ולא error: כשל chunk-load אינו באג והוא לא אמור להקפיץ טוסט.
                // ה-throw שאחרי זה נתפס ב-ErrorBoundary שמציג מסך רענון ייעודי (ההצגה היחידה).
                // נחסם גם כשתקרת ה-reload הגלובלית מוצתה — כדי לא לשרשר reloadים על-פני מודולים.
                logger.warn('lazyRetry', `Chunk failed to load after refresh: ${moduleName}`, { errorMessage: error?.message });
                throw error;
            }

            markRetryAttempt(storageKey);
            recordAutoReload();
            recordReload('lazyRetry', moduleName, error?.message); // ⚠️ TEMP diagnostic (#103)
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
    if (hasRetried(storageKey) || autoReloadBudgetExhausted()) {
        // warn ולא error: כשל preload/chunk גלובלי (למשל preload tags באופליין) לא אמור
        // להקפיץ ערימת טוסטים. כשהרכיב יידרש בפועל — React.lazy יזרוק וה-ErrorBoundary
        // יציג מסך רענון. כאן רק מתעדים. נחסם גם כשתקרת ה-reload הגלובלית מוצתה.
        logger.warn('lazyRetry', 'Global chunk error after refresh', { errorMessage: error?.message });
        return true;
    }

    markRetryAttempt(storageKey);
    recordAutoReload();
    recordReload('lazyRetry-global', 'global-chunk', error?.message); // ⚠️ TEMP diagnostic (#103)
    logger.warn('lazyRetry', 'Global chunk error, refreshing once', {
        errorMessage: error?.message
    });
    window.location.reload();
    return true;
};

/**
 * Prefetch ברקע של chunk — מחמם את ה-module registry של הדפדפן בלי לטרגר reload לעולם.
 *
 * שונה מ-lazyRetry במכוון: כשל בטעינה *מקדימה* הוא זמני ולא קריטי — המודול עדיין לא
 * נדרש. רענון אוטומטי על כשל-רקע כזה הוא בדיוק הבאג שדווח (2026-06-21): האפליקציה
 * עולה ואז מרעננת את עצמה (לפעמים 2-3 פעמים). לכן כאן בולעים את הכשל (debug) ולא
 * מרעננים. כשהמשתמש יפתח את המודל בפועל, React.lazy(lazyRetry(...)) יטען לפי-דרישה,
 * ורק כשל אמיתי שם יוצג דרך מסך ה-chunk של ה-ErrorBoundary (רענון ידני).
 *
 * @param {() => Promise<*>} importer - thunk גולמי של import() (לא עטוף ב-lazyRetry)
 * @param {string} [moduleName]
 * @returns {Promise<void>} promise שתמיד נפתר (לעולם לא דוחה) — בלי unhandled rejection
 */
export const prefetchLazy = (importer, moduleName = 'unknown-module') => {
    let pending;
    try {
        pending = importer();
    } catch (error) {
        // import() לא אמור לזרוק סינכרונית; הגנה ליתר ביטחון.
        logger.debug('lazyRetry', `Prefetch threw synchronously (ignored): ${moduleName}`, { errorMessage: error?.message });
        return Promise.resolve();
    }
    return Promise.resolve(pending)
        .then(() => {
            // הצלחה — מנקים guard ישן (אם נשאר מ-session קודם) כדי שטעינה-לפי-דרישה
            // עתידית של אותו מודול תתחיל נקייה.
            if (canUseBrowserApis()) {
                clearRetryAttempt(getStorageKey(moduleName));
            }
        })
        .catch((error) => {
            // אסור reload — זה רק prefetch. רושמים debug ומתעלמים בשקט.
            logger.debug('lazyRetry', `Prefetch failed (ignored, no reload): ${moduleName}`, { errorMessage: error?.message });
        });
};

export default lazyRetry;
