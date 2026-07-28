// test-guard gate for the vendored global error handler (telemetry-dashboard client).
// Mirrors apps/deadline-confirm's copy of this suite — the vendored sources are
// behaviorally identical, and packages/error-kit/test/drift.test.ts enforces that across
// surfaces. Plain JS (not TS) because this app's vitest config collects test/**/*.test.js
// only; vitest still transforms the imported .ts module.
// every global failure
// channel (uncaught error, unhandled rejection, capture-phase resource error)
// must route into the injected logger; a chunk handler consumes matching errors;
// installation is idempotent per window.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupGlobalErrorHandlers, setChunkErrorHandler } from '../src/client/utils/globalErrorHandler.ts';

function fakeWin() {
  const listeners = [];
  const win = {
    listeners,
    __errorGuardHandlersInstalled: undefined,
    addEventListener(type, fn, opts) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
      listeners.push({ type, fn, capture });
    },
    dispatch(type, event, capture = false) {
      for (const l of listeners) if (l.type === type && l.capture === capture) l.fn(event);
    },
  };
  return win;
}

function fakeLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

afterEach(() => {
  setChunkErrorHandler(null); // module-level state must not leak between tests
});

describe('setupGlobalErrorHandlers', () => {
  it("routes an uncaught (bubble-phase) 'error' event to logger.error('UncaughtError', ...) with the error object", () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    const boom = new Error('render blew up');
    win.dispatch('error', { error: boom }, false);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('UncaughtError', 'Global error caught', boom);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("routes 'unhandledrejection' to logger.error('UnhandledPromiseRejection', ...) with the reason", () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    const reason = new Error('promise rejected');
    win.dispatch('unhandledrejection', { reason });

    expect(logger.error).toHaveBeenCalledWith('UnhandledPromiseRejection', 'Global error caught', reason);
  });

  it("routes a capture-phase resource-load failure to logger.WARN with the url+tag (never error)", () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    win.dispatch('error', { target: { tagName: 'SCRIPT', src: 'https://cdn/x.js' } }, true);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    // url + tag ride the Error's message, NOT a `{ url, tag }` object (audit finding 1):
    // a plain object lands in record.data, which the sink never copies and the transport
    // allowlist does not carry, so the failed URL could not reach the dataset.
    const [mod, msg, payload] = logger.warn.mock.calls[0];
    expect(mod).toBe('globalErrorHandler');
    expect(msg).toBe('Resource failed to load');
    expect(payload).toBeInstanceOf(Error);
    expect(payload.message).toContain('https://cdn/x.js');
    expect(payload.message).toContain('SCRIPT');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('ignores a capture-phase event whose target is not a SCRIPT/LINK/IMG (no log)', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    win.dispatch('error', { target: { tagName: 'DIV' } }, true);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a chunk handler that returns true consumes the rejection: preventDefault called, no logger.error', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    const handleChunkError = vi.fn(() => true);
    setupGlobalErrorHandlers(logger, { win, handleChunkError });

    const preventDefault = vi.fn();
    win.dispatch('unhandledrejection', { reason: new Error('ChunkLoadError'), preventDefault });

    expect(handleChunkError).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('is idempotent per window: a second setup on the same window registers no new listeners', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    const countAfterFirst = win.listeners.length;
    setupGlobalErrorHandlers(logger, { win });

    expect(win.listeners.length).toBe(countAfterFirst);
    expect(win.__errorGuardHandlersInstalled).toBe(true);
  });
});

// Audit finding 2: the sink reads err_name/err_msg/stack off record.error only when it is
// an object carrying those fields. A non-Error rejection reason therefore shipped NOTHING,
// and an `event.error` of null — what a cross-origin script failure delivers — produced a
// report with no retrievable content while still costing an Axiom write.
describe('setupGlobalErrorHandlers — every reported error carries retrievable content', () => {
  it('normalizes a STRING rejection reason into an Error carrying the text', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    win.dispatch('unhandledrejection', { reason: 'token refresh failed' });

    const payload = logger.error.mock.calls[0][2];
    expect(payload).toBeInstanceOf(Error);
    expect(payload.message).toBe('token refresh failed');
  });

  it('serializes a non-Error OBJECT reason and keeps its name for grouping', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    win.dispatch('unhandledrejection', { reason: { name: 'QuotaExceededError', status: 507 } });

    const payload = logger.error.mock.calls[0][2];
    expect(payload).toBeInstanceOf(Error);
    expect(payload.name).toBe('QuotaExceededError');
    expect(payload.message).toContain('507');
  });

  it('reads event.message when event.error is null (the cross-origin "Script error." case)', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });

    win.dispatch('error', { error: null, message: 'Script error.', target: win });

    const payload = logger.error.mock.calls[0][2];
    expect(payload).toBeInstanceOf(Error);
    expect(payload.message).toBe('Script error.');
  });

  it('passes a real Error through as the SAME instance (log-once brands the instance)', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    const original = new Error('genuine failure');

    win.dispatch('unhandledrejection', { reason: original });

    expect(logger.error.mock.calls[0][2]).toBe(original);
  });

  it('survives a reason whose serialization throws, and records that it could not describe it', () => {
    const win = fakeWin();
    const logger = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    const circular = {};
    circular.self = circular;
    // A hostile toJSON is the case that must not take the handler down.
    Object.defineProperty(circular, 'toJSON', { value: () => { throw new Error('hostile'); } });

    win.dispatch('unhandledrejection', { reason: circular });

    const payload = logger.error.mock.calls[0][2];
    expect(payload).toBeInstanceOf(Error);
    expect(payload.message.length).toBeGreaterThan(0);
    // never a silent catch — the describe failure leaves a WARN behind
    expect(logger.warn).toHaveBeenCalled();
  });
});
