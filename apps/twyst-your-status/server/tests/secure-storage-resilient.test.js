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
