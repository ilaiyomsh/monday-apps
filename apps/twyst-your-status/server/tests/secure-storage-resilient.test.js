import { describe, it, expect, vi } from 'vitest';
import {
  isTransientStorageError,
  createResilientSecureStorage,
} from '../src/helpers/secure-storage-resilient.js';

const noSleep = () => Promise.resolve();
const wrap = (inner, over = {}) =>
  createResilientSecureStorage(inner, { retries: 3, delayMs: 1, sleep: noSleep, ...over });

describe('isTransientStorageError', () => {
  it('matches the live Vault-login HTML-body signature', () => {
    const err = new Error(
      'invalid json response body at https://vault-server-apps-x.a.run.app/v1/auth/gcp/login reason: Unexpected token \'<\'',
    );
    expect(isTransientStorageError(err)).toBe(true);
  });

  it('matches the SDK "accessing secure storage" wrapper', () => {
    expect(isTransientStorageError(new Error('An issue occurred while accessing secure storage'))).toBe(true);
  });

  it('does NOT match an unrelated error (which must not be retried)', () => {
    expect(isTransientStorageError(new Error('ColumnValueException: bad value'))).toBe(false);
    expect(isTransientStorageError(null)).toBe(false);
  });
});

describe('createResilientSecureStorage — retry', () => {
  it('retries a transient get failure and succeeds on a later attempt', async () => {
    const inner = {
      get: vi.fn()
        .mockRejectedValueOnce(new Error('An issue occurred while accessing secure storage'))
        .mockResolvedValueOnce({ value: 'ok' }),
      set: vi.fn(),
    };
    const store = wrap(inner);

    await expect(store.get('k')).resolves.toEqual({ value: 'ok' });
    expect(inner.get).toHaveBeenCalledTimes(2);
  });

  it('rethrows after exhausting retries on a persistent transient failure', async () => {
    const inner = {
      get: vi.fn().mockRejectedValue(new Error('vault-server unreachable')),
      set: vi.fn(),
    };
    const store = wrap(inner);

    await expect(store.get('k')).rejects.toThrow(/vault-server/);
    expect(inner.get).toHaveBeenCalledTimes(3); // retries = 3
  });

  it('does NOT retry a non-transient error — it rethrows immediately', async () => {
    const inner = {
      get: vi.fn().mockRejectedValue(new Error('programmer error: bad key type')),
      set: vi.fn(),
    };
    const store = wrap(inner);

    await expect(store.get('k')).rejects.toThrow(/programmer error/);
    expect(inner.get).toHaveBeenCalledTimes(1); // no retry
  });

  it('retries set on a transient failure too', async () => {
    const inner = {
      get: vi.fn(),
      set: vi.fn()
        .mockRejectedValueOnce(new Error('accessing secure storage'))
        .mockResolvedValueOnce(undefined),
    };
    const store = wrap(inner);

    await store.set('k', { v: 1 });
    expect(inner.set).toHaveBeenCalledTimes(2);
    expect(inner.set).toHaveBeenLastCalledWith('k', { v: 1 });
  });
});

describe('createResilientSecureStorage — in-flight get coalescing', () => {
  it('collapses concurrent reads of the SAME key into ONE inner get', async () => {
    let resolveInner;
    const inner = {
      get: vi.fn(() => new Promise((r) => { resolveInner = r; })),
      set: vi.fn(),
    };
    const store = wrap(inner);

    const a = store.get('same');
    const b = store.get('same');
    expect(inner.get).toHaveBeenCalledTimes(1); // coalesced

    resolveInner({ value: 'shared' });
    await expect(a).resolves.toEqual({ value: 'shared' });
    await expect(b).resolves.toEqual({ value: 'shared' });
  });

  it('does NOT coalesce different keys', async () => {
    const inner = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const store = wrap(inner);

    await Promise.all([store.get('a'), store.get('b')]);
    expect(inner.get).toHaveBeenCalledTimes(2);
  });

  it('releases the coalescing slot after settle — a later read hits the inner store again', async () => {
    const inner = { get: vi.fn().mockResolvedValue({ value: 1 }), set: vi.fn() };
    const store = wrap(inner);

    await store.get('k');
    await store.get('k');
    expect(inner.get).toHaveBeenCalledTimes(2); // sequential, not overlapping → not coalesced
  });
});

