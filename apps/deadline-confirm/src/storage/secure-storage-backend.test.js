// Platform quirk (apps-sdk 0.1.4, source-verified + production-observed):
// SecureStorage.set wraps PRIMITIVES as { value } and get returns the wrapper
// verbatim. The adapter must unwrap, or stored strings (oauth_token,
// link_secret) come back as objects and every downstream use breaks
// ('[object Object]' Authorization → 401 → admin shows "broken").

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sdkGet = vi.fn();
const sdkSet = vi.fn();
const sdkDelete = vi.fn();

vi.mock('@mondaycom/apps-sdk', () => ({
  SecureStorage: class {
    get = sdkGet;
    set = sdkSet;
    delete = sdkDelete;
  },
}));

const { createSecureStorageBackend } = await import('./secure-storage-backend.js');

beforeEach(() => {
  sdkGet.mockReset();
  sdkSet.mockReset();
  sdkDelete.mockReset();
});

describe('createSecureStorageBackend.get', () => {
  it("unwraps the platform's primitive wrapper: {value:'tok'} → 'tok'", async () => {
    sdkGet.mockResolvedValue({ value: 'at-secret-token' });
    const backend = createSecureStorageBackend();
    await expect(backend.get('oauth_token')).resolves.toBe('at-secret-token');
  });

  it('unwraps wrapped numbers too ({value: 5} → 5)', async () => {
    sdkGet.mockResolvedValue({ value: 5 });
    const backend = createSecureStorageBackend();
    await expect(backend.get('n')).resolves.toBe(5);
  });

  it('returns real objects (config, nonces) untouched', async () => {
    const config = { boardId: '1', buttons: [], templates: [] };
    sdkGet.mockResolvedValue(config);
    const backend = createSecureStorageBackend();
    await expect(backend.get('config')).resolves.toBe(config);

    const nonce = { createdAt: 123 };
    sdkGet.mockResolvedValue(nonce);
    await expect(backend.get('oauth_state:x')).resolves.toBe(nonce);
  });

  it('does NOT unwrap objects that merely contain a value key among others', async () => {
    const obj = { value: 'x', other: 1 };
    sdkGet.mockResolvedValue(obj);
    const backend = createSecureStorageBackend();
    await expect(backend.get('k')).resolves.toBe(obj);
  });

  it('normalizes undefined/null to null', async () => {
    sdkGet.mockResolvedValue(undefined);
    const backend = createSecureStorageBackend();
    await expect(backend.get('missing')).resolves.toBeNull();
  });
});

describe('createSecureStorageBackend.set/delete passthrough', () => {
  it('forwards set(key, value) verbatim to the SDK', async () => {
    sdkSet.mockResolvedValue(true);
    const backend = createSecureStorageBackend();
    await backend.set('link_secret', 'sec-1');
    expect(sdkSet).toHaveBeenCalledWith('link_secret', 'sec-1');
  });

  it('forwards delete(key) to the SDK', async () => {
    sdkDelete.mockResolvedValue(true);
    const backend = createSecureStorageBackend();
    await backend.delete('oauth_state:n');
    expect(sdkDelete).toHaveBeenCalledWith('oauth_state:n');
  });

  it('wraps SDK set failures as secure_storage_set_failed (keeps cause)', async () => {
    const cause = new Error('An issue occurred while accessing secure storage');
    sdkSet.mockRejectedValue(cause);
    const backend = createSecureStorageBackend();
    await expect(backend.set('link_secret', 'sec-1')).rejects.toThrow(
      /^secure_storage_set_failed: An issue occurred while accessing secure storage$/
    );
  });

  it('wraps SDK get failures as secure_storage_get_failed', async () => {
    sdkGet.mockRejectedValue(new Error('Provided input is invalid'));
    const backend = createSecureStorageBackend();
    await expect(backend.get('link_secret')).rejects.toThrow(
      /^secure_storage_get_failed: Provided input is invalid$/
    );
  });
});

// PRODUCTION INCIDENT 2026-07-29: the admin screen died on
// `secure_storage_get_failed: An issue occurred while accessing secure storage`
// while reading `<account>:config` — a key that certainly existed.
//
// That message is the apps-sdk's CATCH-ALL: secureStorageFetch wraps EVERY
// transport failure in it — a Vault 5xx, a 403 from an expired Vault token, a
// socket reset, a non-JSON body. Source-verified in
// dist/esm/secure-storage/secure-storage.js. So it says nothing about the key
// and everything about the hop, and a single blip on that hop took out a whole
// admin request.
//
// Retry policy is therefore about the SHAPE of the error, not its text:
//   - `status` >= 500 or absent  → transport/unknown, worth another attempt
//   - `status` 400 / 404         → BadRequestError / NotFoundError from the SDK,
//                                  deterministic; retrying only adds latency
// (403 never reaches us: fetch-wrapper's ForbiddenError is caught inside
// secureStorageFetch and re-thrown as InternalServerError, i.e. status 500.)

/** An apps-sdk BaseError-shaped rejection: carries `status`. */
function sdkError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const TRANSIENT = () => sdkError('An issue occurred while accessing secure storage', 500);

