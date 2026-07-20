/**
 * globalErrorHandler.test.ts — the capture-phase resource listener, idempotency guard,
 * and log routing adopted from team-people-column. Node env, injected `win` seam (no jsdom).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupGlobalErrorHandlers, setChunkErrorHandler } from '../src/browser/globalErrorHandler';
import type { Logger } from '../src/types';

interface Registered {
  type: string;
  cb: (event: unknown) => void;
  capture: boolean;
}

function fakeWin() {
  const registered: Registered[] = [];
  const win = {
    __errorGuardHandlersInstalled: undefined as boolean | undefined,
    addEventListener(type: string, cb: (event: unknown) => void, opts?: boolean | { capture?: boolean }) {
      const capture = opts === true || (typeof opts === 'object' && opts?.capture === true);
      registered.push({ type, cb, capture });
    },
  };
  // Deliver an event to listeners of `type` in the given phase: 'capture' → capture
  // listeners only (resource errors never bubble); 'bubble' → non-capture listeners.
  function emit(type: string, event: unknown, phase: 'capture' | 'bubble' = 'bubble') {
    for (const l of registered) {
      if (l.type !== type) continue;
      if (phase === 'capture' ? l.capture : !l.capture) l.cb(event);
    }
  }
  return { win, registered, emit };
}

function fakeLogger() {
  const calls: Array<{ level: string; module: string; message: string; payload?: unknown; context?: unknown }> = [];
  const mk = (level: string) => (module: string, message: string, payload?: unknown, context?: unknown) =>
    calls.push({ level, module, message, payload, context });
  const logger = { debug: mk('DEBUG'), info: mk('INFO'), warn: mk('WARN'), error: mk('ERROR'), addSink: () => () => {}, getBuffer: () => [] } as unknown as Logger;
  return { logger, calls };
}

beforeEach(() => {
  setChunkErrorHandler(null);
});

describe('setupGlobalErrorHandlers — registration', () => {
  it('registers exactly one capture-phase error listener plus bubble error + unhandledrejection', () => {
    const { win, registered } = fakeWin();
    const { logger } = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    const errorListeners = registered.filter((r) => r.type === 'error');
    expect(errorListeners).toHaveLength(2);
    expect(errorListeners.filter((r) => r.capture)).toHaveLength(1); // resource capture listener
    expect(errorListeners.filter((r) => !r.capture)).toHaveLength(1); // bubble uncaught-error listener
    expect(registered.filter((r) => r.type === 'unhandledrejection')).toHaveLength(1);
  });

  it('is idempotent: a second call registers no additional listeners', () => {
    const { win, registered } = fakeWin();
    const { logger } = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    setupGlobalErrorHandlers(logger, { win });
    expect(registered).toHaveLength(3);
    expect(win.__errorGuardHandlersInstalled).toBe(true);
  });

  it('does nothing when there is no window and no seam', () => {
    const { logger, calls } = fakeLogger();
    expect(() => setupGlobalErrorHandlers(logger, {})).not.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('setupGlobalErrorHandlers — routing', () => {
  it('logs a resource-load failure at WARN with url + tag (capture phase)', () => {
    const { win, emit } = fakeWin();
    const { logger, calls } = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    emit('error', { target: { tagName: 'IMG', src: 'https://cdn.example.com/logo.png' } }, 'capture');
    expect(calls).toHaveLength(1);
    expect(calls[0].level).toBe('WARN');
    expect(calls[0].module).toBe('globalErrorHandler');
    expect(calls[0].payload).toEqual({ url: 'https://cdn.example.com/logo.png', tag: 'IMG' });
  });

  it('ignores a capture-phase error whose target is the window itself (that is the bubble listener\'s job)', () => {
    const { win, emit } = fakeWin();
    const { logger, calls } = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    emit('error', { target: win, error: new Error('real js error') }, 'capture');
    expect(calls).toHaveLength(0);
  });

  it('logs an uncaught JS error (bubble phase) at ERROR with the error payload', () => {
    const { win, emit } = fakeWin();
    const { logger, calls } = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    const err = new Error('kaboom');
    emit('error', { target: win, error: err, message: 'kaboom' }, 'bubble');
    expect(calls).toHaveLength(1);
    expect(calls[0].level).toBe('ERROR');
    expect(calls[0].module).toBe('UncaughtError');
    expect(calls[0].payload).toBe(err);
  });

  it('logs an unhandled rejection at ERROR with the reason as payload', () => {
    const { win, emit } = fakeWin();
    const { logger, calls } = fakeLogger();
    setupGlobalErrorHandlers(logger, { win });
    const reason = new Error('rejected');
    emit('unhandledrejection', { reason });
    expect(calls).toHaveLength(1);
    expect(calls[0].level).toBe('ERROR');
    expect(calls[0].module).toBe('UnhandledPromiseRejection');
    expect(calls[0].payload).toBe(reason);
  });

  it('a wired chunk handler consumes a resource failure: preventDefault called, nothing logged', () => {
    const { win, emit } = fakeWin();
    const { logger, calls } = fakeLogger();
    const preventDefault = vi.fn();
    setupGlobalErrorHandlers(logger, { win, handleChunkError: () => true });
    emit('error', { target: { tagName: 'SCRIPT', src: 'https://cdn.example.com/chunk-9f.js' }, preventDefault }, 'capture');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('a throwing chunk handler is caught: falls back to WARN breadcrumb + normal logging (no swallow)', () => {
    const { win, emit } = fakeWin();
    const { logger, calls } = fakeLogger();
    setupGlobalErrorHandlers(logger, {
      win,
      handleChunkError: () => {
        throw new Error('handler broke');
      },
    });
    emit('error', { target: win, error: new Error('boom'), message: 'boom' }, 'bubble');
    // one WARN for the broken handler, then the ERROR for the original error — never swallowed
    expect(calls.map((c) => c.level)).toEqual(['WARN', 'ERROR']);
    expect(calls[1].module).toBe('UncaughtError');
  });
});
