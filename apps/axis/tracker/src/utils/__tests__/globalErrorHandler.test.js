/**
 * בדיקות ל-globalErrorHandler (Phase 3 — משטח ה-dark הגלובלי).
 *
 * מטרה: לאמת שכל שגיאה שנתפסת גלובלית (uncaught error / unhandled rejection)
 * מגיעה ל-sink של ה-logger **פעם אחת** — נקודת הרישום היחידה במסלול הגלובלי
 * היא handleGlobalError. מאז ui-sink-plan.md Phase 1 אין delegate להצגה:
 * ה-UI sink (useUiErrorSink) מאזין לרשומות ERROR ומציג מהן את הטוסט,
 * וה-facade (showErrorWithDetails) מדלג על רישום כפול דרך חוזה ה-log-once
 * (__loggedId; §3.1).
 *
 * חשוב: setupTests.js ממקה את './utils/logger' גלובלית. הקובץ הזה צריך את
 * ה-logger האמיתי כדי לאמת fan-out ל-sink — לכן הוא עוקף עם vi.unmock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../logger';
import {
    setupGlobalErrorHandlers,
    handleGlobalError,
} from '../globalErrorHandler';

// vi.unmock מורם ע"י vitest מעל ה-imports (כמו vi.mock) — עוקף את ה-mock הגלובלי
// מ-setupTests.js כדי שנקבל את ה-logger האמיתי ונוכל לאמת fan-out ל-sink.
vi.unmock('../logger');

// console-spy למניעת זיהום פלט הבדיקות (ה-logger מרנדר לקונסול דרך emit)
let consoleSpies;
const installConsoleSpies = () => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
};
const restoreConsoleSpies = () => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
};

// מעקב אחר ה-listeners שנרשמו על window — כדי לנקות אותם ב-afterEach
// (מניעת דליפה בין קבצים: setupGlobalErrorHandlers מוסיף listeners גלובליים).
let addedListeners;
let originalAddEventListener;
const trackWindowListeners = () => {
    addedListeners = [];
    originalAddEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
        addedListeners.push({ type, handler, options });
        return originalAddEventListener(type, handler, options);
    });
};
const cleanupWindowListeners = () => {
    addedListeners.forEach(({ type, handler, options }) => {
        window.removeEventListener(type, handler, options);
    });
    addedListeners = [];
};

let sinkSpy;
let unsubSink;

beforeEach(() => {
    installConsoleSpies();
    trackWindowListeners();
    // ה-sink שמאמת את הרישום המרכזי
    sinkSpy = vi.fn();
    unsubSink = logger.addSink(sinkSpy);
});

afterEach(() => {
    if (unsubSink) unsubSink();
    logger.removeSink(sinkSpy);
    cleanupWindowListeners();
    window.addEventListener.mockRestore?.();
    restoreConsoleSpies();
});

/**
 * מסנן את רשומות ה-sink לאלו של שגיאה ספציפית (לפי ה-Error instance).
 * sink מקבל רק רשומות שאינן duplicate (log-once) — לכן הספירה היא "פעם אחת לשגיאה".
 */
const sinkRecordsForError = (err) =>
    sinkSpy.mock.calls.map((c) => c[0]).filter((rec) => rec.error === err);

describe('globalErrorHandler — רישום מרכזי דרך logger (Phase 3)', () => {

    describe('handleGlobalError — נקודת הרישום היחידה', () => {
        it('רושם דרך logger (ה-sink מקבל את הרשומה פעם אחת)', () => {
            const err = new Error('no handler set');
            handleGlobalError(err, { functionName: 'TestFn' });

            const recs = sinkRecordsForError(err);
            expect(recs.length).toBe(1);
            expect(recs[0].level).toBe('ERROR');
            expect(recs[0].module).toBe('TestFn');
        });

        it('מטביע __loggedId כך שה-facade (showErrorWithDetails) ידלג על רישום כפול (log-once)', () => {
            const err = new Error('monday api boom');
            handleGlobalError(err, { functionName: 'GlobalErrorHandler' });

            // המדמה של ה-facade: רושם רק אם השגיאה לא נרשמה כבר (חוזה log-once §3.1)
            if (!err || err.__loggedId === undefined) {
                logger.error('showErrorWithDetails', 'fallback log', err);
            }

            // הרישום הגיע ל-sink פעם אחת בלבד (ה-facade דילג בזכות __loggedId)
            expect(sinkRecordsForError(err).length).toBe(1);
            expect(err.__loggedId).toBeDefined();
        });
    });

    describe('listeners גלובליים — ErrorEvent / PromiseRejectionEvent', () => {
        it('uncaught error (Monday-API) → ה-sink נקרא פעם אחת', () => {
            setupGlobalErrorHandlers();

            // שגיאת Monday-API (response.errors) — לא תואמת לדפוסי chunk-load
            const err = new Error('Graphql validation errors');
            err.response = { errors: [{ message: 'no permission' }] };

            window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }));

            expect(sinkRecordsForError(err).length).toBe(1);
            const rec = sinkRecordsForError(err)[0];
            expect(rec.level).toBe('ERROR');
            expect(rec.module).toBe('UncaughtError');
        });

        it('unhandled rejection (Monday-API) → ה-sink נקרא פעם אחת', () => {
            setupGlobalErrorHandlers();

            const err = new Error('Graphql validation errors');
            err.response = { errors: [{ message: 'no permission' }] };
            // PromiseRejectionEvent דורש promise — נספק promise שכבר נדחה (ונטפל בו כדי לא ליצור rejection אמיתי)
            const rejected = Promise.reject(err);
            rejected.catch(() => {});

            window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
                promise: rejected,
                reason: err,
            }));

            expect(sinkRecordsForError(err).length).toBe(1);
            const rec = sinkRecordsForError(err)[0];
            expect(rec.level).toBe('ERROR');
            expect(rec.module).toBe('UnhandledPromiseRejection');
        });

        it('uncaught error לא-Monday (fallback) → נרשם דרך logger פעם אחת', () => {
            setupGlobalErrorHandlers();

            // שגיאה רגילה שאינה Monday ואינה chunk-load → נופלת לענף ה-fallback
            const err = new Error('some plain runtime error');
            window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }));

            const recs = sinkRecordsForError(err);
            expect(recs.length).toBe(1);
            expect(recs[0].module).toBe('globalErrorHandler');
        });

        it('unhandled rejection לא-Monday (fallback) → נרשם דרך logger פעם אחת', () => {
            setupGlobalErrorHandlers();

            const err = new Error('plain rejection');
            const rejected = Promise.reject(err);
            rejected.catch(() => {});

            window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
                promise: rejected,
                reason: err,
            }));

            const recs = sinkRecordsForError(err);
            expect(recs.length).toBe(1);
            expect(recs[0].module).toBe('globalErrorHandler');
        });
    });
});
