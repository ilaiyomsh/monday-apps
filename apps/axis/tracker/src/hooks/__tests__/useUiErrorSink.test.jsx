/**
 * בדיקות ל-useUiErrorSink — נתיב ההצגה היחיד לשגיאות (ui-sink-plan.md Phase 1).
 *
 * חוזה: כל רשומת ERROR שעוברת דרך emit (logger.error / logger.apiError) מפיקה
 * קריאת showToast אחת עם הודעה מפוענחת (parseMondayError.userMessage), משך
 * AUTO_CLOSE_MS, ו-errorDetails מלא ל-ErrorDetailsModal. רשומות duplicate
 * (log-once) ורמות שאינן ERROR אינן מציגות. שגיאות init מוקדמות מה-ring buffer
 * מוצגות ב-replay עם תקרה.
 *
 * setupTests.js ממקה את logger גלובלית; כאן נדרש ה-logger האמיתי (fan-out,
 * ring buffer, log-once) — לכן vi.unmock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import logger from '../../utils/logger';
import { useUiErrorSink, AUTO_CLOSE_MS, REPLAY_CAP } from '../useUiErrorSink';

vi.unmock('../../utils/logger');

// השתקת רינדור הקונסול של ה-logger האמיתי
let consoleSpies;
beforeEach(() => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
});
afterEach(() => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
});

/** עוזר: mount של ה-sink עם showToast מרוגל; מנקה את היסטוריית ה-replay */
const mountSink = (showToastImpl) => {
    const showToast = vi.fn(showToastImpl);
    const utils = renderHook(() => useUiErrorSink({ showToast }));
    // ה-mount מריץ replay על מה שנצבר ב-buffer מטסטים קודמים — מנקים כדי
    // שהבדיקות הבאות ימדדו רק dispatch חי
    showToast.mockClear();
    return { showToast, ...utils };
};

