/**
 * axiomSink tests — implements §5.2 (S1–S21) of Axis/TRACKER-AXIOM-EXECUTION-PLAN.md.
 *
 * setupTests.js mocks './utils/logger' globally; this file needs the REAL logger
 * (S4 duplicate contract, S14/S14b/S15/S16 ring-buffer replay) — so it unmocks it,
 * exactly like logger.test.js. The real logger fires initDone(1, 'Bundle loaded')
 * at import time (logger.js:647) — that record sits in the ring buffer and is the
 * replay fixture for S14.
 *
 * The sink module itself is inert here (vitest: import.meta.env.PROD === false →
 * ACTIVE false → module transport null), so tests inject a fake transport through
 * the pure-function seams (attachAxiomSink({ log, t }) / setAxiomContext(ctx, { t })).
 */
/* global globalThis */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    shouldShip,
    mapRecordToEvent,
    attachAxiomSink,
    setAxiomContext,
    isAxiomSinkActive,
} from '../axiomSink';
import logger from '../logger';

// Bypass the global logger mock from setupTests.js — vitest hoists vi.unmock above
// the transformed imports, so the whole module graph of this file (including
// axiomSink's own `import logger from './logger'`) gets the real one.
vi.unmock('../logger');

const REMOTE_KEY = 'axis:remoteLogLevel';

let consoleSpies;
let unsubs;

beforeEach(() => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
    unsubs = [];
    delete globalThis.__AXIS_AXIOM_SINK_ATTACHED__;
});

afterEach(() => {
    unsubs.forEach((u) => u());
    // reset the live remote-level module var + its persistence (S20 side effects)
    window.setRemoteLevel(null);
    localStorage.removeItem(REMOTE_KEY);
    delete globalThis.__AXIS_AXIOM_SINK_ATTACHED__;
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
});

/** Fake transport implementing the §3.1 surface the sink consumes. */
const makeFakeTransport = () => {
    const events = [];
    return {
        events,
        enqueue: vi.fn((e) => events.push(e)),
        setContext: vi.fn(),
        flush: vi.fn(),
        stats: vi.fn(() => ({ enabled: true })),
        dispose: vi.fn(),
    };
};

/** Attach with cleanup — every real-logger attach must unsubscribe between tests. */
const attach = (t, log = logger) => {
    const unsub = attachAxiomSink({ log, t });
    unsubs.push(unsub);
    return unsub;
};

const byMessage = (events, message) => events.filter((e) => e.message === message);

