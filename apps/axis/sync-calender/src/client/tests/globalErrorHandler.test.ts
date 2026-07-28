import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupGlobalErrorHandlers, type GlobalErrorWindowLike } from '../admin/utils/globalErrorHandler';
import type { Logger } from '../admin/lib/logger';

interface Registered {
  type: string;
  fn: (e: unknown) => void;
  capture: boolean;
}

function makeWin() {
  const listeners: Registered[] = [];
  const win: GlobalErrorWindowLike = {
    addEventListener(type, fn, opts) {
      const capture = opts === true || (typeof opts === 'object' && opts !== null && opts.capture === true);
      listeners.push({ type, fn, capture });
    },
  };
  return { win, listeners };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    track: vi.fn(),
    health: vi.fn(),
    addSink: vi.fn(() => () => {}),
    removeSink: vi.fn(),
    getBuffer: vi.fn(() => []),
  };
}

describe('setupGlobalErrorHandlers', () => {
  let logger: Logger;
  let win: GlobalErrorWindowLike;
  let listeners: Registered[];

  beforeEach(() => {
    logger = makeLogger();
    ({ win, listeners } = makeWin());
    setupGlobalErrorHandlers(logger, { win });
  });

  it('registers exactly three listeners (capture error, bubble error, unhandledrejection)', () => {
    expect(listeners).toHaveLength(3);
    expect(listeners.filter((l) => l.type === 'error' && l.capture)).toHaveLength(1);
    expect(listeners.filter((l) => l.type === 'error' && !l.capture)).toHaveLength(1);
    expect(listeners.filter((l) => l.type === 'unhandledrejection')).toHaveLength(1);
  });

  it('routes an unhandled promise rejection to logger.error', () => {
    const rej = listeners.find((l) => l.type === 'unhandledrejection')!;
    const reason = new Error('rejected');
    rej.fn({ reason });
    expect(logger.error).toHaveBeenCalledWith('UnhandledPromiseRejection', 'Global error caught', reason);
  });

  it('routes an uncaught error (bubble phase, target=window) to logger.error', () => {
    const bubble = listeners.find((l) => l.type === 'error' && !l.capture)!;
    const error = new Error('uncaught');
    bubble.fn({ error });
    expect(logger.error).toHaveBeenCalledWith('UncaughtError', 'Global error caught', error);
  });

  it('routes a resource-load failure (capture phase) to logger.warn with url + tag, not error', () => {
    const capture = listeners.find((l) => l.type === 'error' && l.capture)!;
    capture.fn({ target: { tagName: 'SCRIPT', src: 'https://cdn/x.js' }, preventDefault() {} });
    // url + tag ride the Error's message, NOT a `{ url, tag }` object (audit finding 1):
    // a plain object lands in record.data, which the sink never copies (privacy) and the
    // transport allowlist does not carry — so the failed URL could not reach the dataset.
    const [mod, msg, payload] = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(mod).toBe('globalErrorHandler');
    expect(msg).toBe('Resource failed to load');
    expect(payload).toBeInstanceOf(Error);
    expect((payload as Error).message).toContain('https://cdn/x.js');
    expect((payload as Error).message).toContain('SCRIPT');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('is idempotent for a window already flagged installed (no duplicate listeners)', () => {
    setupGlobalErrorHandlers(logger, { win }); // win.__errorGuardHandlersInstalled is set
    expect(listeners).toHaveLength(3);
  });

  // Audit finding 2: the sink reads err_name/err_msg/stack off record.error only when it
  // is an object carrying those fields, so a non-Error rejection reason shipped NOTHING,
  // and an `event.error` of null — what a cross-origin script failure delivers — produced
  // a report with no retrievable content while still costing an Axiom write.
  describe('every reported error carries retrievable content', () => {
    const errorCalls = () => (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;

    it('normalizes a STRING rejection reason into an Error carrying the text', () => {
      const rejection = listeners.find((l) => l.type === 'unhandledrejection')!;
      rejection.fn({ reason: 'token refresh failed' });
      const payload = errorCalls()[0][2];
      expect(payload).toBeInstanceOf(Error);
      expect((payload as Error).message).toBe('token refresh failed');
    });

    it('serializes a non-Error OBJECT reason and keeps its name for grouping', () => {
      const rejection = listeners.find((l) => l.type === 'unhandledrejection')!;
      rejection.fn({ reason: { name: 'QuotaExceededError', status: 507 } });
      const payload = errorCalls()[0][2] as Error;
      expect(payload.name).toBe('QuotaExceededError');
      expect(payload.message).toContain('507');
    });

    it('reads event.message when event.error is null (the cross-origin "Script error." case)', () => {
      const bubble = listeners.find((l) => l.type === 'error' && !l.capture)!;
      bubble.fn({ error: null, message: 'Script error.', target: win });
      const payload = errorCalls()[0][2] as Error;
      expect(payload).toBeInstanceOf(Error);
      expect(payload.message).toBe('Script error.');
    });

    it('passes a real Error through as the SAME instance (log-once brands the instance)', () => {
      const rejection = listeners.find((l) => l.type === 'unhandledrejection')!;
      const original = new Error('genuine failure');
      rejection.fn({ reason: original });
      expect(errorCalls()[0][2]).toBe(original);
    });

    it('survives a reason whose serialization throws, and records that it could not describe it', () => {
      const rejection = listeners.find((l) => l.type === 'unhandledrejection')!;
      const hostile: Record<string, unknown> = {};
      Object.defineProperty(hostile, 'toJSON', { value: () => { throw new Error('hostile'); } });
      rejection.fn({ reason: hostile });
      const payload = errorCalls()[0][2] as Error;
      expect(payload).toBeInstanceOf(Error);
      expect(payload.message.length).toBeGreaterThan(0);
      expect(logger.warn).toHaveBeenCalled(); // never a silent catch
    });
  });
});