describe('useUiErrorSink — dispatch חי', () => {
    it('רשומת ERROR (logger.error עם Error) → showToast אחד עם הודעה, משך וסוג נכונים', () => {
        const { showToast } = mountSink();

        const err = new Error('משהו נשבר בדרך');
        logger.error('TestModule', 'something broke', err);

        expect(showToast).toHaveBeenCalledTimes(1);
        const [message, type, duration, details] = showToast.mock.calls[0];
        // אין קוד שגיאה מוכר — userMessage נופל להודעת ה-Error עצמה
        expect(message).toBe('משהו נשבר בדרך');
        expect(type).toBe('error');
        expect(duration).toBe(AUTO_CLOSE_MS);
        expect(details).toMatchObject({
            userMessage: 'משהו נשבר בדרך',
            request: expect.objectContaining({ functionName: 'TestModule' }),
        });
    });

    it('רשומה עם data לא-Error (מחרוזת) → עדיין מציגה טוסט', () => {
        const { showToast } = mountSink();

        logger.error('TestModule', 'plain failure', 'ערך גולמי כלשהו');

        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast.mock.calls[0][1]).toBe('error');
    });

    it('logger.apiError עם rawResponse ב-context → ההודעה הספציפית מחולצת מ-errors[]', () => {
        const { showToast } = mountSink();

        const softError = new Error('GraphQL errors in response');
        logger.apiError('fetchProjects', softError, {
            query: 'query { boards { id } }',
            rawResponse: {
                errors: [{
                    message: 'User unauthorized to perform action',
                    extensions: { code: 'USER_UNAUTHORIZED' },
                }],
            },
        });

        expect(showToast).toHaveBeenCalledTimes(1);
        const [message, , , details] = showToast.mock.calls[0];
        // הקוד זוהה → ההודעה הידידותית מהמילון, לא הודעה גנרית
        expect(message).toContain('הרשאות');
        expect(details.errorCode).toBe('USER_UNAUTHORIZED');
    });

    it('אותו Error instance שנרשם פעמיים → טוסט אחד בלבד (log-once duplicate מדולג)', () => {
        const { showToast } = mountSink();

        const err = new Error('אותה שגיאה');
        logger.error('ModuleA', 'first', err);
        logger.error('ModuleB', 'second (duplicate)', err);

        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('רשומת ERROR ממקור ErrorBoundary אינה מציגה טוסט (ההצגה דרך מסך ה-fallback)', () => {
        const { showToast } = mountSink();

        logger.error('ErrorBoundary', 'React error caught', new Error('render crash'));

        expect(showToast).not.toHaveBeenCalled();
    });

    it('WARN / INFO / DEBUG אינם מציגים טוסט', () => {
        const { showToast } = mountSink();

        logger.warn('TestModule', 'אזהרה', new Error('warn-err'));
        logger.info('TestModule', 'מידע');
        logger.debug('TestModule', 'דיבאג');

        expect(showToast).not.toHaveBeenCalled();
    });

    it('showToast שזורק לא מפיל את ה-emit ולא יוצר לולאה', () => {
        const { showToast } = mountSink(() => { throw new Error('sink exploded'); });

        expect(() => logger.error('TestModule', 'boom', new Error('orig'))).not.toThrow();
        // קריאה אחת — הכשל בתוכה לא ייצר רשומה/טוסט נוספים
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('loop guard סינכרוני: emit מתוך ה-handler עצמו נדחה (אין רקורסיה)', () => {
        // showToast שמדמה קוד-sink שרושם שגיאה באופן סינכרוני בזמן הטיפול
        const { showToast } = mountSink(() => {
            logger.error('NestedModule', 'nested log from inside sink', new Error('nested'));
        });

        logger.error('TestModule', 'outer', new Error('outer'));

        // רק הרשומה החיצונית הציגה טוסט — הרשומות המקוננות נדחו ע"י ה-guard
        // (אחרת הייתה כאן רקורסיה אינסופית). הן עדיין נרשמות ל-buffer.
        expect(showToast).toHaveBeenCalledTimes(1);
        const buffered = logger.getBuffer().filter(r => r.module === 'NestedModule');
        expect(buffered.length).toBeGreaterThanOrEqual(1);
    });

    it('unmount מסיר את ה-sink — אין טוסטים אחרי', () => {
        const { showToast, unmount } = mountSink();
        unmount();

        logger.error('TestModule', 'after unmount', new Error('late'));

        expect(showToast).not.toHaveBeenCalled();
    });
});

describe('useUiErrorSink — buffer replay בעלייה', () => {
    it('שגיאות init שנרשמו לפני ה-mount מוצגות ב-replay (פעם אחת, כרונולוגית)', () => {
        const tag = `replay-${Date.now()}`;
        const errA = new Error(`${tag}-A`);
        const errB = new Error(`${tag}-B`);
        logger.error('InitModule', 'early A', errA);
        logger.error('InitModule', 'early B', errB);

        const showToast = vi.fn();
        renderHook(() => useUiErrorSink({ showToast }));

        const replayed = showToast.mock.calls.filter(c => String(c[0]).startsWith(tag));
        expect(replayed.length).toBe(2);
        // סדר כרונולוגי — A לפני B
        expect(replayed[0][0]).toBe(`${tag}-A`);
        expect(replayed[1][0]).toBe(`${tag}-B`);
    });

    it('replay מדלג על רשומות duplicate (אותו instance שנרשם פעמיים)', () => {
        const tag = `replay-dup-${Date.now()}`;
        const err = new Error(`${tag}-X`);
        logger.error('InitModule', 'first', err);
        logger.error('InitModule', 'second (duplicate)', err);

        const showToast = vi.fn();
        renderHook(() => useUiErrorSink({ showToast }));

        const replayed = showToast.mock.calls.filter(c => String(c[0]).startsWith(tag));
        expect(replayed.length).toBe(1);
    });

    it(`replay מוגבל ל-${REPLAY_CAP} הרשומות האחרונות`, () => {
        const tag = `replay-cap-${Date.now()}`;
        const total = REPLAY_CAP + 3;
        for (let i = 1; i <= total; i++) {
            logger.error('InitModule', `early ${i}`, new Error(`${tag}-${i}`));
        }

        const showToast = vi.fn();
        renderHook(() => useUiErrorSink({ showToast }));

        const replayed = showToast.mock.calls.filter(c => String(c[0]).startsWith(tag));
        expect(replayed.length).toBe(REPLAY_CAP);
        // האחרונות נשמרות — הראשונות נחתכות
        expect(replayed[replayed.length - 1][0]).toBe(`${tag}-${total}`);
        expect(replayed[0][0]).toBe(`${tag}-${total - REPLAY_CAP + 1}`);
    });
});
