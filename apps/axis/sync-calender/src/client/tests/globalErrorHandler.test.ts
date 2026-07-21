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
    expect(logger.warn).toHaveBeenCalledWith('globalErrorHandler', 'Resource failed to load', {
      url: 'https://cdn/x.js',
      tag: 'SCRIPT',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('is idempotent for a window already flagged installed (no duplicate listeners)', () => {
    setupGlobalErrorHandlers(logger, { win }); // win.__errorGuardHandlersInstalled is set
    expect(listeners).toHaveLength(3);
  });
});