// =========================================================================
// shouldShip — §4.2 (S1–S5)
// =========================================================================
describe('shouldShip — level policy first, duplicate second (§4.2)', () => {
    it('S1: DEBUG never ships under the default policy (incl. api/apiResponse/functionStart kinds)', () => {
        expect(shouldShip({ level: 'DEBUG', kind: 'simple', module: 'X', message: 'm' })).toBe(false);
        expect(shouldShip({ level: 'DEBUG', kind: 'api', module: 'API', message: 'fetchItems' })).toBe(false);
        expect(shouldShip({ level: 'DEBUG', kind: 'apiResponse', module: 'API', message: 'fetchItems' })).toBe(false);
        expect(shouldShip({ level: 'DEBUG', kind: 'simple', module: 'FUNCTION', message: '▶️ f - Started' })).toBe(false);
    });

    it('S2: INFO ships only for kind init/initSummary', () => {
        expect(shouldShip({ level: 'INFO', kind: 'init', module: 'INIT', message: 'Bundle loaded' })).toBe(true);
        expect(shouldShip({ level: 'INFO', kind: 'initSummary', module: 'INIT', message: 'App fully interactive' })).toBe(true);
        expect(shouldShip({ level: 'INFO', kind: 'simple', module: 'X', message: 'm' })).toBe(false);
        expect(shouldShip({ level: 'INFO', module: 'X', message: 'no kind at all' })).toBe(false);
    });

    it('S3: WARN and ERROR always ship under the default policy', () => {
        expect(shouldShip({ level: 'WARN', kind: 'simple', module: 'X', message: 'm' })).toBe(true);
        expect(shouldShip({ level: 'ERROR', kind: 'error', module: 'X', message: 'm' })).toBe(true);
        expect(shouldShip({ level: 'ERROR', kind: 'apiError', module: 'API', message: 'fn' })).toBe(true);
    });

    it('S4: duplicate:true never ships, even at ERROR (redundant defense)', () => {
        expect(shouldShip({ level: 'ERROR', kind: 'error', module: 'X', message: 'm', duplicate: true })).toBe(false);
        expect(shouldShip({ level: 'WARN', kind: 'simple', module: 'X', message: 'm', duplicate: true })).toBe(false);
        // and remoteLevel does not resurrect a duplicate — level policy first, duplicate second
        expect(shouldShip({ level: 'ERROR', kind: 'error', module: 'X', message: 'm', duplicate: true }, 'DEBUG')).toBe(false);
    });

    it('S4 (real-logger contract): same Error instance logged twice → sinks fire once (pins logger.js:346-348)', () => {
        const spy = vi.fn();
        unsubs.push(logger.addSink(spy));
        const err = new Error('s4-dup-contract');
        logger.error('S4', 's4-first-pass', err);
        logger.error('S4', 's4-second-pass', err);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0].message).toBe('s4-first-pass');
        expect(spy.mock.calls[0][0].duplicate).toBe(false);
        // the withheld second record is still in the ring buffer, marked duplicate —
        // and the sink's redundant defense refuses it (real record shape)
        const second = logger.getBuffer().filter((r) => r.message === 's4-second-pass');
        expect(second).toHaveLength(1);
        expect(second[0].duplicate).toBe(true);
        expect(shouldShip(second[0])).toBe(false);
    });

    it('S5: remoteLevel overrides the default policy (rank comparison)', () => {
        // remoteLevel 'INFO' — kind whitelist bypassed: plain INFO ships, DEBUG does not
        expect(shouldShip({ level: 'INFO', kind: 'simple', module: 'X', message: 'm' }, 'INFO')).toBe(true);
        expect(shouldShip({ level: 'DEBUG', kind: 'simple', module: 'X', message: 'm' }, 'INFO')).toBe(false);
        expect(shouldShip({ level: 'WARN', kind: 'simple', module: 'X', message: 'm' }, 'INFO')).toBe(true);
        // remoteLevel 'DEBUG' — everything ships, including the prod DEBUG firehose kinds
        expect(shouldShip({ level: 'DEBUG', kind: 'api', module: 'API', message: 'fn' }, 'DEBUG')).toBe(true);
        // remoteLevel 'ERROR' — WARN filtered out
        expect(shouldShip({ level: 'WARN', kind: 'simple', module: 'X', message: 'm' }, 'ERROR')).toBe(false);
        expect(shouldShip({ level: 'ERROR', kind: 'error', module: 'X', message: 'm' }, 'ERROR')).toBe(true);
        // remoteLevel null — back to the default policy
        expect(shouldShip({ level: 'INFO', kind: 'simple', module: 'X', message: 'm' }, null)).toBe(false);
        expect(shouldShip({ level: 'INFO', kind: 'init', module: 'INIT', message: 'm' }, null)).toBe(true);
    });
});

