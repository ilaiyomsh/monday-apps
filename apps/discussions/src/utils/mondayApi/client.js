/**
 * תשתית ריצה ל-Monday API: ולידציית שאילתות, MondayApiError, retry, ועטיפת
 * ה-SDK היחידה — safeApi.
 *
 * @module mondayApi/client
 *
 * הקובץ מכיל אך ורק תשתית — לוגיקת השליפה/מוטציה בפועל חיה ב-BoardSDK.js
 * וב-monday-client.js, וכולה קוראת דרך safeApi (round135: תוקנה הפניה
 * מיושנת לקבצים items.js/boards.js/columns.js/mirror.js שאינם קיימים).
 */

import logger from '../logger';
import { extractOperationName } from '../errorHandler';

// v2 health telemetry (D5): coarse latency buckets so repeated api_latency signals
// dedup at the transport instead of shipping a distinct message per call — safeApi
// is a hot path, so we bucket (never per-call track) to keep it cheap and flood-safe.
const latencyBucket = (ms) => {
    if (ms < 200) return 'fast';
    if (ms < 1000) return 'ok';
    if (ms < 3000) return 'slow';
    return 'very_slow';
};

// ============================================
// ולידציית שאילתות GraphQL לפני שליחה
// ============================================

// רגקסים מוכנים מראש לזיהוי ערכים חשודים בשאילתות
const SUSPICIOUS_PATTERNS = [
    { regex: /ids:\s*\[\s*undefined\s*\]/gi, desc: 'ids: [undefined]' },
    { regex: /ids:\s*\[\s*null\s*\]/gi, desc: 'ids: [null]' },
    { regex: /ids:\s*\[\s*NaN\s*\]/gi, desc: 'ids: [NaN]' },
    { regex: /ids:\s*\[\s*\]/g, desc: 'ids: [] (empty)' },
    { regex: /"undefined"/g, desc: '"undefined" string value' },
    { regex: /"null"/g, desc: '"null" string value' },
    { regex: /"NaN"/g, desc: '"NaN" string value' },
    { regex: /column_id:\s*""/g, desc: 'empty column_id' },
    { regex: /board_id:\s*undefined/gi, desc: 'board_id: undefined' },
    { regex: /board_id:\s*null/gi, desc: 'board_id: null' },
    { regex: /board_id:\s*NaN/gi, desc: 'board_id: NaN' },
    { regex: /item_id:\s*undefined/gi, desc: 'item_id: undefined' },
    { regex: /item_id:\s*null/gi, desc: 'item_id: null' },
    { regex: /item_id:\s*NaN/gi, desc: 'item_id: NaN' },
];

/**
 * בדיקת שאילתת GraphQL לזיהוי ערכים חשודים
 * @param {string} query - שאילתת GraphQL
 * @returns {{ valid: boolean, warnings: string[] }}
 */
const validateQuery = (query) => {
    if (!query || typeof query !== 'string') {
        return { valid: false, warnings: ['Query is empty or not a string'] };
    }

    const warnings = [];
    for (const { regex, desc } of SUSPICIOUS_PATTERNS) {
        // Reset lastIndex for global regexes
        regex.lastIndex = 0;
        if (regex.test(query)) {
            warnings.push(`Suspicious value detected: ${desc}`);
        }
    }

    if (warnings.length > 0) {
        logger.error('QueryValidation', `Query has ${warnings.length} warning(s)`, {
            warnings,
            queryPreview: query.substring(0, 300)
        });
    }

    return { valid: warnings.length === 0, warnings };
};

/**
 * @typedef {Object} MondayItem
 * @property {string} id - מזהה האייטם
 * @property {string} name - שם האייטם
 * @property {Array} [column_values] - ערכי העמודות
 */

/**
 * @typedef {Object} Project
 * @property {string} id - מזהה הפרויקט
 * @property {string} name - שם הפרויקט
 */

/**
 * @typedef {Object} Task
 * @property {string} id - מזהה המשימה
 * @property {string} name - שם המשימה
 */

/**
 * @typedef {Object} StatusLabel
 * @property {string} id - מזהה הסטאטוס
 * @property {string} label - תווית הסטאטוס
 * @property {string} [color] - צבע הסטאטוס
 */

/**
 * MondayApiError - שגיאה מותאמת עם פרטי Monday API
 */
