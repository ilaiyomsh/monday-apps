/**
 * Behavior tests — NETWORK ERROR monitoring contract.
 *
 * Contract:
 *   (error-handling-standard.md §3.2 "אפס בליעה שקטה") every error in a catch/handler
 *   reaches the logger; and (plan §3.1 "שגיאה אחת = רשומה אחת לסינק") it reaches the
 *   central sink EXACTLY ONCE — even though it travels through the global handler and
 *   then the user-facing surfacing path.
 *
 * The case that matters most for a Monday board-view: the SDK rejects with a PLAIN
 * OBJECT (not an Error instance) carrying `response.errors`. That object must still be
 * monitored once and surfaced. These assertions come from the desired contract; if the
 * object is dropped (0 records), double-logged (2 records), or not surfaced, the test
 * fails.
 *
 * setupTests.js mocks './utils/logger' globally; this file needs the REAL logger to
 * observe fan-out to a sink, so it opts out with vi.unmock (hoisted above imports).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../logger';
import { setupGlobalErrorHandlers, handleGlobalError } from '../globalErrorHandler';

vi.unmock('../logger');

// Silence the dev-console rendering emit does, so the test output stays clean.
let consoleSpies;
const installConsoleSpies = () => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
};
const restoreConsoleSpies = () => Object.values(consoleSpies).forEach((s) => s.mockRestore());

// Track + remove window listeners so setupGlobalErrorHandlers doesn't leak across files.
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
    addedListeners.forEach(({ type, handler, options }) => window.removeEventListener(type, handler, options));
    addedListeners = [];
};

let sinkSpy;
let unsubSink;

beforeEach(() => {
    installConsoleSpies();
    trackWindowListeners();
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
 * Sink records that carry THIS specific error object — whether the logger placed it in
 * record.error (Error instance) or record.data (plain object). One match === logged once.
 */
const sinkRecordsFor = (obj) =>
    sinkSpy.mock.calls.map((c) => c[0]).filter((rec) => rec.error === obj || rec.data === obj);

/**
 * A faithful stand-in for the log-only showErrorWithDetails facade (ui-sink-plan.md
 * Phase 1): per the log-once contract it logs ONLY if the error has not been logged
 * already. The actual user-facing toast is rendered by the UI sink listening to the
 * logger — surfacing == the record reaching the sink exactly once.
 */
const facadeLogOnly = (e) => {
    const alreadyLogged = e && e.__loggedId !== undefined;
    if (!alreadyLogged) logger.error('showErrorWithDetails', 'surfacing fallback log', e);
};

describe('network error monitoring — plain-object Monday errors reach the sink once and are surfaced', () => {
    it('handleGlobalError(plainObject): logged to the sink exactly once (facade skips re-log)', () => {
        // The shape the Monday SDK throws — a PLAIN OBJECT, not an Error instance.
        const mondayErr = {
            message: 'Graphql validation errors',
            response: { errors: [{ message: 'no permission' }] },
        };

        handleGlobalError(mondayErr, { functionName: 'GlobalErrorHandler' });
        // A downstream caller invoking the facade must not add a second record —
        // the global handler logged and stamped it (log-once holds for plain
        // objects, not only Error instances).
        facadeLogOnly(mondayErr);

        // Reached the central sink exactly once == surfaced by the UI sink once.
        expect(sinkRecordsFor(mondayErr).length).toBe(1);
    });

    it('unhandledrejection with a plain-object Monday reason → sink gets exactly one record', () => {
        setupGlobalErrorHandlers();

        const mondayErr = {
            message: 'Graphql validation errors',
            response: { errors: [{ message: 'rate limited' }] },
        };
        const rejected = Promise.reject(mondayErr);
        rejected.catch(() => {}); // avoid a real unhandled rejection in the test runner

        window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
            promise: rejected,
            reason: mondayErr,
        }));

        expect(sinkRecordsFor(mondayErr).length).toBe(1);
    });
});