describe('createSecureStorageBackend — transient failures are retried', () => {
  /** Collects backoff delays instead of waiting them out. */
  function fakeSleep() {
    const waits = [];
    return { waits, sleep: async (ms) => void waits.push(ms) };
  }

  it('survives a single transport blip on get instead of failing the request', async () => {
    sdkGet.mockRejectedValueOnce(TRANSIENT()).mockResolvedValueOnce({ boardId: '1' });
    const { sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ sleep });
    await expect(backend.get('111:config')).resolves.toEqual({ boardId: '1' });
    expect(sdkGet).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and reports the wrapped failure', async () => {
    sdkGet.mockRejectedValue(TRANSIENT());
    const { sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ retries: 2, sleep });
    await expect(backend.get('111:config')).rejects.toThrow(
      /^secure_storage_get_failed: An issue occurred while accessing secure storage$/
    );
    // retries=2 means 3 attempts total, not 2.
    expect(sdkGet).toHaveBeenCalledTimes(3);
  });

  it('honours retries=0 — one attempt, no sleep', async () => {
    sdkGet.mockRejectedValue(TRANSIENT());
    const { waits, sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ retries: 0, sleep });
    await expect(backend.get('k')).rejects.toThrow(/secure_storage_get_failed/);
    expect(sdkGet).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('backs off between attempts rather than hammering the hop', async () => {
    sdkGet.mockRejectedValue(TRANSIENT());
    const { waits, sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ retries: 2, sleep });
    await expect(backend.get('k')).rejects.toThrow(/secure_storage_get_failed/);
    // One wait per retry, and the second is longer than the first.
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it('does not sleep at all when the first attempt succeeds', async () => {
    sdkGet.mockResolvedValue({ a: 1 });
    const { waits, sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ sleep });
    await backend.get('k');
    expect(waits).toEqual([]);
  });

  it('still unwraps the primitive wrapper on a retried read', async () => {
    sdkGet.mockRejectedValueOnce(TRANSIENT()).mockResolvedValueOnce({ value: 'tok' });
    const { sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ sleep });
    await expect(backend.get('oauth_token')).resolves.toBe('tok');
  });

  it('still normalizes a retried miss to null', async () => {
    sdkGet.mockRejectedValueOnce(TRANSIENT()).mockResolvedValueOnce(undefined);
    const { sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ sleep });
    await expect(backend.get('missing')).resolves.toBeNull();
  });

  it('retries a transient set — a lost config write is worse than a slow one', async () => {
    sdkSet.mockRejectedValueOnce(TRANSIENT()).mockResolvedValueOnce(true);
    const { sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ sleep });
    await backend.set('111:config', { boardId: '1' });
    expect(sdkSet).toHaveBeenCalledTimes(2);
    // Every attempt carries the same payload — no half-written retry.
    expect(sdkSet).toHaveBeenLastCalledWith('111:config', { boardId: '1' });
  });

  it('retries a transient delete', async () => {
    sdkDelete.mockRejectedValueOnce(TRANSIENT()).mockResolvedValueOnce(true);
    const { sleep } = fakeSleep();
    const backend = createSecureStorageBackend({ sleep });
    await backend.delete('oauth_state:n');
    expect(sdkDelete).toHaveBeenCalledTimes(2);
  });
});

// PRODUCTION INCIDENT 2026-07-29 (second symptom): the admin screen failed on
// FIRST OPEN every time, and a refresh always fixed it. That is not a blip —
// it is a cold-start herd.
//
// The SDK authenticates lazily on the instance:
//   SecureStorage.prototype.get = function (key) {
//     this.connectionData = await authenticate(this.connectionData);  // undefined the first time
//
// index.js builds ONE backend at module scope, so `connectionData` is shared
// and its token TTL is hours — which is why every request after the first is
// fine. But `/api/state` fires FOUR reads through Promise.all, so on a cold
// container all four see `connectionData === undefined` and each runs the full
// auth path: a GCP identity token, a Vault GCP login, and a lookup-self. Four
// concurrent authentications racing to assign the same field.
//
// So the first operation on a cold backend must run ALONE; once one has
// completed, the connection is warm and concurrency is free again.