export class MondayApiError extends Error {
    constructor(message, { response = null, apiRequest = null, errorCode = null, functionName = null, duration = null } = {}) {
        super(message);
        this.name = 'MondayApiError';
        this.response = response;
        this.apiRequest = apiRequest;
        this.errorCode = errorCode;
        this.functionName = functionName;
        this.duration = duration;
        this.timestamp = Date.now();
        
        // שמירת stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, MondayApiError);
        }
    }
    
    /**
     * המרה לאובייקט JSON מלא
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            errorCode: this.errorCode,
            response: this.response,
            apiRequest: this.apiRequest,
            functionName: this.functionName,
            duration: this.duration,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

// --- Retry Logic ---
// קודים שגורמים ל-retry אוטומטי. חייבים להיות תת-קבוצה של canRetry:true ב-errorHandler.js ERROR_MESSAGES.
// ההשוואה היא case-insensitive — מספיק להכניס צורה אחת (lowercase).
const RETRYABLE_CODES_SET = new Set([
    'complexitybudgetexhausted',
    'complexity_budget_exhausted',
    'complexityexception',
    'request_max_complexity_exceeded',
    'internalservererror',
    'internal_server_error',
    'api_temporarily_blocked',
    'rate_limit_exceeded',
    'ip_rate_limit_exceeded',
    'field_limit_exceeded',
    'maxconcurrencyexceeded',
]);

const RETRYABLE_STATUS = [429, 500, 502, 503];
const MAX_RETRIES = 2;

// תבניות regex להודעות שגיאה שניתנות ל-retry (כשאין extensions.code)
const RETRYABLE_MESSAGE_PATTERNS = [
    /rate.*limit.*exceeded/i,
    /resource.*locked.*try again/i,
    /minute.*limit/i,
    // תקלות רשת/transport זמניות (HTTP2 protocol error, postMessage fails, וכו')
    /failed to fetch/i,
    /network.*error/i,
    /load failed/i,
];

const isRetryableCode = (code) => {
    if (!code) return false;
    return RETRYABLE_CODES_SET.has(code.toLowerCase().replace(/\s+/g, '_'));
};

const isRetryableMessage = (message) => {
    if (!message) return false;
    return RETRYABLE_MESSAGE_PATTERNS.some(rx => rx.test(message));
};

const _getErrorExtensions = (error) => {
    return error.data?.errors?.[0]?.extensions
        || error.response?.errors?.[0]?.extensions
        || null;
};

const isRetryableError = (error) => {
    const extensions = _getErrorExtensions(error);
    const code = error.errorCode || extensions?.code;
    const status = extensions?.status_code;
    const message = error.message
        || error.data?.errors?.[0]?.message
        || error.response?.errors?.[0]?.message;
    return isRetryableCode(code) || RETRYABLE_STATUS.includes(status) || isRetryableMessage(message);
};

const getRetryDelay = (error, attempt) => {
    const extensions = _getErrorExtensions(error);
    const retrySeconds = extensions?.retry_in_seconds;
    if (retrySeconds) return retrySeconds * 1000;
    return Math.pow(2, attempt) * 1000; // 2s, 4s
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * עוטף קריאה אסינכרונית בלולאת retry על שגיאות זמניות (429/500/rate-limit וכו').
 * המבצע נשאר אדיש לסוג ה-fn — מקבל פונקציה ומחזיר את התוצאה שלה, או זורק אחרי MAX_RETRIES.
 * @param {Function} fn - הפונקציה שתבוצע (יכולה לזרוק)
 * @param {Object} [options]
 * @param {Function} [options.onRetry] - קולבק שנקרא לפני השינה: ({ error, attempt, delay })
 * @returns {Promise<*>} - התוצאה של fn במקרה הצלחה
 */
const executeWithRetry = async (fn, { onRetry } = {}) => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt < MAX_RETRIES && isRetryableError(error)) {
                const delay = getRetryDelay(error, attempt + 1);
                onRetry?.({ error, attempt: attempt + 1, delay });
                await sleep(delay);
                continue;
            }
            throw error;
        }
    }
};

/**
 * Drop-in replacement ל-monday.api() עם ולידציה ולוגים מובנים
 * מחזירה את התשובה הגולמית (כמו monday.api), לא { response, duration }
 * לא זורקת על GraphQL soft errors — רק מלוגגת אותם
 *
 * @param {Object} monday - Monday SDK instance
 * @param {string} callerName - שם הפונקציה הקוראת (ללוגים)
 * @param {string} query - שאילתת GraphQL
 * @param {Object} [options] - אפשרויות נוספות
 * @param {Object} [options.variables] - משתנים לשאילתה
 * @param {boolean} [options.retry=true] - false for non-idempotent mutations
 * @returns {Promise<Object>} - התשובה הגולמית מה-API
 */
