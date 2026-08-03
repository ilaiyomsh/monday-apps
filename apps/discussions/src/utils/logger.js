/**
 * מערכת לוגים עם מצב debug ונקודת איגוד אחת (emit) ל-sinks
 * מאפשרת שליטה ברמת הלוגים, הדפסת מידע מפורט לקריאות API, וניתוב כל רשומה
 * דרך נקודת איגוד אחת (emit) אל console-sink וכל sink נוסף שנרשם.
 *
 * @overview
 * מערכת הלוגים מספקת שליטה מלאה על רמת הלוגים המוצגים בקונסול.
 * בפרודקשן מוצגות רק שגיאות קריטיות (ERROR), בעוד שבסביבת פיתוח מוצגים כל הלוגים (DEBUG).
 *
 * כל המתודות הציבוריות עוברות דרך emit(record) — נקודת איגוד אחת. emit מבצע:
 *   1. log-once: דילול כפילויות לפי error.__loggedId (אותו instance של Error נרשם פעם אחת לסינק).
 *   2. console rendering (כפוף ל-gate של רמת הלוג, כמו קודם).
 *   3. ring buffer: שמירת אחרונות (cap קבוע) ל-replay/flush.
 *   4. fan-out ל-sinks רשומים (addSink) — כל dispatch ב-try/catch משלו.
 *
 * @usage
 * ```javascript
 * import logger from './utils/logger';
 *
 * // לוגים רגילים
 * logger.debug('ModuleName', 'Debug message', optionalData);
 * logger.info('ModuleName', 'Info message', optionalData);
 * logger.warn('ModuleName', 'Warning message', optionalData);
 * logger.error('ModuleName', 'Error message', errorObject);
 *
 * // לוגים מיוחדים ל-API
 * logger.api('functionName', query, variables);
 * logger.apiResponse('functionName', response, duration);
 * logger.apiError('functionName', error);
 *
 * // לוגים לפונקציות
 * logger.functionStart('functionName', params);
 * logger.functionEnd('functionName', result);
 *
 * // רישום sink נוסף (למשל ניטור מרוחק עתידי)
 * const unsub = logger.addSink((record) => { ... });
 * logger.removeSink(fn);
 * logger.flush(); // שליחת ה-buffer ב-visibilitychange/beforeunload
 * ```
 *
 * @production
 * בפרודקשן (import.meta.env.PROD === true):
 * - מוצגות רק שגיאות קריטיות (ERROR) בקונסול
 * - כל הלוגים האחרים (DEBUG, INFO, WARN) מושתקים בקונסול
 * - apiError תמיד מוצג בקונסול (שגיאות API הן קריטיות)
 * - WARN/ERROR/apiError נשלחים ל-sinks הרשומים גם כשהקונסול מושתק
 *
 * @development
 * בסביבת פיתוח (import.meta.env.PROD !== true):
 * - מוצגים כל הלוגים (DEBUG, INFO, WARN, ERROR)
 * - כולל מידע מפורט על קריאות API
 * - כולל לוגים של תחילת וסיום פונקציות
 *
 * @note
 * - אין להשתמש ב-console.log/error/warn ישירות בקוד אפליקציה
 * - כל הלוגים צריכים לעבור דרך logger
 * - לוגים שצריך להשאיר בקוד (לצורך דיבוג עתידי) יש להעיר עם הערה
 */

