/**
 * בדיקות ל-logger sink-ready (Phase 1).
 *
 * חשוב: setupTests.js ממקה את './utils/logger' גלובלית. הקובץ הזה צריך את ה-logger
 * האמיתי — לכן הוא עוקף את ה-mock עם vi.unmock + vi.importActual.
 *
 * כיסוי:
 *  - addSink(spy) מקבל כל רמה (debug/info/warn/error/api/apiResponse/apiError + stack/init)
 *  - ring buffer נשמר לפני רישום sink (replay/getBuffer) + cap FIFO
 *  - flush עם stub ל-sendBeacon + ענף ה-absent (fetch fallback / no-op)
 *  - מצב PROD (stubEnv PROD + resetModules) — WARN/ERROR ל-sink גם כשהקונסול מושתק
 *  - console-spy שלא מזהם פלט הבדיקות + שליטה דרך emit
 *  - dedup: re-throw של אותו Error → רשומה אחת לסינק
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// עוקף את ה-mock הגלובלי מ-setupTests.js
vi.unmock('../logger');

// console-spy ל-beforeEach/afterEach — מונע זיהום פלט הבדיקות ומאפשר אימות שליטה דרך emit
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

/**
 * טוען מודול logger טרי (עם side-effects של import-time) ומחזיר את ה-default.
 * משתמש ב-importActual כדי לעקוף את ה-mock הגלובלי.
 */
const loadFreshLogger = async () => {
    vi.resetModules();
    const mod = await vi.importActual('../logger');
    return mod.default;
};

beforeEach(() => {
    installConsoleSpies();
});