// =========================================================================
// mapRecordToEvent — §4.3 (S6–S13)
// =========================================================================
describe('mapRecordToEvent — §4.3 mapping table, nothing else copied', () => {
    it('S6: tag ← String(record.module || "app").toLowerCase()', () => {
        expect(mapRecordToEvent({ level: 'ERROR', module: 'API', message: 'm' }).tag).toBe('api');
        expect(mapRecordToEvent({ level: 'ERROR', module: 'GlobalErrorHandler', message: 'm' }).tag).toBe('globalerrorhandler');
        expect(mapRecordToEvent({ level: 'ERROR', message: 'm' }).tag).toBe('app');
        expect(mapRecordToEvent({ level: 'ERROR', module: '', message: 'm' }).tag).toBe('app');
        expect(mapRecordToEvent({ level: 'ERROR', module: 'INIT', message: 'm' }).level).toBe('error');
    });

    it('S7: apiError fixture → err_name/err_code/stack1 present; query/rawResponse/variables/data ABSENT', () => {
        const err = new Error('complexity budget exhausted');
        err.name = 'MondayApiError';
        err.errorCode = 'ComplexityException';
        err.stack = 'MondayApiError: complexity budget exhausted\n    at safeApi (client.js:120:5)\n    at async fetchProjectsForUser (mondayApi.js:42:9)';
        const record = {
            kind: 'apiError',
            level: 'ERROR',
            module: 'API',
            message: 'fetchProjectsForUser',
            error: err,
            context: {
                query: 'query { boards(ids: [123]) { items_page { items { name } } } }',
                rawResponse: { errors: [{ message: 'Complexity budget exhausted' }] },
                variables: { userName: 'דנה' },
            },
            correlationId: 'log_7',
            consoleEnabled: true,
        };
        const ev = mapRecordToEvent(record);
        expect(ev).toEqual({
            level: 'error',
            tag: 'api',
            message: 'fetchProjectsForUser',
            kind: 'apiError',
            corr: 'log_7',
            err_name: 'MondayApiError',
            err_code: 'ComplexityException',
            stack1: 'at safeApi (client.js:120:5)',
        });
        // belt-and-braces absence assertions (toEqual above already pins the exact key set)
        const json = JSON.stringify(ev);
        expect(json).not.toContain('boards(ids');
        expect(json).not.toContain('Complexity budget exhausted'); // error.message / rawResponse
        expect(json).not.toContain('דנה');
    });

    it('S8: err_code fallback chain — errorCode ?? status ?? code', () => {
        expect(mapRecordToEvent({ level: 'ERROR', module: 'API', message: 'm', error: { name: 'E', status: 429 } }).err_code).toBe('429');
        expect(mapRecordToEvent({ level: 'ERROR', module: 'API', message: 'm', error: { name: 'E', code: 'ERR_NETWORK' } }).err_code).toBe('ERR_NETWORK');
        // errorCode wins over status
        expect(mapRecordToEvent({ level: 'ERROR', module: 'API', message: 'm', error: { name: 'E', errorCode: 'X', status: 500 } }).err_code).toBe('X');
        // none present → key omitted
        expect(mapRecordToEvent({ level: 'ERROR', module: 'API', message: 'm', error: { name: 'E' } })).not.toHaveProperty('err_code');
    });

    it('S9: stack1 = first frame line — V8 and Safari/Firefox fixtures, trimmed', () => {
        const v8 = mapRecordToEvent({
            level: 'ERROR', module: 'X', message: 'm',
            error: { name: 'Error', stack: 'Error: boom\n    at doThing (app.js:10:3)\n    at run (app.js:99:1)' },
        });
        expect(v8.stack1).toBe('at doThing (app.js:10:3)');
        const safari = mapRecordToEvent({
            level: 'ERROR', module: 'X', message: 'm',
            error: { name: 'Error', stack: 'doThing@https://cdn.monday.app/app.js:10:3\nglobal code@https://cdn.monday.app/app.js:99:1' },
        });
        expect(safari.stack1).toBe('doThing@https://cdn.monday.app/app.js:10:3');
        // frameless stack → key omitted
        expect(mapRecordToEvent({ level: 'ERROR', module: 'X', message: 'm', error: { name: 'Error', stack: 'Error: boom' } })).not.toHaveProperty('stack1');
        // V8 message line containing '@' is NOT a frame — the real frame wins
        // (a message-line '@' would leak error.message content, which is on the NEVER list)
        const emailMsg = mapRecordToEvent({
            level: 'ERROR', module: 'X', message: 'm',
            error: { name: 'Error', stack: 'Error: mail admin@twyst.co.il bounced\n    at notify (mailer.js:5:1)' },
        });
        expect(emailMsg.stack1).toBe('at notify (mailer.js:5:1)');
    });

    it('S10: record.data is never copied (names/emails stay out)', () => {
        const ev = mapRecordToEvent({
            level: 'WARN', kind: 'simple', module: 'X', message: 'm',
            data: { name: 'דנה', email: 'x@y.z' },
        });
        expect(ev).toEqual({ level: 'warn', tag: 'x', message: 'm', kind: 'simple' });
        expect(JSON.stringify(ev)).not.toContain('דנה');
        expect(JSON.stringify(ev)).not.toContain('x@y.z');
    });

    it('S11a: context.duration → ms (finite numbers only)', () => {
        const ev = mapRecordToEvent({
            level: 'DEBUG', kind: 'apiResponse', module: 'API', message: 'fetchItems',
            context: { response: { big: 'payload' }, duration: 412 },
        });
        expect(ev.ms).toBe(412);
        expect(ev).not.toHaveProperty('response');
        // non-finite dropped
        expect(mapRecordToEvent({ level: 'DEBUG', module: 'API', message: 'm', context: { duration: NaN } })).not.toHaveProperty('ms');
        expect(mapRecordToEvent({ level: 'DEBUG', module: 'API', message: 'm', context: { duration: Infinity } })).not.toHaveProperty('ms');
        expect(mapRecordToEvent({ level: 'DEBUG', module: 'API', message: 'm', context: { duration: '412' } })).not.toHaveProperty('ms');
    });

    it('S11b: initDone context.step → step; timeLabel never copied', () => {
        const ev = mapRecordToEvent({
            kind: 'init', level: 'INFO', module: 'INIT', message: 'Bundle loaded',
            context: { step: 1, timeLabel: '12:34:56' },
        });
        expect(ev.step).toBe(1);
        expect(ev).not.toHaveProperty('timeLabel');
        expect(JSON.stringify(ev)).not.toContain('12:34:56');
    });

    it('S11c: initSummary context.totalMs → total_ms (kept separate from ms); "?" dropped', () => {
        const ev = mapRecordToEvent({
            kind: 'initSummary', level: 'INFO', module: 'INIT', message: 'App fully interactive',
            context: { totalMs: 3120 },
        });
        expect(ev.total_ms).toBe(3120);
        expect(ev).not.toHaveProperty('ms');
        // logger.js:633 can emit totalMs = '?' — not a finite number → omitted
        expect(mapRecordToEvent({
            kind: 'initSummary', level: 'INFO', module: 'INIT', message: 'App fully interactive',
            context: { totalMs: '?' },
        })).not.toHaveProperty('total_ms');
    });

    it('S12: corr ← String(correlationId) when present; key OMITTED when absent (never "undefined")', () => {
        expect(mapRecordToEvent({ level: 'ERROR', module: 'X', message: 'm', correlationId: 42 }).corr).toBe('42');
        expect(mapRecordToEvent({ level: 'ERROR', module: 'X', message: 'm', correlationId: 'log_3' }).corr).toBe('log_3');
        const ev = mapRecordToEvent({ level: 'ERROR', module: 'X', message: 'm' });
        expect(ev).not.toHaveProperty('corr');
        expect(JSON.stringify(ev)).not.toContain('undefined');
    });

    it('S13: malformed records map without throwing; kind passes through', () => {
        expect(() => mapRecordToEvent({})).not.toThrow();
        expect(() => mapRecordToEvent(null)).not.toThrow();
        expect(() => mapRecordToEvent(undefined)).not.toThrow();
        expect(() => mapRecordToEvent({ error: 'not an Error object', context: 'not an object' })).not.toThrow();
        expect(() => mapRecordToEvent({ level: 5, module: 3, message: null, context: { step: 'one' } })).not.toThrow();
        expect(mapRecordToEvent({}).tag).toBe('app');
        expect(mapRecordToEvent({ level: 'INFO', kind: 'init', module: 'INIT', message: 'm' }).kind).toBe('init');
    });
});

