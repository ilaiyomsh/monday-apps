import { describe, it, expect, vi } from 'vitest';
import { createTokenStore, createRulesStore, REFRESH_CUSHION_MS } from '../src/services/stores.js';

// ---------------------------------------------------------------------------
// round360 — in-memory caching layers in stores.js:
//   1. access-token cache + reader-pointer cache inside createTokenStore
//   2. rules TTL cache inside createRulesStore
//   3. cross-instance refresh-race adoption in doRefresh's invalid_grant branch
// All tests here assert STORAGE TRAFFIC (call counts on the secureStorage
// double) and EXACT tokens, so a cache that silently stops working — or one
// that serves the wrong tenant — fails loudly.
// ---------------------------------------------------------------------------

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** A secureStorage double backed by a key→value map (per-key reads + write capture). */
function makeKeyedStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
    set: vi.fn(async (key, value) => { map.set(key, value); return true; }),
    delete: vi.fn(async (key) => { map.delete(key); return true; }),
    _map: map,
  };
}

const T0 = 1_000_000;
const FAR = T0 + 3_600_000; // expiry a full hour out — comfortably past the cushion

// ---------------------------------------------------------------------------
// createTokenStore — access-token cache
// ---------------------------------------------------------------------------

describe('createTokenStore — in-memory access-token cache (round360)', () => {
  it('repeat sequential getOwnerToken serves the second read from memory — ONE storage read total', async () => {
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'cached-tok', refreshToken: 'r1', expiresAt: FAR, userId: '41' },
    });
    const oauthClient = { refresh: vi.fn() };
    const store = createTokenStore({ secureStorage, oauthClient, now: () => T0 });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('cached-tok');
    await expect(store.getOwnerToken('999', '41')).resolves.toBe('cached-tok');

    expect(secureStorage.get).toHaveBeenCalledTimes(1);
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('a cached token expires AT the refresh-cushion boundary — the boundary read goes back to storage and refreshes', async () => {
    let t = T0;
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'fresh-tok', refreshToken: 'r1', expiresAt: FAR, userId: '41' },
    });
    const oauthClient = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'rotated-tok', refreshToken: 'r2', expiresAtMs: FAR + 3_600_000 }),
    };
    const store = createTokenStore({ secureStorage, oauthClient, now: () => t });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('fresh-tok');
    expect(secureStorage.get).toHaveBeenCalledTimes(1);

    // Advance to EXACTLY the cushion boundary: expiresAt - now() === REFRESH_CUSHION_MS.
    // The hit rule is strict (>), so this read must MISS the cache and refresh.
    t = FAR - REFRESH_CUSHION_MS;
    await expect(store.getOwnerToken('999', '41')).resolves.toBe('rotated-tok');
    expect(oauthClient.refresh).toHaveBeenCalledTimes(1);
    expect(oauthClient.refresh).toHaveBeenCalledWith('r1');
  });

  it('two accounts sharing a userId keep separate cache entries — exact per-account tokens, one read each', async () => {
    const secureStorage = makeKeyedStorage({
      '111:token:41': { token: 'tok-a', refreshToken: 'ra', expiresAt: FAR, userId: '41' },
      '222:token:41': { token: 'tok-b', refreshToken: 'rb', expiresAt: FAR, userId: '41' },
    });
    const store = createTokenStore({ secureStorage, oauthClient: { refresh: vi.fn() }, now: () => T0 });

    await expect(store.getOwnerToken('111', '41')).resolves.toBe('tok-a');
    // Account 222 must resolve ITS OWN record — a userId-only cache key would answer 'tok-a' here.
    await expect(store.getOwnerToken('222', '41')).resolves.toBe('tok-b');
    // Repeats are cache hits, still isolated per account.
    await expect(store.getOwnerToken('111', '41')).resolves.toBe('tok-a');
    await expect(store.getOwnerToken('222', '41')).resolves.toBe('tok-b');

    expect(secureStorage.get).toHaveBeenCalledTimes(2);
    expect(secureStorage.get.mock.calls.map(([key]) => key)).toEqual(['111:token:41', '222:token:41']);
  });

  it('setOwnerToken primes BOTH caches — owner and reader reads are storage-free afterwards', async () => {
    const secureStorage = makeKeyedStorage({});
    const store = createTokenStore({ secureStorage, oauthClient: { refresh: vi.fn() }, now: () => T0 });

    await store.setOwnerToken('999', '41', { token: 'granted', refreshToken: 'r1', expiresAt: FAR, userId: '41' });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('granted');
    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'granted', userId: '41' });
    expect(secureStorage.get).not.toHaveBeenCalled();
  });

  it('doRefresh flagging reauth_required EVICTS the cached token — a later read cannot resurrect it', async () => {
    const secureStorage = makeKeyedStorage({
      // Stale record — forces the read into the refresh lane.
      '999:token:41': { token: 'old', refreshToken: 'r1', expiresAt: T0 + 60_000, userId: '41' },
    });
    let rejectRefresh;
    const oauthClient = { refresh: vi.fn(() => new Promise((_res, rej) => { rejectRefresh = rej; })) };
    const store = createTokenStore({ secureStorage, oauthClient, logger: makeLogger(), now: () => T0 });

    const pending = store.getOwnerToken('999', '41'); // held open inside the refresh lane
    while (oauthClient.refresh.mock.calls.length === 0) {
      await new Promise((r) => setImmediate(r));
    }

    // While the doomed refresh is in flight, a grant lands via setOwnerToken and primes the
    // cache. Same refreshToken ON PURPOSE: the invalid_grant re-read must see the SAME pair
    // so the flag path (not cross-instance adoption) runs.
    await store.setOwnerToken('999', '41', { token: 'planted', refreshToken: 'r1', expiresAt: FAR, userId: '41' });
    const getsBefore = secureStorage.get.mock.calls.length;
    await expect(store.getOwnerToken('999', '41')).resolves.toBe('planted'); // cache hit …
    expect(secureStorage.get.mock.calls.length).toBe(getsBefore); // … storage-free

    rejectRefresh(Object.assign(new Error('grant revoked'), { code: 'refresh_token_invalid' }));
    await expect(pending).resolves.toBeNull();
    expect(secureStorage._map.get('999:token:41').status).toBe('reauth_required');

    // The flag must have evicted 'planted' — the next read reaches storage, sees
    // reauth_required, and answers null. A surviving cache entry would answer 'planted'.
    await expect(store.getOwnerToken('999', '41')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createTokenStore — reader pointer cache
// ---------------------------------------------------------------------------

describe('createTokenStore — reader pointer cache (round360)', () => {
  it('repeat getReaderToken resolves through the pointer cache — the pointer key is read ONCE', async () => {
    const secureStorage = makeKeyedStorage({
      '999:token:default': { userId: '41' },
      '999:token:41': { token: 'reader-tok', refreshToken: 'r1', expiresAt: FAR, userId: '41' },
    });
    const store = createTokenStore({ secureStorage, oauthClient: { refresh: vi.fn() }, now: () => T0 });

    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'reader-tok', userId: '41' });
    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'reader-tok', userId: '41' });

    const pointerReads = secureStorage.get.mock.calls.filter(([key]) => key === '999:token:default');
    expect(pointerReads).toHaveLength(1);
    // Pointer once + owner record once — the second call is fully cache-served.
    expect(secureStorage.get).toHaveBeenCalledTimes(2);
  });

  // round360 review fix (P1): a cached pointer whose owner can no longer resolve
  // (reauth flag, dead grant) must FALL BACK to the stored pointer — a re-auth by
  // another owner lands on another monday-code instance, and only storage knows.
  it('a DEAD cached pointer falls back to the stored pointer — cross-instance re-authorization is picked up', async () => {
    let t = T0;
    const secureStorage = makeKeyedStorage({
      '999:token:default': { userId: '41' },
      '999:token:41': { token: 'reader-41', refreshToken: 'r41', expiresAt: FAR, userId: '41' },
    });
    const store = createTokenStore({ secureStorage, oauthClient: { refresh: vi.fn() }, logger: makeLogger(), now: () => t });

    // First call resolves + caches the pointer (41) and 41's access token.
    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'reader-41', userId: '41' });

    // Cross-instance re-auth happens elsewhere: 41's grant dies, the STORED
    // pointer moves to 52 — this instance's caches know nothing about it.
    secureStorage._map.set('999:token:41', { token: null, refreshToken: null, status: 'reauth_required', userId: '41' });
    secureStorage._map.set('999:token:default', { userId: '52' });
    secureStorage._map.set('999:token:52', { token: 'reader-52', refreshToken: 'r52', expiresAt: FAR + 3_600_000, userId: '52' });

    // Once 41's cached token ages into the cushion, the cached pointer resolves
    // to null — the store must then RE-READ the pointer and find 52, not report
    // "not activated" forever (the pre-fix behavior).
    t = FAR - REFRESH_CUSHION_MS;
    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'reader-52', userId: '52' });

    const pointerReads = secureStorage.get.mock.calls.filter(([key]) => key === '999:token:default');
    expect(pointerReads).toHaveLength(2); // initial read + the fallback re-read
  });

  it('a LEGACY copy-record pointer (token, no userId) is honored but NEVER cached — every call re-reads it', async () => {
    const secureStorage = makeKeyedStorage({
      '999:token:default': { token: 'legacy', botUserId: '3' },
    });
    const store = createTokenStore({ secureStorage, now: () => T0 });

    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'legacy', userId: null });
    await expect(store.getReaderToken('999')).resolves.toEqual({ token: 'legacy', userId: null });

    const pointerReads = secureStorage.get.mock.calls.filter(([key]) => key === '999:token:default');
    expect(pointerReads).toHaveLength(2); // no caching of token-carrying legacy records
  });
});

