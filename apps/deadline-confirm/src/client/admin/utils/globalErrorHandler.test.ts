// test-guard gate for the vendored global error handler: every global failure
// channel (uncaught error, unhandled rejection, capture-phase resource error)
// must route into the injected logger; a chunk handler consumes matching errors;
// installation is idempotent per window.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupGlobalErrorHandlers, setChunkErrorHandler } from './globalErrorHandler';

interface Listener {
  type: string;
  fn: (e: unknown) => void;
  capture: boolean;
}

function fakeWin() {
  const listeners: Listener[] = [];
  const win = {
    listeners,
    __errorGuardHandlersInstalled: undefined as boolean | undefined,
    addEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
      listeners.push({ type, fn, capture });
    },
    dispatch(type: string, event: unknown, capture = false) {
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
    expect(logger.warn).toHaveBeenCalledWith('globalErrorHandler', 'Resource failed to load', {
      url: 'https://cdn/x.js',
      tag: 'SCRIPT',
    });
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