export const safeApi = async (monday, callerName, query, options = {}) => {
    // ולידציית שאילתה
    const { warnings: queryWarnings } = validateQuery(query);

    logger.api(callerName, query, options.variables || null);

    // נשמרים בקלוז'ר כדי שה-catch החיצוני יוכל לדווח על משך וגוף תשובה אחרון
    let lastStartTime = Date.now();
    let lastRawResponse = null;

    const oneAttempt = async () => {
        lastStartTime = Date.now();
        lastRawResponse = null;
        // Pass apiVersion PER CALL: monday.setApiVersion() does NOT reliably
        // apply to monday.api() inside the iframe, so version-specific fields
        // (e.g. photo_url { small }, 2026-07) fail validation without this.
        const apiOpts = {};
        if (options.variables) apiOpts.variables = options.variables;
        if (options.apiVersion) apiOpts.apiVersion = options.apiVersion;
        const rawResponse = Object.keys(apiOpts).length
            ? await monday.api(query, apiOpts)
            : await monday.api(query);
        lastRawResponse = rawResponse;
        const duration = Date.now() - lastStartTime;
        logger.apiResponse(callerName, rawResponse, duration);
        // API-latency health (D5): bucketed so it dedups at the transport; ships as
        // domainKind='health' (inert until the Axiom sink is active).
        logger.health('api_latency', { bucket: latencyBucket(duration), ok: true });

        // לוג GraphQL errors ברמת ERROR — אבל לא זורק (אין retry על soft errors).
        // נרשם כ-apiError עם rawResponse ב-context כדי שה-UI sink יחלץ הודעה ספציפית
        // (parseMondayError קורא את errors[] מתוך ה-response, לא מתוך ה-error עצמו).
        if (rawResponse?.errors?.length > 0) {
            const softError = new Error(rawResponse.errors[0]?.message || `${callerName} - GraphQL errors in response`);
            logger.apiError(callerName, softError, {
                query,
                variables: options.variables || null,
                rawResponse,
                queryWarnings
            });
            // קישור הרשומה לתשובה: assertNoGraphQLErrors יזרוק MondayApiError חדש
            // מאותה תשובה — ההטבעה כאן מאפשרת לו לרשת את ה-__loggedId, כך שרישום
            // ה-throw אצל הקורא יסומן duplicate (רשומה אחת + טוסט אחד לכשל).
            if (softError.correlationId !== undefined) {
                try {
                    Object.defineProperty(rawResponse, '__softErrorLoggedId', {
                        value: softError.correlationId,
                        enumerable: false,
                        configurable: true
                    });
                } catch (tagErr) {
                    // כשל defineProperty על תשובה קפואה רק מוותר על dedup
                    // downstream — ה-soft-error כבר נרשם למעלה; מתעדים ברמת
                    // warn כדי לא לאבד את העקבה (round135, error-guard).
                    logger.warn('API', `${callerName} - סימון __softErrorLoggedId נכשל (תשובה קפואה); dedup downstream יוותר`, tagErr);
                }
            }
        }
        return rawResponse;
    };

    try {
        if (options.retry === false) return await oneAttempt();
        return await executeWithRetry(oneAttempt, {
            onRetry: ({ error, attempt, delay }) => {
                const retryCode = error.errorCode || _getErrorExtensions(error)?.code;
                logger.warn('API', `${callerName} - Retryable error, attempt ${attempt}/${MAX_RETRIES}, waiting ${delay}ms`, {
                    errorCode: retryCode,
                    attempt
                });
            }
        });
    } catch (error) {
        const duration = Date.now() - lastStartTime;
        // API-latency health (D5): bucketed failure signal (ok:false), dedup-safe.
        logger.health('api_latency', { bucket: latencyBucket(duration), ok: false });
        logger.apiError(callerName, error, {
            query,
            variables: options.variables || null,
            rawResponse: lastRawResponse,
            duration,
            queryWarnings
        });
        // עטיפה ב-MondayApiError כדי לשמור את הקשר הקריאה (query, response) להצגה ב-ErrorDetailsModal
        if (error instanceof MondayApiError) throw error;
        const wrapped = new MondayApiError(error.message || 'Unknown error', {
            response: error.response || error.data || lastRawResponse,
            apiRequest: { query, variables: options.variables || null, operationName: extractOperationName(query) },
            errorCode: error.errorCode || error.data?.errors?.[0]?.extensions?.code,
            functionName: callerName,
            duration
        });
        // העטיפה יורשת את מזהה הרישום של השגיאה המקורית (שכבר נרשמה למעלה) —
        // כך כל רישום במעלה הזרם של ה-wrapped מסומן duplicate (רשומה אחת + טוסט אחד לכשל)
        if (error?.correlationId !== undefined) {
            try {
                Object.defineProperty(wrapped, '__loggedId', {
                    value: error.correlationId, enumerable: false, configurable: true, writable: true
                });
                Object.defineProperty(wrapped, 'correlationId', {
                    value: error.correlationId, enumerable: false, configurable: true, writable: true
                });
            } catch (tagErr) {
                // כשל defineProperty רק מוותר על dedup downstream — השגיאה
                // המקורית כבר נרשמה למעלה וה-wrapped נזרק ממילא; מתעדים ברמת
                // warn כדי לא לאבד את העקבה (round135, error-guard).
                logger.warn('API', `${callerName} - הורשת correlationId ל-wrapped נכשלה; dedup downstream יוותר`, tagErr);
            }
        }
        throw wrapped;
    }
};

// @visibleForTesting
export const _testHelpers = { isRetryableCode, isRetryableError, isRetryableMessage, getRetryDelay, _getErrorExtensions, executeWithRetry };