describe('createSecureStorageBackend — cold start runs one authentication, not a herd', () => {
  const noSleep = { sleep: async () => {} };

  /** An externally-resolvable promise, to hold an operation mid-flight. */
  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** Let queued microtasks drain so pending awaits make progress. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('lets exactly ONE read reach the SDK while the connection is cold', async () => {
    const first = deferred();
    sdkGet.mockReturnValueOnce(first.promise).mockResolvedValue({ warm: true });
    const backend = createSecureStorageBackend(noSleep);

    // Exactly what GET /api/state does on first open.
    const all = Promise.all([
      backend.get('111:config'),
      backend.get('111:link_secret'),
      backend.get('111:oauth_token'),
      backend.get('111:google_sender'),
    ]);
    await flush();

    // The other three must still be waiting — not authenticating in parallel.
    expect(sdkGet).toHaveBeenCalledTimes(1);

    first.resolve({ boardId: '1' });
    const [config, ...rest] = await all;
    expect(sdkGet).toHaveBeenCalledTimes(4);
    expect(config).toEqual({ boardId: '1' });
    expect(rest).toEqual([{ warm: true }, { warm: true }, { warm: true }]);
  });

  it('gates set and delete behind the same priming, not one gate per method', async () => {
    const first = deferred();
    sdkGet.mockReturnValueOnce(first.promise);
    sdkSet.mockResolvedValue(true);
    sdkDelete.mockResolvedValue(true);
    const backend = createSecureStorageBackend(noSleep);

    const all = Promise.all([
      backend.get('111:config'),
      backend.set('111:link_secret', 's'),
      backend.delete('oauth_state:n'),
    ]);
    await flush();

    expect(sdkSet).not.toHaveBeenCalled();
    expect(sdkDelete).not.toHaveBeenCalled();

    first.resolve({ boardId: '1' });
    await all;
    expect(sdkSet).toHaveBeenCalledTimes(1);
    expect(sdkDelete).toHaveBeenCalledTimes(1);
  });

  it('stops serializing once the connection is warm', async () => {
    sdkGet.mockResolvedValue({ ok: true });
    const backend = createSecureStorageBackend(noSleep);
    await backend.get('warmup'); // pays for the authentication

    const held = [deferred(), deferred(), deferred()];
    sdkGet.mockReturnValueOnce(held[0].promise)
      .mockReturnValueOnce(held[1].promise)
      .mockReturnValueOnce(held[2].promise);
    const all = Promise.all([backend.get('a'), backend.get('b'), backend.get('c')]);
    await flush();

    // All three in flight together — serializing warm reads would make
    // /api/state four sequential round trips on every single request.
    expect(sdkGet).toHaveBeenCalledTimes(4);
    held.forEach((d, i) => d.resolve({ i }));
    expect(await all).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
  });

  it('does not wedge the backend when the first attempt fails', async () => {
    // A cold start that genuinely fails must not leave later requests blocked
    // on a promise that will never be retried.
    sdkGet.mockRejectedValueOnce(sdkError('Provided input is invalid', 400));
    const backend = createSecureStorageBackend({ retries: 0, ...noSleep });
    await expect(backend.get('bad')).rejects.toThrow(/secure_storage_get_failed/);

    sdkGet.mockResolvedValueOnce({ boardId: '1' });
    await expect(backend.get('111:config')).resolves.toEqual({ boardId: '1' });
  });

  it('a waiter takes over priming when the primer fails, and still succeeds', async () => {
    const first = deferred();
    sdkGet.mockReturnValueOnce(first.promise).mockResolvedValue({ boardId: '1' });
    const backend = createSecureStorageBackend({ retries: 0, ...noSleep });

    const primer = backend.get('111:config');
    const waiter = backend.get('111:oauth_token');
    await flush();
    expect(sdkGet).toHaveBeenCalledTimes(1);

    first.reject(sdkError('An issue occurred while accessing secure storage', 500));

    await expect(primer).rejects.toThrow(/secure_storage_get_failed/);
    await expect(waiter).resolves.toEqual({ boardId: '1' });
  });

  it('keeps each waiter own result — keys are never crossed', async () => {
    const first = deferred();
    sdkGet.mockReturnValueOnce(first.promise).mockImplementation(async (key) => ({ key }));
    const backend = createSecureStorageBackend(noSleep);

    const all = Promise.all([backend.get('k1'), backend.get('k2'), backend.get('k3')]);
    await flush();
    first.resolve({ key: 'k1' });
    expect(await all).toEqual([{ key: 'k1' }, { key: 'k2' }, { key: 'k3' }]);
  });
});

describe('createSecureStorageBackend — deterministic failures are NOT retried', () => {
  const noSleep = { sleep: async () => {} };

  it('fails a 400 immediately — a malformed key will never start working', async () => {
    sdkGet.mockRejectedValue(sdkError('Provided input is invalid', 400));
    const backend = createSecureStorageBackend({ retries: 2, ...noSleep });
    await expect(backend.get('k')).rejects.toThrow(/secure_storage_get_failed/);
    expect(sdkGet).toHaveBeenCalledTimes(1);
  });

  it('fails a 404 immediately', async () => {
    sdkSet.mockRejectedValue(sdkError('not found', 404));
    const backend = createSecureStorageBackend({ retries: 2, ...noSleep });
    await expect(backend.set('k', 'v')).rejects.toThrow(/secure_storage_set_failed/);
    expect(sdkSet).toHaveBeenCalledTimes(1);
  });

  it('retries an error with no status — a bare socket failure is transient', async () => {
    sdkGet.mockRejectedValue(new Error('ECONNRESET'));
    const backend = createSecureStorageBackend({ retries: 1, ...noSleep });
    await expect(backend.get('k')).rejects.toThrow(/secure_storage_get_failed: ECONNRESET/);
    expect(sdkGet).toHaveBeenCalledTimes(2);
  });
});