afterEach(() => {
    restoreConsoleSpies();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('logger sink-ready', () => {

    // === addSink: כל רמה מגיעה ל-sink עם רשומה מובנית ===

    describe('addSink — fan-out לכל רמה', () => {
        it('addSink מחזיר unsubscribe ו-removeSink מסיר', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            const unsub = logger.addSink(spy);
            expect(typeof unsub).toBe('function');

            logger.debug('Mod', 'first');
            expect(spy).toHaveBeenCalledTimes(1);

            unsub();
            logger.debug('Mod', 'after unsub');
            expect(spy).toHaveBeenCalledTimes(1);

            logger.addSink(spy);
            logger.removeSink(spy);
            logger.debug('Mod', 'after removeSink');
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('debug/info/warn — רשומה מובנית עם level/module/message/timestamp', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.debug('ModA', 'd-msg', { a: 1 });
            logger.info('ModB', 'i-msg');
            logger.warn('ModC', 'w-msg');

            expect(spy).toHaveBeenCalledTimes(3);
            const [d, i, w] = spy.mock.calls.map((c) => c[0]);

            expect(d).toMatchObject({ level: 'DEBUG', module: 'ModA', message: 'd-msg', data: { a: 1 } });
            expect(typeof d.timestamp).toBe('number');
            expect(typeof d.timestampISO).toBe('string');
            expect(i).toMatchObject({ level: 'INFO', module: 'ModB', message: 'i-msg' });
            expect(w).toMatchObject({ level: 'WARN', module: 'ModC', message: 'w-msg' });
        });

        it('error — מעביר את ה-Error instance ב-record.error כולל stack', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            const err = new Error('boom');
            logger.error('ModErr', 'failed', err);

            expect(spy).toHaveBeenCalledTimes(1);
            const rec = spy.mock.calls[0][0];
            expect(rec.level).toBe('ERROR');
            expect(rec.error).toBe(err);
            expect(rec.error.stack).toBeTruthy();
            // הסטאק עבר דרך emit (console.error נקרא דרך renderToConsole), לא console.error ישיר חיצוני
            expect(consoleSpies.error).toHaveBeenCalled();
        });

        it('error — ערך שאינו Error נשמר ב-data ולא ב-error', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.error('ModErr', 'soft', { errors: [{ message: 'x' }] });
            const rec = spy.mock.calls[0][0];
            expect(rec.error).toBeUndefined();
            expect(rec.data).toEqual({ errors: [{ message: 'x' }] });
        });

        it('api/apiResponse — רשומות API מגיעות ל-sink', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.api('fetchBoards', 'query { boards }', { id: 1 });
            logger.apiResponse('fetchBoards', { data: {} }, 42);

            const [a, r] = spy.mock.calls.map((c) => c[0]);
            expect(a).toMatchObject({ kind: 'api', module: 'API', message: 'fetchBoards' });
            expect(a.context).toMatchObject({ query: 'query { boards }', variables: { id: 1 } });
            expect(r).toMatchObject({ kind: 'apiResponse', message: 'fetchBoards' });
            expect(r.context).toMatchObject({ duration: 42 });
        });

        it('apiError — מגיע ל-sink עם error + context (query/rawResponse/warnings) + stack', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            const err = new Error('api failed');
            logger.apiError('createItem', err, {
                query: 'mutation { create }',
                rawResponse: { errors: [{ message: 'no perm' }] },
                queryWarnings: ['warn1'],
            });

            expect(spy).toHaveBeenCalledTimes(1);
            const rec = spy.mock.calls[0][0];
            expect(rec.kind).toBe('apiError');
            expect(rec.level).toBe('ERROR');
            expect(rec.error).toBe(err);
            expect(rec.context).toMatchObject({
                query: 'mutation { create }',
                queryWarnings: ['warn1'],
            });
            expect(rec.context.rawResponse).toEqual({ errors: [{ message: 'no perm' }] });
        });

        it('initDone/initSummary — מגיעים ל-sink', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.initDone(3, 'Settings loaded');
            logger.initSummary(Date.now() - 100);

            const kinds = spy.mock.calls.map((c) => c[0].kind);
            expect(kinds).toContain('init');
            expect(kinds).toContain('initSummary');
        });

        it('track — usage record: INFO, domainKind usage, alwaysShip, dims folded into message', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);
            logger.track('settings_opened', { source: 'toolbar' });
            expect(spy).toHaveBeenCalledTimes(1);
            const rec = spy.mock.calls[0][0];
            expect(rec).toMatchObject({
                level: 'INFO', module: 'usage', domainKind: 'usage', alwaysShip: true,
                message: 'settings_opened source=toolbar',
            });
        });

        it('health — health record: INFO, domainKind health, alwaysShip', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);
            logger.health('boot_ok', { ms: 120 });
            const rec = spy.mock.calls[0][0];
            expect(rec).toMatchObject({
                level: 'INFO', module: 'health', domainKind: 'health', alwaysShip: true,
                message: 'boot_ok ms=120',
            });
        });

        it('functionStart/functionEnd — מגיעים ל-sink', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.functionStart('doThing', { p: 1 });
            logger.functionEnd('doThing', { ok: true });

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[0][0].message).toContain('doThing');
            expect(spy.mock.calls[1][0].message).toContain('doThing');
        });
    });

    // === ring buffer ===

    describe('ring buffer', () => {
        it('נשמר לפני רישום sink (getBuffer)', async () => {
            const logger = await loadFreshLogger();
            // לוגים לפני שום sink
            logger.info('Pre', 'one');
            logger.warn('Pre', 'two');

            const buf = logger.getBuffer();
            // ה-buffer מכיל גם את init step 1 מ-import-time; מספיק שהשתיים האחרונות שם
            const messages = buf.map((r) => r.message);
            expect(messages).toContain('one');
            expect(messages).toContain('two');
        });

        it('getBuffer מחזיר עותק (לא מאפשר מוטציה של ה-buffer הפנימי)', async () => {
            const logger = await loadFreshLogger();
            logger.info('Mod', 'x');
            const buf = logger.getBuffer();
            const lenBefore = logger.getBuffer().length;
            buf.push({ fake: true });
            expect(logger.getBuffer().length).toBe(lenBefore);
        });

        it('cap FIFO — לא חורג מהגודל המרבי', async () => {
            const logger = await loadFreshLogger();
            for (let n = 0; n < 400; n++) {
                logger.info('Flood', `m${n}`);
            }
            const buf = logger.getBuffer();
            // cap הוא 150; חייב להיות חסום
            expect(buf.length).toBeLessThanOrEqual(150);
            // הרשומות האחרונות נשמרות (FIFO drop מהראש)
            const last = buf[buf.length - 1];
            expect(last.message).toBe('m399');
        });
    });

    // === flush ===

    describe('flush', () => {
        it('עם sendBeacon stub — שולח ומרוקן את ה-buffer', async () => {
            const logger = await loadFreshLogger();
            const beacon = vi.fn(() => true);
            vi.stubGlobal('navigator', { sendBeacon: beacon });

            logger.info('Mod', 'before flush');
            const sent = logger.flush('https://example.test/logs');

            expect(sent).toBe(true);
            expect(beacon).toHaveBeenCalledTimes(1);
            expect(beacon.mock.calls[0][0]).toBe('https://example.test/logs');
            expect(logger.getBuffer().length).toBe(0);
        });

        it('ללא sendBeacon — נופל ל-fetch keepalive ומרוקן', async () => {
            const logger = await loadFreshLogger();
            vi.stubGlobal('navigator', {}); // אין sendBeacon
            const fetchSpy = vi.fn(() => Promise.resolve());
            vi.stubGlobal('fetch', fetchSpy);

            logger.info('Mod', 'x');
            const sent = logger.flush('https://example.test/logs');

            expect(sent).toBe(true);
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });
            expect(logger.getBuffer().length).toBe(0);
        });

        it('ענף ה-absent — אין sendBeacon ואין fetch → no-op חינני (לא זורק, buffer נשאר)', async () => {
            const logger = await loadFreshLogger();
            vi.stubGlobal('navigator', {});
            vi.stubGlobal('fetch', undefined);

            logger.info('Mod', 'x');
            const before = logger.getBuffer().length;
            expect(before).toBeGreaterThan(0);
            let sent;
            expect(() => { sent = logger.flush('https://example.test/logs'); }).not.toThrow();
            expect(sent).toBe(false);
            expect(logger.getBuffer().length).toBe(before);
        });

        it('flush ללא url — no-op חינני (היעד נדחה)', async () => {
            const logger = await loadFreshLogger();
            logger.info('Mod', 'x');
            const before = logger.getBuffer().length;
            expect(logger.flush()).toBe(false);
            expect(logger.getBuffer().length).toBe(before);
        });

        it('flush על buffer ריק מחזיר false', async () => {
            const logger = await loadFreshLogger();
            // נרוקן דרך flush מוצלח
            vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) });
            logger.flush('https://example.test/logs');
            expect(logger.flush('https://example.test/logs')).toBe(false);
        });
    });

    // === מצב PROD ===

    describe('מצב PROD — gate של קונסול מול sink', () => {
        it('WARN/ERROR נשלחים ל-sink גם כשהקונסול מושתק ב-PROD', async () => {
            vi.stubEnv('PROD', true);
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            // לוודא שהרמה היא ERROR בפרודקשן
            expect(logger.getLevel()).toBe('ERROR');

            // נקה את ספיית הקונסול מ-import-time (initDone)
            consoleSpies.log.mockClear();

            logger.debug('Mod', 'debug-muted');
            logger.info('Mod', 'info-muted');
            logger.warn('Mod', 'warn-msg');
            logger.error('Mod', 'err-msg', new Error('e'));

            // כל הרמות מגיעות ל-sink (גם המושתקות בקונסול) — זו הנקודה: ניטור עצמאי מ-gate הקונסול
            const levels = spy.mock.calls.map((c) => c[0].level);
            expect(levels).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);

            // ב-PROD רמת הקונסול היא ERROR — רק ERROR מוצג בקונסול; השאר מושתקים.
            // המבחן הקריטי: WARN/ERROR בכל זאת מגיעים ל-sink (אומת ב-levels למעלה).
            const byLevel = Object.fromEntries(spy.mock.calls.map((c) => [c[0].level, c[0].consoleEnabled]));
            expect(byLevel.DEBUG).toBe(false);
            expect(byLevel.INFO).toBe(false);
            expect(byLevel.WARN).toBe(false); // מושתק בקונסול ב-PROD, אך הגיע ל-sink
            expect(byLevel.ERROR).toBe(true);  // ERROR מוצג בקונסול גם ב-PROD
        });

        it('בפיתוח — כל הרמות מוצגות בקונסול (consoleEnabled=true)', async () => {
            vi.stubEnv('PROD', false);
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.debug('Mod', 'd');
            const rec = spy.mock.calls[0][0];
            expect(rec.consoleEnabled).toBe(true);
        });
    });

    // === console-spy: שליטה ב-emit, אין זיהום פלט ===

    describe('console נשלט דרך emit', () => {
        it('debug בפיתוח כותב לקונסול דרך console.log (לא ישירות מחוץ ל-emit)', async () => {
            const logger = await loadFreshLogger();
            consoleSpies.log.mockClear();
            logger.debug('Mod', 'visible');
            expect(consoleSpies.log).toHaveBeenCalled();
        });

        it('כשהקונסול מושתק (NONE) אין פלט קונסול אך ה-sink מקבל', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);
            logger.setLevel('NONE');
            consoleSpies.log.mockClear();
            consoleSpies.error.mockClear();

            logger.error('Mod', 'silent-console', new Error('x'));

            // הקונסול לא קיבל את הרינדור (consoleEnabled=false)
            expect(consoleSpies.error).not.toHaveBeenCalled();
            // אבל ה-sink כן קיבל
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].consoleEnabled).toBe(false);
        });
    });

    // === log-once / dedup ===

    describe('log-once dedup', () => {
        it('re-throw של אותו Error → רשומה אחת לסינק (השנייה duplicate)', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            const err = new Error('once');
            logger.apiError('safeApi', err);     // מעבר ראשון
            logger.error('caller.createEvent', 'failed', err); // מעבר שני — אותו instance

            // ה-sink קיבל פעם אחת בלבד (השנייה דולגה כ-duplicate)
            expect(spy).toHaveBeenCalledTimes(1);
            const rec = spy.mock.calls[0][0];
            expect(rec.duplicate).toBe(false);
            expect(rec.correlationId).toBeTruthy();
        });

        it('אותו correlationId על שני המעברים', async () => {
            const logger = await loadFreshLogger();
            const seen = [];
            // sink שמתעד גם duplicates — נשתמש ב-getBuffer במקום, כי sinks מדלגים על duplicate
            logger.apiError('safeApi', new Error('keep'));
            const err = new Error('shared');
            logger.apiError('safeApi', err);
            logger.error('caller', 'again', err);

            const buf = logger.getBuffer();
            const recs = buf.filter((r) => r.error === err);
            expect(recs.length).toBe(2);
            expect(recs[0].correlationId).toBe(recs[1].correlationId);
            expect(recs[0].duplicate).toBe(false);
            expect(recs[1].duplicate).toBe(true);
            // sentinel למניעת unused
            expect(seen).toEqual([]);
        });

        it('שגיאות שונות (instances שונים) → שתי רשומות נפרדות', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.error('Mod', 'a', new Error('a'));
            logger.error('Mod', 'b', new Error('b'));

            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('correlationId קיים מראש על ה-Error מכובד (לא נדרס)', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            const err = new Error('pre');
            Object.defineProperty(err, 'correlationId', { value: 'preset-123', enumerable: false, configurable: true });
            logger.error('Mod', 'x', err);

            expect(spy.mock.calls[0][0].correlationId).toBe('preset-123');
        });

        // === regression: logger.error עם payload שאינו Error (אובייקט פשוט / מחרוזת) ===

        it('(א) logger.error עם אובייקט פשוט מדפיס אותו לקונסול', async () => {
            const logger = await loadFreshLogger();
            consoleSpies.log.mockClear();

            const payload = { errors: [{ message: 'no perm' }] };
            logger.error('Mod', 'soft error', payload);

            // ה-payload נשמר ב-data (לא Error) — ובכל זאת מודפס לקונסול דרך console.log
            // (renderToConsole נופל חזרה ל-data כש-error הוא undefined).
            expect(consoleSpies.log).toHaveBeenCalled();
            const passedData = consoleSpies.log.mock.calls.some((call) => call.includes(payload));
            expect(passedData).toBe(true);
        });

        it('(ב) אותו אובייקט פשוט המועבר ל-emit פעמיים → רשומת-sink אחת', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            // אובייקט שגיאת Monday "פשוט" (לא Error instance) — כמו שעובר ב-globalErrorHandler.
            const mondayErr = { errors: [{ message: 'permission denied' }] };
            logger.error('globalErrorHandler', 'Global error caught', mondayErr); // מעבר ראשון
            logger.error('caller.createEvent', 'failed', mondayErr);              // מעבר שני — אותו instance

            // ה-sink קיבל פעם אחת בלבד (השנייה דולגה כ-duplicate דרך __loggedId על ה-data).
            expect(spy).toHaveBeenCalledTimes(1);
            const rec = spy.mock.calls[0][0];
            expect(rec.duplicate).toBe(false);
            expect(rec.correlationId).toBeTruthy();
            expect(rec.data).toBe(mondayErr);

            // ה-__loggedId הוטבע על האובייקט הפשוט עצמו — כך showErrorWithDetails מתכנס לרשומת-sink אחת.
            expect(mondayErr.__loggedId).toBeDefined();

            // המעבר השני נשמר ב-ring buffer כ-duplicate עם אותו correlationId (הרשומה הקנונית נשמרת).
            const buf = logger.getBuffer();
            const recs = buf.filter((r) => r.data === mondayErr);
            expect(recs.length).toBe(2);
            expect(recs[0].duplicate).toBe(false);
            expect(recs[1].duplicate).toBe(true);
            expect(recs[0].correlationId).toBe(recs[1].correlationId);
        });

        it('(ג) אובייקט context טרי בכל קריאה לא עובר dedup — נרשם בכל פעם', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            // מדמה את client.js:256 — אובייקט נתונים טרי בכל קריאה (soft-error GraphQL bag).
            const makeBag = () => ({ query: 'q', rawResponse: { errors: [{ message: 'soft' }] } });
            logger.error('API', 'callerA - GraphQL errors in response', makeBag());
            logger.error('API', 'callerB - GraphQL errors in response', makeBag());

            // שני האובייקטים טריים (identity שונה) → אף אחד לא נחשב duplicate → שתי רשומות-sink.
            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy.mock.calls[0][0].duplicate).toBe(false);
            expect(spy.mock.calls[1][0].duplicate).toBe(false);
        });

        it('(ד) אובייקט פשוט שונה (instance אחר) → שתי רשומות נפרדות', async () => {
            const logger = await loadFreshLogger();
            const spy = vi.fn();
            logger.addSink(spy);

            logger.error('Mod', 'a', { code: 1 });
            logger.error('Mod', 'b', { code: 2 });

            expect(spy).toHaveBeenCalledTimes(2);
        });
    });

    // === התנהגות הציבורית נשמרת ===

    describe('API ציבורי נשמר', () => {
        it('setLevel/getLevel/isDebug עובדים', async () => {
            const logger = await loadFreshLogger();
            logger.setLevel('WARN');
            expect(logger.getLevel()).toBe('WARN');
            expect(logger.isDebug()).toBe(false);
            logger.setLevel('DEBUG');
            expect(logger.isDebug()).toBe(true);
        });
    });
});