describe('createResilientSecureStorage — per-attempt GET timeout (round360)', () => {
  // The SDK's fetch has NO timeout (verified 2026-08-06), so a hanging Vault
  // attempt is unbounded without this guard. Each GET attempt races a timer;
  // the timeout error is shaped so isTransientStorageError classifies it
  // transient and the EXISTING retry loop retries it.
  //
  // Pattern note: a hanging inner promise means "await p" would hang the test
  // too, so each test attaches a settlement SPY and asserts it was called after
  // advancing the fake clock — pre-implementation that assertion fails fast
  // (spy never called) instead of tripping the 5s vitest test timeout.

  it('times out a hanging get, retries, and resolves on the next attempt', async () => {
    vi.useFakeTimers();
    try {
      const inner = {
        get: vi.fn()
          .mockImplementationOnce(() => new Promise(() => {})) // hangs forever
          .mockResolvedValueOnce({ value: 'ok' }),
        set: vi.fn(),
      };
      const store = wrap(inner, { getTimeoutMs: 100 });

      const p = store.get('k');
      const settled = vi.fn();
      p.then(settled, settled);
      await vi.advanceTimersByTimeAsync(100); // fire the per-attempt timeout; retry sleep is injected noSleep

      expect(settled).toHaveBeenCalledTimes(1); // timed out + retried + resolved, all within the window
      expect(inner.get).toHaveBeenCalledTimes(2); // attempt 1 timed out, attempt 2 won
      await expect(p).resolves.toEqual({ value: 'ok' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects after ALL attempts hang — 3 timeouts, transient-shaped message', async () => {
    vi.useFakeTimers();
    try {
      const inner = { get: vi.fn(() => new Promise(() => {})), set: vi.fn() };
      const store = wrap(inner, { getTimeoutMs: 100 });

      const outcome = vi.fn();
      store.get('k').then(
        (value) => outcome({ resolved: value }),
        (err) => outcome({ rejected: err }),
      );
      await vi.advanceTimersByTimeAsync(100); // attempt 1 times out
      await vi.advanceTimersByTimeAsync(100); // attempt 2 times out
      await vi.advanceTimersByTimeAsync(100); // attempt 3 times out → rethrow

      expect(outcome).toHaveBeenCalledTimes(1);
      const { rejected } = outcome.mock.calls[0][0];
      expect(rejected).toBeInstanceOf(Error);
      expect(rejected.message).toMatch(/accessing secure storage.*timed out/);
      expect(inner.get).toHaveBeenCalledTimes(3); // retries = 3, unchanged
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT time out set — resolves whenever the inner write eventually settles', async () => {
    // Writes are deliberately un-timed: timing out the refresh-persist write
    // risks orphaning a rotated refresh token (monday already invalidated the
    // old one). This test locks that in.
    vi.useFakeTimers();
    try {
      let resolveInner;
      const inner = {
        get: vi.fn(),
        set: vi.fn(() => new Promise((r) => { resolveInner = r; })),
      };
      const store = wrap(inner, { getTimeoutMs: 100 });

      const p = store.set('k', { v: 1 });
      const settled = vi.fn();
      p.then(settled, settled);
      await vi.advanceTimersByTimeAsync(10_000); // way past any get timeout
      expect(settled).not.toHaveBeenCalled(); // no timer fired the write into a fake failure
      expect(inner.set).toHaveBeenCalledTimes(1); // and no retry was triggered

      resolveInner(undefined);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('produces a timeout error that isTransientStorageError classifies transient', async () => {
    vi.useFakeTimers();
    try {
      const inner = { get: vi.fn(() => new Promise(() => {})), set: vi.fn() };
      const store = wrap(inner, { getTimeoutMs: 50, retries: 1 });

      const onErr = vi.fn();
      store.get('k').catch(onErr);
      await vi.advanceTimersByTimeAsync(50);

      expect(onErr).toHaveBeenCalledTimes(1);
      const err = onErr.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('timed out');
      expect(isTransientStorageError(err)).toBe(true); // ← what makes the retry loop retry it
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs (not unhandled-rejects) when the losing attempt fails after the timeout fired', async () => {
    vi.useFakeTimers();
    try {
      let rejectInner;
      const inner = {
        get: vi.fn(() => new Promise((_resolve, reject) => { rejectInner = reject; })),
        set: vi.fn(),
      };
      const logger = { warn: vi.fn() };
      const store = wrap(inner, { getTimeoutMs: 100, retries: 1, logger });

      const onErr = vi.fn();
      store.get('k').catch(onErr);
      await vi.advanceTimersByTimeAsync(100);
      expect(onErr).toHaveBeenCalledTimes(1); // the caller got the timeout rejection

      // The loser settles late — it must be logged, not become an unhandledRejection.
      rejectInner(new Error('late vault failure'));
      await vi.advanceTimersByTimeAsync(0); // flush microtasks

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('late vault failure'),
        expect.anything(),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