// =========================================================================
// attachAxiomSink — §4.4 (S14–S18, injected fake transport + real logger)
// =========================================================================
describe('attachAxiomSink — registration + ring-buffer replay (§4.4)', () => {
    it('S14: replay ships the pre-attach initDone(1, "Bundle loaded") exactly once; live records once', () => {
        const fake = makeFakeTransport();
        attach(fake);
        // logger.js:647 fired at module import — replayed from the ring buffer
        const bundleLoaded = byMessage(fake.events, 'Bundle loaded');
        expect(bundleLoaded).toHaveLength(1);
        expect(bundleLoaded[0]).toEqual({
            level: 'info',
            tag: 'init',
            message: 'Bundle loaded',
            kind: 'init',
            step: 1,
        });
        // live record after attach ships exactly once (replay and addSink never overlap)
        logger.warn('S14', 's14-live-once');
        expect(byMessage(fake.events, 's14-live-once')).toHaveLength(1);
    });

    it('S14b: no record ships twice across the replay/addSink boundary (synchronous attach)', () => {
        logger.warn('S14b', 's14b-pre-attach');
        const fake = makeFakeTransport();
        attach(fake);
        expect(byMessage(fake.events, 's14b-pre-attach')).toHaveLength(1);
        logger.warn('S14b', 's14b-post-attach');
        expect(byMessage(fake.events, 's14b-pre-attach')).toHaveLength(1);   // still exactly once
        expect(byMessage(fake.events, 's14b-post-attach')).toHaveLength(1);
        // nothing in the shipped stream is duplicated
        const counts = fake.events.reduce((m, e) => {
            const k = `${e.level}|${e.tag}|${e.message}`;
            m[k] = (m[k] || 0) + 1;
            return m;
        }, {});
        expect(Object.values(counts).every((n) => n === 1)).toBe(true);
    });

    it('S15: replay respects shouldShip — pre-attach DEBUG/plain-INFO never ship', () => {
        logger.debug('S15', 's15-debug-buffered');
        logger.info('S15', 's15-info-buffered');
        logger.warn('S15', 's15-warn-buffered');
        const fake = makeFakeTransport();
        attach(fake);
        expect(byMessage(fake.events, 's15-debug-buffered')).toHaveLength(0);
        expect(byMessage(fake.events, 's15-info-buffered')).toHaveLength(0);
        expect(byMessage(fake.events, 's15-warn-buffered')).toHaveLength(1);
    });

    it('S16: globalThis guard already set (simulated HMR re-eval) → attach no-ops, no re-replay', () => {
        globalThis.__AXIS_AXIOM_SINK_ATTACHED__ = true;
        const fake = makeFakeTransport();
        const unsub = attach(fake);
        expect(typeof unsub).toBe('function');
        expect(() => unsub()).not.toThrow();
        expect(fake.enqueue).not.toHaveBeenCalled();          // no replay into a live transport
        logger.warn('S16', 's16-after-noop-attach');
        expect(fake.events).toHaveLength(0);                  // addSink was never called
    });

    it('S17: throwing transport is swallowed — one [axiom-sink] breadcrumb, next sink unaffected', () => {
        const throwing = {
            enqueue: vi.fn(() => { throw new Error('transport exploded'); }),
            setContext: vi.fn(), flush: vi.fn(), stats: vi.fn(), dispose: vi.fn(),
        };
        attach(throwing);
        const nextSink = vi.fn();
        unsubs.push(logger.addSink(nextSink));
        consoleSpies.error.mockClear();                       // ignore replay-time breadcrumbs
        logger.warn('S17', 's17-live-through-throwing-transport');
        // sink swallowed the throw → exactly one breadcrumb, and it is ours (not '[logger] sink threw')
        expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        expect(String(consoleSpies.error.mock.calls[0][0])).toMatch(/^\[axiom-sink\]/);
        // the next registered sink still received the record
        expect(nextSink).toHaveBeenCalledTimes(1);
        expect(nextSink.mock.calls[0][0].message).toBe('s17-live-through-throwing-transport');
    });

    it('S18: null transport → no-op unsubscribe, addSink never called, guard untouched', () => {
        const fakeLog = { getBuffer: vi.fn(() => []), addSink: vi.fn() };
        const unsub = attachAxiomSink({ log: fakeLog, t: null });
        expect(typeof unsub).toBe('function');
        expect(() => unsub()).not.toThrow();
        expect(fakeLog.addSink).not.toHaveBeenCalled();
        expect(fakeLog.getBuffer).not.toHaveBeenCalled();
        expect(globalThis.__AXIS_AXIOM_SINK_ATTACHED__).toBeUndefined();
        // default path: module transport is null in vitest (gate off) → same no-op
        const noop = attachAxiomSink();
        expect(typeof noop).toBe('function');
        expect(globalThis.__AXIS_AXIOM_SINK_ATTACHED__).toBeUndefined();
    });
});

