// test-guard gate for src/helpers/process-guards.js — the last-resort process
// nets + boot guards extracted from index.js. Every branch is exercised with
// injected flush/exit/setTimeout seams so the exit path is observed, never real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  flushAndExit,
  makeCrashHandler,
  makeServerErrorHandler,
  readPackageVersion,
  safeBootInit,
} from '../src/helpers/process-guards.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A logger double exposing only the server logger surface these helpers touch. */
function fakeLogger() {
  return { logError: vi.fn() };
}

describe('flushAndExit', () => {
  it('awaits flush, then exits exactly once with the given code', async () => {
    const flush = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    // setTimeoutFn returns an object with unref so the belt-and-suspenders timer is inert here.
    const setTimeoutFn = vi.fn(() => ({ unref: vi.fn() }));

    flushAndExit(7, { flush, exit, setTimeoutFn });
    await tick();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(7);
  });

  it('still exits once when flush REJECTS (a broken sink never blocks the exit)', async () => {
    const flush = vi.fn(() => Promise.reject(new Error('sink down')));
    const exit = vi.fn();

    flushAndExit(1, { flush, exit, setTimeoutFn: () => ({ unref: vi.fn() }) });
    await tick();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits via the timeout ceiling when flush never settles, and only once', async () => {
    let timerCb;
    const setTimeoutFn = vi.fn((cb, ms) => {
      timerCb = cb;
      expect(ms).toBe(2000); // hard ceiling
      return { unref: vi.fn() };
    });
    const flush = vi.fn(() => new Promise(() => {})); // never resolves
    const exit = vi.fn();

    flushAndExit(1, { flush, exit, setTimeoutFn });
    await tick();
    expect(exit).not.toHaveBeenCalled(); // flush pending, ceiling not yet fired

    timerCb(); // ceiling fires
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('unrefs the ceiling timer so it cannot keep the dying process alive', () => {
    const unref = vi.fn();
    const setTimeoutFn = vi.fn(() => ({ unref }));
    flushAndExit(1, { flush: () => new Promise(() => {}), exit: vi.fn(), setTimeoutFn });
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('does not double-exit when both flush resolves and the timer fires', async () => {
    let timerCb;
    const setTimeoutFn = vi.fn((cb) => {
      timerCb = cb;
      return { unref: vi.fn() };
    });
    const exit = vi.fn();
    flushAndExit(3, { flush: () => Promise.resolve(), exit, setTimeoutFn });
    await tick();
    timerCb(); // late timer must be a no-op after the flush-path exit
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(3);
  });
});

describe('makeCrashHandler (uncaughtException net)', () => {
  it("ships an ERROR tagged 'server'/'uncaught exception' carrying the Error, then exits 1", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    const boom = new Error('kaboom');

    makeCrashHandler(logger, { flush: () => Promise.resolve(), exit, setTimeoutFn: () => ({ unref: vi.fn() }) })(boom);
    await tick();

    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError).toHaveBeenCalledWith('server', 'uncaught exception', { error: boom });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('coerces a non-Error rejection reason into an Error before logging', async () => {
    const logger = fakeLogger();
    makeCrashHandler(logger, { flush: () => Promise.resolve(), exit: vi.fn(), setTimeoutFn: () => ({ unref: vi.fn() }) })('plain string');
    await tick();
    const arg = logger.logError.mock.calls[0][2].error;
    expect(arg).toBeInstanceOf(Error);
    expect(arg.message).toBe('plain string');
  });

  it('exits 1 even when the logger itself throws', async () => {
    const logger = { logError: vi.fn(() => { throw new Error('logger down'); }) };
    const exit = vi.fn();
    makeCrashHandler(logger, { flush: () => Promise.resolve(), exit, setTimeoutFn: () => ({ unref: vi.fn() }) })(new Error('x'));
    await tick();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('makeServerErrorHandler (listen-time net)', () => {
  it("ships 'server listen error' with the error's .code and exits 1", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    const err = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' });

    makeServerErrorHandler(logger, { flush: () => Promise.resolve(), exit, setTimeoutFn: () => ({ unref: vi.fn() }) })(err);
    await tick();

    expect(logger.logError).toHaveBeenCalledWith('server', 'server listen error', { error: err, code: 'EADDRINUSE' });
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('readPackageVersion', () => {
  it('returns the parsed version string on a good read', () => {
    const readFileSync = vi.fn(() => JSON.stringify({ version: '9.9.9' }));
    expect(readPackageVersion({ readFileSync, url: 'x' })).toBe('9.9.9');
    expect(readFileSync).toHaveBeenCalledWith('x', 'utf8');
  });

  it('returns the fallback and calls onError (no throw) when the read throws', () => {
    const onError = vi.fn();
    const version = readPackageVersion({
      readFileSync: () => { throw new Error('ENOENT'); },
      url: 'missing',
      fallback: '0.0.0',
      onError,
    });
    expect(version).toBe('0.0.0');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('returns the fallback when the parsed JSON has no version field', () => {
    const readFileSync = vi.fn(() => JSON.stringify({ name: 'x' }));
    expect(readPackageVersion({ readFileSync, url: 'x', fallback: '1.2.3' })).toBe('1.2.3');
  });

  it('writes a console breadcrumb (never an empty catch) when no onError is given', () => {
    readPackageVersion({ readFileSync: () => { throw new Error('corrupt'); }, url: 'x' });
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('safeBootInit', () => {
  /**
   * Await `fn()` and report the outcome as DATA rather than letting it propagate.
   * Deliberate: safeBootInit's contract is "the flush finishes, THEN it rejects", and a
   * regression to a synchronous throw must surface as a failed assertion about ordering —
   * not as a raw exception escaping the test, which proves nothing about behavior.
   */
  async function settle(fn) {
    try {
      return { outcome: 'resolved', value: await fn() };
    } catch (err) {
      return { outcome: 'rejected', message: err?.message };
    }
  }

  it('returns the initializer result on success without touching logger or exit', async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    const backend = { marker: 'ok' };
    const result = await settle(() => safeBootInit(() => backend, 'storage backend init', logger, { exit }));
    expect(result).toEqual({ outcome: 'resolved', value: backend });
    expect(logger.logError).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('on init throw: ships a boot-failed ERROR, exits 1, and re-throws', async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    const boom = new Error('secrets missing');

    const result = await settle(() =>
      safeBootInit(() => { throw boom; }, 'storage backend init', logger, {
        flush: () => Promise.resolve(),
        exit,
        setTimeoutFn: () => ({ unref: vi.fn() }),
      })
    );

    expect(result).toEqual({ outcome: 'rejected', message: 'secrets missing' });
    expect(logger.logError).toHaveBeenCalledWith('server', 'boot failed: storage backend init', { error: boom });
    expect(exit).toHaveBeenCalledWith(1);
  });

  // The bug this guards (audit finding 3): the old implementation scheduled the flush
  // asynchronously and then threw SYNCHRONOUSLY. safeBootInit runs BEFORE
  // installProcessGuards in index.js, so that throw is an uncaught top-level exception —
  // Node dumps to stderr and exits immediately, and the pending flush never runs. The
  // boot failure the guard exists to capture was exactly the one that never reached Axiom.
  it('completes the remote flush BEFORE re-throwing (a boot failure can never be lost)', async () => {
    const logger = fakeLogger();
    const order = [];
    const flush = vi.fn(() => { order.push('flush'); return Promise.resolve(); });
    const exit = vi.fn(() => { order.push('exit'); });

    const result = await settle(() =>
      safeBootInit(() => { throw new Error('secrets missing'); }, 'storage backend init', logger, {
        flush,
        exit,
        setTimeoutFn: () => ({ unref: vi.fn() }),
      })
    );

    // Ordering IS the contract: the failure becomes observable only after flush+exit ran.
    // A synchronous throw leaves this []; the flush would land after the process is gone.
    expect(order).toEqual(['flush', 'exit']);
    expect(result).toEqual({ outcome: 'rejected', message: 'secrets missing' });
  });

  it('re-throws even when the flush REJECTS — a broken sink must not turn a boot failure into a silent start', async () => {
    const logger = fakeLogger();
    const order = [];
    const exit = vi.fn(() => { order.push('exit'); });

    const result = await settle(() =>
      safeBootInit(() => { throw new Error('secrets missing'); }, 'storage backend init', logger, {
        flush: () => Promise.reject(new Error('sink down')),
        exit,
        setTimeoutFn: () => ({ unref: vi.fn() }),
      })
    );

    expect(order).toEqual(['exit']);
    expect(result).toEqual({ outcome: 'rejected', message: 'secrets missing' });
  });
});