// נקודת ייחוס לתזמון Init Flow — נקבעת פעם אחת עם טעינת הבאנדל
if (typeof window !== 'undefined' && !window.__appInitStart) {
    window.__appInitStart = performance.now();
}

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// רמת לוג נוכחית - ניתן לשנות ב-runtime
// בפרודקשן: רק שגיאות קריטיות (ERROR)
// בפיתוח: כל הלוגים (DEBUG)
// שימוש ב-import.meta.env.PROD עבור Vite (במקום process.env.NODE_ENV)
// עם fallback ל-process.env.NODE_ENV למקרה ש-Vite לא מוגדר
const isProduction = (typeof import.meta !== 'undefined' && import.meta.env?.PROD === true) ||
                     (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production');
let currentLevel = isProduction
  ? LOG_LEVELS.ERROR
  : LOG_LEVELS.DEBUG;

// צבעים לקונסול
const COLORS = {
  DEBUG: '#6c757d',
  INFO: '#0d6efd',
  WARN: '#ffc107',
  ERROR: '#dc3545',
  RESET: '#000000'
};

// ============================================
// תשתית sink: registry, ring buffer, ו-log-once
// ============================================

// גודל ה-ring buffer — שומר את הרשומות האחרונות ל-replay/flush
const RING_BUFFER_SIZE = 150;

// ה-sinks הרשומים (console תמיד מטופל ישירות ב-emit; אלה הם sinks נוספים)
const sinks = new Set();

// ה-ring buffer (FIFO, cap = RING_BUFFER_SIZE)
const ringBuffer = [];

// מונה log-once — מזהה ייחוד לכל instance של Error שעבר דרך emit
let loggedIdCounter = 0;

/**
 * הוספת רשומה ל-ring buffer עם cap קבוע (FIFO)
 */
const pushToBuffer = (record) => {
  ringBuffer.push(record);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
};

/**
 * שליחת רשומה לכל ה-sinks הרשומים. כל sink נעטף ב-try/catch משלו
 * כדי ש-sink כושל לא יזרוק חזרה ולא ייכנס לרקורסיה (אסור לקרוא ל-emit מתוך sink-catch).
 */
const dispatchToSinks = (record) => {
  if (sinks.size === 0) return;
  for (const sink of sinks) {
    try {
      sink(record);
    } catch (sinkError) {
      // sink כושל לא יזרוק חזרה ולא ירשם דרך logger (מניעת רקורסיה).
      // נשתמש ב-console.error הגולמי כדי לא לאבד את הכשל לחלוטין.
       
      console.error('[logger] sink threw and was suppressed:', sinkError);
    }
  }
};

// ============================================
// console rendering — כל הפלט לקונסול מרוכז כאן (נקרא מתוך emit בלבד)
// ============================================

/**
 * פורמט הודעת לוג (מחרוזת he-IL לרינדור קונסול בלבד)
 */
const formatMessage = (module, level, message) => {
  const timestamp = new Date().toLocaleTimeString('he-IL');
  const levelUpper = level.toUpperCase();
  return `[${timestamp}] [${levelUpper}] [${module}] ${message}`;
};

/**
 * הדפסת לוג עם צבע (קונסול בלבד)
 */
const logWithColor = (level, message, data = null) => {
  const color = COLORS[level.toUpperCase()] || COLORS.RESET;
  const formattedMessage = message;

  if (data !== null && data !== undefined) {
    console.log(`%c${formattedMessage}`, `color: ${color}; font-weight: bold`, data);
  } else {
    console.log(`%c${formattedMessage}`, `color: ${color}; font-weight: bold`);
  }
};

/**
 * רינדור רשומה לקונסול לפי הסוג (kind) שלה.
 * מרכז את כל הפורמט (formatMessage/logWithColor/console.group) שהיה מפוזר במתודות.
 * כפוף ל-record.consoleEnabled — אם false, אין פלט קונסול (ה-sink עדיין מקבל).
 */
const renderToConsole = (record) => {
  if (!record.consoleEnabled) return;

  const { kind, level, module, message, data, error, context } = record;

  switch (kind) {
    case 'simple': {
      // debug / info / warn — לוג צבעוני פשוט
      const formatted = formatMessage(module, level, message);
      logWithColor(level, formatted, data);
      break;
    }

    case 'error': {
      const formatted = formatMessage(module, level, message);
      // logger.error/warn מנתב ערך שאינו Error ל-record.data (לא ל-error). אם error הוא
      // undefined — נופלים חזרה ל-data כדי שה-payload (אובייקט/מחרוזת) יודפס לקונסול,
      // ביישור עם המקרה ה-'simple' שכבר קורא data.
      logWithColor(level, formatted, error !== undefined ? error : data);
      // הדפסת stack trace אם קיים (מנותב דרך emit במקום console.error ישיר)
      if (error && error.stack) {
        console.error('Stack trace:', error.stack);
      }
      break;
    }

    case 'api': {
      const formatted = formatMessage('API', 'DEBUG', `📤 ${message} - Sending request`);
      console.group(`%c${formatted}`, `color: ${COLORS.DEBUG}; font-weight: bold`);
      console.log('Query:', context?.query);
      if (context?.variables) {
        console.log('Variables:', context.variables);
      }
      console.groupEnd();
      break;
    }

    case 'apiResponse': {
      const formatted = formatMessage('API', 'DEBUG', `📥 ${message} - Response received`);
      console.group(`%c${formatted}`, `color: ${COLORS.INFO}; font-weight: bold`);
      console.log('Response:', context?.response);
      if (context?.duration !== null && context?.duration !== undefined) {
        console.log(`⏱️ Duration: ${context.duration}ms`);
      }
      console.groupEnd();
      break;
    }

    case 'apiError': {
      const formatted = formatMessage('API', 'ERROR', `❌ ${message} - Request failed`);
      console.group(`%c${formatted}`, `color: ${COLORS.ERROR}; font-weight: bold`);
      console.error('Error:', error);
      if (error?.message) {
        console.error('Error message:', error.message);
      }
      if (error?.data) {
        console.error('Error data (from SDK):', error.data);
      }
      if (context?.query) {
        console.error('Query sent:', context.query);
      }
      if (context?.rawResponse) {
        console.error('Raw response:', context.rawResponse);
      }
      if (context?.queryWarnings?.length > 0) {
        console.error('Query warnings:', context.queryWarnings);
      }
      if (error?.stack) {
        console.error('Stack trace:', error.stack);
      }
      console.groupEnd();
      break;
    }

    case 'init': {
      // initDone — תמיד מוצג בקונסול (consoleEnabled תמיד true עבור kind זה)
      const elapsed = typeof window !== 'undefined' && window.__appInitStart
        ? `+${Math.round(performance.now() - window.__appInitStart)}ms`
        : '';
      const formatted = `[${context?.timeLabel}] [INIT ${context?.step}/9] ✓ ${message} ${elapsed}`;
      if (data !== null && data !== undefined) {
        console.log(`%c${formatted}`, 'color: #4ade80; font-weight: bold', data);
      } else {
        console.log(`%c${formatted}`, 'color: #4ade80; font-weight: bold');
      }
      break;
    }

    case 'initSummary': {
      console.log(
        `%c[INIT] ========== App fully interactive in ${context?.totalMs}ms ==========`,
        'color: #fbbf24; font-weight: bold; font-size: 13px'
      );
      break;
    }

    default:
      break;
  }
};

// ============================================
// emit — נקודת האיגוד היחידה
// ============================================

/**
 * נקודת האיגוד היחידה. כל מתודה ציבורית בונה record ומעבירה לכאן.
 * אחראית על: log-once dedup, console rendering, ring buffer, ו-fan-out ל-sinks.
 *
 * @param {Object} record - רשומה מובנית
 * @param {string} record.kind - סוג הרינדור: simple|error|api|apiResponse|apiError|init|initSummary
 * @param {string} record.level - DEBUG|INFO|WARN|ERROR
 * @param {string} record.module - שם המודול/הפונקציה
 * @param {string} record.message - הודעה
 * @param {*} [record.data] - מידע נוסף (לרינדור)
 * @param {Error} [record.error] - אובייקט שגיאה (אם קיים)
 * @param {Object} [record.context] - הקשר דיאגנוסטי (query/rawResponse/queryWarnings/…)
 * @param {boolean} record.consoleEnabled - האם להציג בקונסול (כפוף ל-gate של הרמה)
 */
const emit = (record) => {
  // נורמליזציית timestamp — epoch + ISO; he-IL נשמר רק לרינדור קונסול (בתוך formatMessage)
  const ts = Date.now();
  record.timestamp = ts;
  record.timestampISO = new Date(ts).toISOString();

  // --- log-once: דילול כפילויות לפי יעד-dedup ---
  // היעד הוא record.error (Error instance) או record.data כשהוא אובייקט לא-null.
  // כך גם שגיאות plain-object (למשל שגיאת Monday דרך globalErrorHandler →
  // logger.error(fn,'...',plainObj), שנשמרת ב-record.data) מסומנות ב-__loggedId
  // ולא נרשמות פעמיים. context bags (record.context) אינם משתתפים ב-dedup, ובלאו הכי
  // הם אובייקט טרי בכל קריאה (כמו client.js:256 {query,rawResponse}) — לכן נרשמים בכל פעם.
  const err = record.error !== undefined
    ? record.error
    : (record.data && typeof record.data === 'object' ? record.data : undefined);
  if (err && typeof err === 'object') {
    if (err.__loggedId !== undefined) {
      // מעבר חוזר של אותו instance — רשומה כפולה
      record.duplicate = true;
      record.correlationId = record.correlationId || err.correlationId || err.__loggedId;
    } else {
      // מעבר ראשון — מטביעים מזהה (לא enumerable כדי לא לזהם serialization/JSON)
      const id = err.correlationId || `log_${++loggedIdCounter}`;
      try {
        Object.defineProperty(err, '__loggedId', {
          value: id,
          enumerable: false,
          configurable: true,
          writable: true
        });
      } catch {
        // אם האובייקט קפוא/לא ניתן להגדרה — לא חוסם את הרישום (הרשומה עדיין נשלחת)
      }
      record.duplicate = false;
      record.correlationId = id;
      if (err.correlationId === undefined) {
        try {
          Object.defineProperty(err, 'correlationId', {
            value: id,
            enumerable: false,
            configurable: true,
            writable: true
          });
        } catch {
          // לא חוסם
          record.correlationId = id;
        }
      }
    }
  }

  // --- console rendering (כפוף ל-gate שכבר חושב ב-consoleEnabled) ---
  renderToConsole(record);

  // --- ring buffer ---
  pushToBuffer(record);

  // --- fan-out ל-sinks. רשומה כפולה (duplicate) מדולגת מ-sinks (log-once) ---
  if (!record.duplicate) {
    dispatchToSinks(record);
  }
};

// ============================================
// encodeDims — usage/health message encoder (D4)
// ============================================

/**
 * קיפול dims קטגוריים/נמדדים לסיומת message יציבה וניתנת-לשאילתה:
 * `base key1=v1 key2=v2` כשהמפתחות ממויינים. רק ערכי string/bool/finite-number
 * נכללים (אובייקטים/פונקציות/NaN/Infinity מושמטים) כדי שה-message שנשלח יישאר שטוח
 * וניתן ל-APL parse. משמש את track()/health() לקידוד dims של usage/health (D4).
 * מפרט זהה על פני app-core, תבניות error-guard, ו-tracker (מקור יחיד לפורמט ה-wire).
 *
 * @param {string} base - שם האירוע/האות
 * @param {Object} [dims] - dims קטגוריים/נמדדים
 * @returns {string}
 */
export function encodeDims(base, dims) {
  if (!dims) return base;
  const parts = [];
  for (const key of Object.keys(dims).sort()) {
    const v = dims[key];
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      parts.push(`${key}=${v}`);
    }
  }
  return parts.length ? `${base} ${parts.join(' ')}` : base;
}