// ---------------------------------------------------------------------------
// createTokenStore — cross-instance refresh race (invalid_grant re-read)
// ---------------------------------------------------------------------------

describe('createTokenStore — cross-instance refresh race (round360)', () => {
  it('invalid_grant whose re-read shows a ROTATED pair adopts the newer rotation — no reauth flag, newer token returned', async () => {
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'old', refreshToken: 'r1', expiresAt: T0 + 60_000, userId: '41' },
    });
    // This instance presents r1 and loses: ANOTHER INSTANCE already presented r1, won the
    // single-use rotation, and persisted the rotated pair — simulated by mutating storage
    // before rejecting, exactly the state a post-failure re-read would find.
    const oauthClient = {
      refresh: vi.fn(async () => {
        secureStorage._map.set('999:token:41', { token: 'newer', refreshToken: 'r2', expiresAt: FAR, userId: '41' });
        throw Object.assign(new Error('invalid_grant'), { code: 'refresh_token_invalid' });
      }),
    };
    const logger = makeLogger();
    const store = createTokenStore({ secureStorage, oauthClient, logger, now: () => T0 });

    await expect(store.getOwnerToken('999', '41')).resolves.toBe('newer');

    // The healthy rotated pair survives untouched — no reauth flag was ever written.
    const persisted = secureStorage._map.get('999:token:41');
    expect(persisted.status).not.toBe('reauth_required');
    expect(persisted.refreshToken).toBe('r2');
    const flagWrites = secureStorage.set.mock.calls.filter(([, value]) => value?.status === 'reauth_required');
    expect(flagWrites).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('adopted newer rotation'),
      expect.anything(),
      expect.anything()
    );

    // Adoption populated the access cache — the follow-up read is storage-free.
    const getsAfterAdoption = secureStorage.get.mock.calls.length;
    await expect(store.getOwnerToken('999', '41')).resolves.toBe('newer');
    expect(secureStorage.get.mock.calls.length).toBe(getsAfterAdoption);
  });

  it('invalid_grant whose re-read shows the SAME pair is a genuinely dead grant — flags reauth_required, returns null', async () => {
    const secureStorage = makeKeyedStorage({
      '999:token:41': { token: 'old', refreshToken: 'dead', expiresAt: T0 + 60_000, userId: '41' },
    });
    const oauthClient = {
      refresh: vi.fn().mockRejectedValue(Object.assign(new Error('invalid_grant'), { code: 'refresh_token_invalid' })),
    };
    const logger = makeLogger();
    const store = createTokenStore({ secureStorage, oauthClient, logger, now: () => T0 });

    await expect(store.getOwnerToken('999', '41')).resolves.toBeNull();

    const persisted = secureStorage._map.get('999:token:41');
    expect(persisted.status).toBe('reauth_required');
    expect(persisted.token).toBeNull();
    expect(persisted.refreshToken).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled(); // no adoption log on a genuine dead grant
  });
});