// =========================================================================
// Context + window debug surface — §4.5 (S19–S21)
// =========================================================================
describe('setAxiomContext + window fns (§4.5)', () => {
    it('S19: setAxiomContext maps ids, obj = instanceId ?? boardId, partial calls leave others undefined', () => {
        const fake = makeFakeTransport();
        setAxiomContext({ accountId: 123, userId: 456, boardId: 789, instanceId: 111 }, { t: fake });
        // raw values pass through — String-coercion + merge are the transport's job
        expect(fake.setContext).toHaveBeenLastCalledWith({ acc: 123, usr: 456, obj: 111, board: 789 });
        // instanceId absent → obj falls back to boardId
        setAxiomContext({ accountId: 1, boardId: 22 }, { t: fake });
        expect(fake.setContext).toHaveBeenLastCalledWith({ acc: 1, usr: undefined, obj: 22, board: 22 });
        // partial merge: a late accountId-only call passes undefined for the rest
        // (transport merge semantics: undefined never clobbers)
        setAxiomContext({ accountId: 999 }, { t: fake });
        expect(fake.setContext).toHaveBeenLastCalledWith({ acc: 999, usr: undefined, obj: undefined, board: undefined });
        // degenerate calls never throw
        expect(() => setAxiomContext(undefined, { t: fake })).not.toThrow();
        expect(() => setAxiomContext()).not.toThrow();               // module transport null → no-op
        expect(() => setAxiomContext({ accountId: 5 })).not.toThrow();
    });

    it('S20: window.setRemoteLevel flips the live sink policy and persists to localStorage', () => {
        const fake = makeFakeTransport();
        attach(fake);
        logger.debug('S20', 's20-debug-default');
        expect(byMessage(fake.events, 's20-debug-default')).toHaveLength(0);

        window.setRemoteLevel('DEBUG');
        expect(localStorage.getItem(REMOTE_KEY)).toBe('DEBUG');
        logger.debug('S20', 's20-debug-remote');
        expect(byMessage(fake.events, 's20-debug-remote')).toHaveLength(1);

        // invalid level → rejected, state unchanged
        window.setRemoteLevel('BANANA');
        expect(localStorage.getItem(REMOTE_KEY)).toBe('DEBUG');
        logger.debug('S20', 's20-debug-still-remote');
        expect(byMessage(fake.events, 's20-debug-still-remote')).toHaveLength(1);

        // null clears persistence and restores the default policy
        window.setRemoteLevel(null);
        expect(localStorage.getItem(REMOTE_KEY)).toBeNull();
        logger.debug('S20', 's20-debug-cleared');
        expect(byMessage(fake.events, 's20-debug-cleared')).toHaveLength(0);
    });

    it('S21: gate fails in vitest → isAxiomSinkActive() false, getAxiomStats() {enabled:false}', () => {
        // import.meta.env.PROD === false here → ACTIVE false → module transport null
        expect(isAxiomSinkActive()).toBe(false);
        expect(typeof window.setRemoteLevel).toBe('function');
        expect(typeof window.getAxiomStats).toBe('function');
        expect(window.getAxiomStats()).toEqual({ enabled: false });
    });
});