const logger = {
  /**
   * הגדרת רמת לוג
   * @param {string|number} level - 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE'
   */
  setLevel: (level) => {
    if (typeof level === 'string') {
      // שימוש ב-?? ולא ב-|| כי LOG_LEVELS.DEBUG === 0 (falsy) — || היה מתרגם 'DEBUG' ל-WARN בטעות
      const resolved = LOG_LEVELS[level.toUpperCase()];
      currentLevel = resolved !== undefined ? resolved : LOG_LEVELS.WARN;
    } else {
      currentLevel = level;
    }
    console.log(`%c🔧 Log level changed to: ${Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === currentLevel)}`,
                'color: #9c27b0; font-weight: bold');
  },

  /**
   * קבלת רמת הלוג הנוכחית
   * @returns {string} שם רמת הלוג הנוכחית
   */
  getLevel: () => Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === currentLevel),

  /**
   * בדיקה אם מצב debug פעיל
   */
  isDebug: () => currentLevel <= LOG_LEVELS.DEBUG,

  // ============================================
  // תשתית sink
  // ============================================

  /**
   * רישום sink נוסף שיקבל כל רשומה דרך emit (fan-out).
   * @param {function(Object):void} fn - פונקציית sink
   * @returns {function():void} unsubscribe — קורא ל-removeSink(fn)
   */
  addSink: (fn) => {
    if (typeof fn !== 'function') return () => {};
    sinks.add(fn);
    return () => sinks.delete(fn);
  },

  /**
   * הסרת sink רשום
   * @param {function} fn
   */
  removeSink: (fn) => {
    sinks.delete(fn);
  },

  /**
   * נקודת האיגוד היחידה — חשופה לבדיקות ולשימושים מתקדמים.
   * שאר המתודות עוברות דרכה.
   */
  emit,

  /**
   * החזרת עותק של ה-ring buffer (FIFO, cap = RING_BUFFER_SIZE)
   * @returns {Object[]}
   */
  getBuffer: () => ringBuffer.slice(),

  /**
   * שטיפת ה-ring buffer ליעד מרוחק (נקרא ב-visibilitychange/beforeunload).
   * משתמש ב-navigator.sendBeacon אם קיים; אחרת fetch keepalive; אחרת no-op חינני.
   * אינו זורק לעולם (נקרא בנתיב unload).
   * @param {string} [url] - יעד אופציונלי. אם לא ניתן — flush הוא no-op חינני (אין יעד מרוחק עדיין).
   * @returns {boolean} האם נשלח משהו
   */
  flush: (url) => {
    if (ringBuffer.length === 0) return false;
    if (!url) {
      // אין יעד מרוחק מוגדר עדיין — flush הוא no-op חינני (התשתית מוכנה, היעד נדחה).
      return false;
    }
    let payload;
    try {
      payload = JSON.stringify(ringBuffer);
    } catch {
      // serialization כשל (למשל circular) — מנקים ולא זורקים
      return false;
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const ok = navigator.sendBeacon(url, payload);
        if (ok) {
          ringBuffer.length = 0;
          return true;
        }
        // אם sendBeacon נכשל — ניפול ל-fetch
      }
      if (typeof fetch === 'function') {
        // fire-and-forget; keepalive מאפשר שליחה גם בזמן unload
        fetch(url, { method: 'POST', body: payload, keepalive: true }).catch(() => {});
        ringBuffer.length = 0;
        return true;
      }
    } catch {
      // נתיב unload — לעולם לא זורקים החוצה
      return false;
    }
    // אין sendBeacon ואין fetch (למשל jsdom ללא stub) — no-op חינני
    return false;
  },

  /**
   * לוג debug - מידע מפורט לפיתוח
   */
  debug: (module, message, data = null) => {
    emit({
      kind: 'simple',
      level: 'DEBUG',
      module,
      message,
      data,
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * לוג info - מידע כללי
   */
  info: (module, message, data = null) => {
    emit({
      kind: 'simple',
      level: 'INFO',
      module,
      message,
      data,
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO
    });
  },

  /**
   * לוג warning - אזהרות
   * WARN נשלח ל-sink גם כשהקונסול מושתק (PROD).
   */
  warn: (module, message, data = null) => {
    emit({
      kind: 'simple',
      level: 'WARN',
      module,
      message,
      data,
      // אם data הוא Error — נצרף גם ל-error כדי שיזרום ל-sink בצורה מובנית
      error: data instanceof Error ? data : undefined,
      consoleEnabled: currentLevel <= LOG_LEVELS.WARN
    });
  },

  /**
   * לוג error - שגיאות
   * ERROR נשלח ל-sink גם כשהקונסול מושתק (PROD).
   *
   * ה-arg הרביעי האופציונלי (context) נצמד ל-record.context כדי שהקשר מובנה שהקורא
   * מצרף — למשל componentStack של React מ-ErrorBoundary.componentDidCatch — יזרום עם
   * רשומת ה-ERROR הנשלחת (ה-Axiom sink של @mapps/error-kit קורא componentStack רק מ-
   * record.context.componentStack). קריאה עם 3 ארגומנטים משאירה context כ-undefined.
   * @param {string} module
   * @param {string} message
   * @param {Error|*} [error]
   * @param {Object} [context] - הקשר דיאגנוסטי מובנה (למשל { componentStack })
   */
  error: (module, message, error = null, context = null) => {
    emit({
      kind: 'error',
      level: 'ERROR',
      module,
      message,
      error: error instanceof Error ? error : undefined,
      // אם error אינו instance של Error (למשל אובייקט/מחרוזת) — נשמר כ-data לרינדור/sink
      data: error instanceof Error ? undefined : error,
      context: context || undefined,
      consoleEnabled: currentLevel <= LOG_LEVELS.ERROR
    });
  },

  /**
   * track — טלמטריית usage (D3). רשומת INFO הנושאת את ה-DOMAIN kind 'usage'
   * (כ-domainKind — ה-sink מיישב אותו ל-ev.kind) ו-alwaysShip:true, כך שהיא נשלחת
   * ללא תלות במדיניות WARN/ERROR. ה-dims מקופלים ל-message דרך encodeDims (D4).
   * ה-rendering kind נשאר 'simple' (שורת INFO רגילה בקונסול).
   * @param {string} event - מזהה אירוע יציב (למשל 'view_open', 'settings_saved')
   * @param {Object} [dims] - dims קטגוריים/נמדדים המקופלים ל-message
   */
  track: (event, dims = null) => {
    emit({
      kind: 'simple',
      domainKind: 'usage',
      alwaysShip: true,
      level: 'INFO',
      module: 'usage',
      message: encodeDims(event, dims),
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO
    });
  },

  /**
   * health — אות בריאות (D5). רשומת INFO, DOMAIN kind 'health', alwaysShip:true.
   * ה-metrics מקופלים ל-message דרך encodeDims (D4).
   * @param {string} signal - מזהה אות יציב (למשל 'boot', 'api_latency')
   * @param {Object} [metrics] - metrics נמדדים המקופלים ל-message
   */
  health: (signal, metrics = null) => {
    emit({
      kind: 'simple',
      domainKind: 'health',
      alwaysShip: true,
      level: 'INFO',
      module: 'health',
      message: encodeDims(signal, metrics),
      consoleEnabled: currentLevel <= LOG_LEVELS.INFO
    });
  },

  /**
   * לוג מיוחד לקריאות API - לפני הקריאה
   */
  api: (functionName, query, variables = null) => {
    emit({
      kind: 'api',
      level: 'DEBUG',
      module: 'API',
      message: functionName,
      context: { query, variables },
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * לוג מיוחד לקריאות API - אחרי התשובה
   */
  apiResponse: (functionName, response, duration = null) => {
    emit({
      kind: 'apiResponse',
      level: 'DEBUG',
      module: 'API',
      message: functionName,
      context: { response, duration },
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * לוג מיוחד לקריאות API - שגיאה
   * apiError תמיד מוצג בקונסול (כמו קודם) ותמיד נשלח ל-sink.
   * @param {string} functionName - שם הפונקציה
   * @param {Error} error - אובייקט השגיאה
   * @param {Object} [context] - מידע דיאגנוסטי נוסף
   * @param {string} [context.query] - השאילתה שנשלחה
   * @param {Object} [context.rawResponse] - התשובה הגולמית מה-API
   * @param {string[]} [context.queryWarnings] - אזהרות ולידציה על השאילתה
   */
  apiError: (functionName, error, context = null) => {
    emit({
      kind: 'apiError',
      level: 'ERROR',
      module: 'API',
      message: functionName,
      error: error instanceof Error ? error : undefined,
      // אם error אינו Error (נדיר) — נשמר ב-data כדי שלא יאבד מ-sink
      data: error instanceof Error ? undefined : error,
      context: context || undefined,
      consoleEnabled: true // apiError תמיד מוצג בקונסול (התנהגות מקורית)
    });
  },

  /**
   * לוג פונקציה - תחילת ביצוע
   */
  functionStart: (functionName, params = null) => {
    emit({
      kind: 'simple',
      level: 'DEBUG',
      module: 'FUNCTION',
      message: `▶️ ${functionName} - Started`,
      data: params,
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  /**
   * לוג פונקציה - סיום ביצוע
   */
  functionEnd: (functionName, result = null) => {
    emit({
      kind: 'simple',
      level: 'DEBUG',
      module: 'FUNCTION',
      message: `✅ ${functionName} - Completed`,
      data: result,
      consoleEnabled: currentLevel <= LOG_LEVELS.DEBUG
    });
  },

  // ============================================
  // Init Flow — תמיד מוצג (גם בפרודקשן), יורה פעם אחת בטעינת אפליקציה
  // ============================================

  /**
   * לוג סיום שלב באתחול האפליקציה (תמיד מוצג)
   * @param {number} step - מספר השלב (1-9)
   * @param {string} message - תיאור הסיום
   * @param {*} [data] - מידע נוסף
   */
  initDone: (step, message, data = null) => {
    const timeLabel = new Date().toLocaleTimeString('he-IL');
    emit({
      kind: 'init',
      level: 'INFO',
      module: 'INIT',
      message,
      data,
      context: { step, timeLabel },
      consoleEnabled: true // Init Flow תמיד מוצג
    });
  },

  /**
   * לוג סיכום אתחול — זמן כולל מתחילת הטעינה (תמיד מוצג)
   * @param {number} [appLoadStart] - Date.now() מתחילת הטעינה (fallback ל-window.__appInitStart)
   */
  initSummary: (appLoadStart) => {
    let totalMs;
    if (appLoadStart) {
      totalMs = Date.now() - appLoadStart;
    } else if (typeof window !== 'undefined' && window.__appInitStart) {
      totalMs = Math.round(performance.now() - window.__appInitStart);
    } else {
      totalMs = '?';
    }
    emit({
      kind: 'initSummary',
      level: 'INFO',
      module: 'INIT',
      message: 'App fully interactive',
      context: { totalMs },
      consoleEnabled: true // Init Flow תמיד מוצג
    });
  }
};

// Init Step 1 — יורה ברגע שהמודול נטען (הנקודה המוקדמת ביותר בבאנדל)
logger.initDone(1, 'Bundle loaded');

// flush אוטומטי ב-visibilitychange/beforeunload (התשתית מוכנה; היעד נדחה — flush ללא url הוא no-op)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const flushOnHidden = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      logger.flush();
    }
  };
  window.addEventListener('visibilitychange', flushOnHidden);
  window.addEventListener('beforeunload', () => logger.flush());
}

// ============================================
// פקודות גלובליות לדיבאג בפרודקשן
// הקלד בקונסול את הפקודות הבאות:
// - enableDebugLogs()  - הפעלת לוגים מלאים
// - disableDebugLogs() - השבתת לוגים (חזרה לפרודקשן)
// - getLogLevel()      - הצגת רמת הלוג הנוכחית
// - setLogLevel('INFO') - הגדרת רמה ספציפית
// ============================================

if (typeof window !== 'undefined') {
  /**
   * הפעלת לוגים מלאים בפרודקשן
   * הקלד בקונסול: enableDebugLogs()
   */
  window.enableDebugLogs = () => {
    logger.setLevel('DEBUG');
    console.log('%c🐛 Debug logs ENABLED - All logs will now be displayed',
                'color: #4caf50; font-weight: bold; font-size: 14px');
    console.log('%c💡 To disable: disableDebugLogs()', 'color: #9e9e9e');
  };

  /**
   * השבתת לוגים (חזרה למצב פרודקשן)
   * הקלד בקונסול: disableDebugLogs()
   */
  window.disableDebugLogs = () => {
    logger.setLevel('ERROR');
    console.log('%c🔇 Debug logs DISABLED - Only errors will be displayed',
                'color: #f44336; font-weight: bold; font-size: 14px');
  };

  /**
   * הצגת רמת הלוג הנוכחית
   * הקלד בקונסול: getLogLevel()
   */
  window.getLogLevel = () => {
    const level = logger.getLevel();
    console.log(`%c📊 Current log level: ${level}`, 'color: #2196f3; font-weight: bold');
    return level;
  };

  /**
   * הגדרת רמת לוג ספציפית
   * הקלד בקונסול: setLogLevel('INFO')
   * @param {string} level - 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE'
   */
  window.setLogLevel = (level) => {
    logger.setLevel(level);
  };
}

// ייצוא
export default logger;
export { LOG_LEVELS };