// ---------------------------------------------------------------------------
// createRulesStore — TTL cache
// ---------------------------------------------------------------------------

describe('createRulesStore — TTL cache (round360)', () => {
  it('caches parsed rules — repeat read within the TTL is storage-free and returns the SAME cached object', async () => {
    let t = 0;
    const storage = { get: vi.fn().mockResolvedValue('{"version":1,"hiddenLabelIds":["2"]}') };
    const storageFactory = vi.fn(() => storage);
    const store = createRulesStore({ storageFactory, logger: makeLogger(), now: () => t });

    const first = await store.getRules('tok', '5098', 'status_col', 'ACC1');
    t = 44_999; // one ms inside the default 45s TTL
    const second = await store.getRules('tok', '5098', 'status_col', 'ACC1');

    expect(first).toEqual({ version: 1, hiddenLabelIds: ['2'] });
    expect(second).toBe(first); // the cached object itself, not a re-fetch/re-parse
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storageFactory).toHaveBeenCalledTimes(1); // a hit never even builds storage
  });

  it('caches a NULL (unguarded) result — no refetch storm on unguarded columns', async () => {
    let t = 0;
    const storage = { get: vi.fn().mockResolvedValue(null) };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), now: () => t });

    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toBeNull();
    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toBeNull();

    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it('expires at exactly the default 45s TTL — 44_999ms still serves the cache, 45_000ms refetches', async () => {
    let t = 0;
    const storage = {
      get: vi.fn()
        .mockResolvedValueOnce('{"marker":"first"}')
        .mockResolvedValueOnce('{"marker":"second"}'),
    };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), now: () => t });

    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({ marker: 'first' });
    t = 44_999;
    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({ marker: 'first' });
    t = 45_000; // elapsed === ttlMs → expired
    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({ marker: 'second' });

    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it('honors an injected ttlMs', async () => {
    let t = 0;
    const storage = {
      get: vi.fn()
        .mockResolvedValueOnce('{"marker":"first"}')
        .mockResolvedValueOnce('{"marker":"second"}'),
    };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), ttlMs: 10, now: () => t });

    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({ marker: 'first' });
    t = 9;
    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({ marker: 'first' });
    t = 10;
    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({ marker: 'second' });

    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it('keeps separate entries per board:column pair — no cross-column bleed', async () => {
    let t = 0;
    const storage = {
      get: vi.fn(async (key) => (key === 'twystStatus:5098:colA' ? '{"a":1}' : '{"b":2}')),
    };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), now: () => t });

    await expect(store.getRules('tok', '5098', 'colA', 'ACC1')).resolves.toEqual({ a: 1 });
    await expect(store.getRules('tok', '5098', 'colB', 'ACC1')).resolves.toEqual({ b: 2 });
    // Repeats hit each pair's own entry.
    await expect(store.getRules('tok', '5098', 'colA', 'ACC1')).resolves.toEqual({ a: 1 });
    await expect(store.getRules('tok', '5098', 'colB', 'ACC1')).resolves.toEqual({ b: 2 });

    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  // round360 review fix (P1): the sessionToken routes pass a CLIENT-CHOSEN boardId
  // with their own account's token — caching those would let tenant B poison the
  // entry tenant A's webhook trusts. No accountId → no cache, in either direction.
  it('a call WITHOUT accountId bypasses the cache entirely — never reads it, never writes it', async () => {
    let t = 0;
    const storage = {
      get: vi.fn()
        .mockResolvedValueOnce(null) // the no-accountId probe (e.g. a foreign board via /status)
        .mockResolvedValueOnce('{"version":1,"hiddenLabelIds":["0"]}') // the webhook's own fetch
        .mockResolvedValueOnce(null), // a second no-accountId probe fetches again
    };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), now: () => t });

    // Route-shaped call (no accountId): fetches, and must NOT seed the cache…
    await expect(store.getRules('tok-B', '5098', 'status_col')).resolves.toBeNull();
    // …so the webhook-shaped call (with accountId) still reaches storage and
    // caches ITS result, not the probe's null.
    await expect(store.getRules('tok-A', '5098', 'status_col', 'ACC-A')).resolves.toEqual({ version: 1, hiddenLabelIds: ['0'] });
    // And a route-shaped call never READS the cache either — third fetch.
    await expect(store.getRules('tok-B', '5098', 'status_col')).resolves.toBeNull();

    expect(storage.get).toHaveBeenCalledTimes(3);
  });

  it('cache entries are keyed by accountId — one tenant cannot serve another', async () => {
    let t = 0;
    const storage = {
      get: vi.fn()
        .mockResolvedValueOnce('{"owner":"A"}')
        .mockResolvedValueOnce(null),
    };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), now: () => t });

    await expect(store.getRules('tok-A', '5098', 'status_col', 'ACC-A')).resolves.toEqual({ owner: 'A' });
    // Same board:column, different account: its own fetch, its own (null) entry.
    await expect(store.getRules('tok-B', '5098', 'status_col', 'ACC-B')).resolves.toBeNull();
    // Repeats hit each tenant's own entry — no cross-serve in either direction.
    await expect(store.getRules('tok-A', '5098', 'status_col', 'ACC-A')).resolves.toEqual({ owner: 'A' });
    await expect(store.getRules('tok-B', '5098', 'status_col', 'ACC-B')).resolves.toBeNull();

    expect(storage.get).toHaveBeenCalledTimes(2);
  });

  it('an infrastructure rejection is rethrown and NOT cached — the next read reaches storage again', async () => {
    let t = 0;
    const storage = {
      get: vi.fn()
        .mockRejectedValueOnce(new Error('storage backend down'))
        .mockResolvedValueOnce('{"version":1,"hiddenLabelIds":[]}'),
    };
    const store = createRulesStore({ storageFactory: () => storage, logger: makeLogger(), now: () => t });

    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).rejects.toThrow('storage backend down');
    await expect(store.getRules('tok', '5098', 'status_col', 'ACC1')).resolves.toEqual({
      version: 1,
      hiddenLabelIds: [],
    });
    expect(storage.get).toHaveBeenCalledTimes(2);
  });
});
