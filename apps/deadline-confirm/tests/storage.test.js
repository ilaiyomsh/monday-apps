// Contract tests for src/services/storage.js — v3 multi-tenant: account data
// lives behind forAccount(accountId) over per-account backend keys
// (`${accountId}:config|link_secret|oauth_token|oauth_identity`), keeping the
// v2 cache semantics (60s read cache; a cached read performs ZERO backend
// calls; ANY write through ANY account's scope invalidates the whole cache)
// and single-use OAuth state nonces (10-min expiry) that now record the
// issuing accountId. Backend fake is the real (implemented) memory backend,
// wrapped to count calls.

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStorage, KEYS } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const TTL_MS = 60_000;
const STATE_MAX_AGE_MS = 600_000;

const ACCOUNT_A = '111';
const ACCOUNT_B = '222';

/** Backend key of an account-scoped value: `${accountId}:<bare name>`. */
const scopedKey = (accountId, key) => `${accountId}:${key}`;

const CONFIG_FIXTURE = {
  boardId: '1234567890',
  statusColumnId: 'status',
  fromIndex: 0,
  fromLabel: 'בעבודה',
  toIndex: 1,
  toLabel: 'בוצע',
  peopleColumnId: 'person',
  expiryDateColumnId: null,
  expiryGraceDays: 0,
};

/**
 * Wrap the real memory backend so every get/set/delete is recorded.
 * `raw` bypasses the counters (used to simulate out-of-band backend writes).
 */
function createCountingBackend(initial = {}) {
  const raw = createMemoryBackend(initial);
  const calls = { get: [], set: [], delete: [] };
  const backend = {
    async get(key) {
      calls.get.push(key);
      return raw.get(key);
    },
    async set(key, value) {
      calls.set.push([key, value]);
      return raw.set(key, value);
    },
    async delete(key) {
      calls.delete.push(key);
      return raw.delete(key);
    },
  };
  const getCount = (key) => calls.get.filter((k) => k === key).length;
  return { backend, raw, calls, getCount };
}

describe('createAppStorage (v3 multi-tenant)', () => {
  /** @type {number} fake clock, ms */
  let t;
  const now = () => t;

  beforeEach(() => {
    t = 0;
  });

  function makeStorage(initial) {
    const counting = createCountingBackend(initial);
    const storage = createAppStorage({
      backend: counting.backend,
      ttlMs: TTL_MS,
      stateMaxAgeMs: STATE_MAX_AGE_MS,
      now,
    });
    return { storage, ...counting };
  }

  it('KEYS keeps the bare (unprefixed) key names', () => {
    expect(KEYS.CONFIG).toBe('config');
    expect(KEYS.LINK_SECRET).toBe('link_secret');
    expect(KEYS.OAUTH_TOKEN).toBe('oauth_token');
    expect(KEYS.OAUTH_IDENTITY).toBe('oauth_identity');
  });

  describe('read cache through forAccount (config / link_secret / oauth_token)', () => {
    const cachedReads = [
      {
        label: 'getConfig',
        key: scopedKey(ACCOUNT_A, KEYS.CONFIG),
        seeded: CONFIG_FIXTURE,
        updated: { ...CONFIG_FIXTURE, toIndex: 2, toLabel: 'הושלם' },
        read: (s) => s.forAccount(ACCOUNT_A).getConfig(),
      },
      {
        label: 'getLinkSecret',
        key: scopedKey(ACCOUNT_A, KEYS.LINK_SECRET),
        seeded: 'q7XnT4vB9sLcRw2mZaK8yFdE1gHj0uOiPp5rNtMxWk3',
        updated: 'ROTATED_ROTATED_ROTATED_ROTATED_ROTATED_43x',
        read: (s) => s.forAccount(ACCOUNT_A).getLinkSecret(),
      },
      {
        label: 'getOauthToken',
        key: scopedKey(ACCOUNT_A, KEYS.OAUTH_TOKEN),
        seeded: 'tok_original',
        updated: 'tok_replaced',
        read: (s) => s.forAccount(ACCOUNT_A).getOauthToken(),
      },
    ];

    it.each(cachedReads)(
      '$label hits the backend exactly once (on the account-prefixed key) for the first read and returns the stored value',
      async ({ key, seeded, read }) => {
        const { storage, getCount } = makeStorage({ [key]: seeded });
        await expect(read(storage)).resolves.toEqual(seeded);
        expect(getCount(key)).toBe(1);
      },
    );

    it.each(cachedReads)(
      '$label serves a second read within ttlMs from cache with ZERO additional backend gets',
      async ({ key, seeded, read }) => {
        const { storage, getCount } = makeStorage({ [key]: seeded });
        await read(storage);
        const getsAfterFirstRead = getCount(key);

        t = TTL_MS - 1; // still inside the TTL window
        await expect(read(storage)).resolves.toEqual(seeded);
        expect(getCount(key)).toBe(getsAfterFirstRead);
      },
    );

    it.each(cachedReads)(
      '$label re-reads the backend after the clock passes ttlMs and returns the fresh backend value',
      async ({ key, seeded, updated, read }) => {
        const { storage, raw, getCount } = makeStorage({ [key]: seeded });
        await read(storage); // warm the cache at t=0
        await raw.set(key, updated); // out-of-band change, bypassing the storage layer

        t = TTL_MS - 1;
        await expect(read(storage)).resolves.toEqual(seeded); // stale served inside TTL
        expect(getCount(key)).toBe(1);

        t = TTL_MS + 1; // past the TTL
        await expect(read(storage)).resolves.toEqual(updated);
        expect(getCount(key)).toBe(2);
      },
    );

    it('getConfig resolves null when nothing was ever stored for the account', async () => {
      const { storage } = makeStorage({});
      await expect(storage.forAccount(ACCOUNT_A).getConfig()).resolves.toBeNull();
    });
  });

  describe('write invalidation', () => {
    const writePairs = [
      {
        label: 'setConfig/getConfig',
        key: scopedKey(ACCOUNT_A, KEYS.CONFIG),
        seeded: CONFIG_FIXTURE,
        updated: { ...CONFIG_FIXTURE, fromIndex: 3, fromLabel: 'ממתין' },
        read: (s) => s.forAccount(ACCOUNT_A).getConfig(),
        write: (s, v) => s.forAccount(ACCOUNT_A).setConfig(v),
      },
      {
        label: 'setLinkSecret/getLinkSecret',
        key: scopedKey(ACCOUNT_A, KEYS.LINK_SECRET),
        seeded: 'q7XnT4vB9sLcRw2mZaK8yFdE1gHj0uOiPp5rNtMxWk3',
        updated: 'NEWSECRET_NEWSECRET_NEWSECRET_NEWSECRET_43x',
        read: (s) => s.forAccount(ACCOUNT_A).getLinkSecret(),
        write: (s, v) => s.forAccount(ACCOUNT_A).setLinkSecret(v),
      },
      {
        label: 'setOauthToken/getOauthToken',
        key: scopedKey(ACCOUNT_A, KEYS.OAUTH_TOKEN),
        seeded: 'tok_original',
        updated: 'tok_reconnected',
        read: (s) => s.forAccount(ACCOUNT_A).getOauthToken(),
        write: (s, v) => s.forAccount(ACCOUNT_A).setOauthToken(v),
      },
    ];

    it.each(writePairs)(
      '$label: a read immediately after a write through the layer returns the NEW value',
      async ({ key, seeded, updated, read, write }) => {
        const { storage, raw } = makeStorage({ [key]: seeded });
        await read(storage); // warm the cache with the old value
        await write(storage, updated);
        await expect(read(storage)).resolves.toEqual(updated); // no TTL wait, no manual invalidate
        await expect(raw.get(key)).resolves.toEqual(updated); // write-through: backend holds it too
      },
    );

    it('serves the stale cached secret after a DIRECT backend write, until invalidateCache() forces a re-read', async () => {
      const key = scopedKey(ACCOUNT_A, KEYS.LINK_SECRET);
      const { storage, raw, getCount } = makeStorage({ [key]: 'OLD_SECRET' });
      await storage.forAccount(ACCOUNT_A).getLinkSecret(); // warm cache

      await raw.set(key, 'NEW_SECRET'); // bypasses the storage layer — cache must NOT notice
      await expect(storage.forAccount(ACCOUNT_A).getLinkSecret()).resolves.toBe('OLD_SECRET');
      expect(getCount(key)).toBe(1); // stale read came from cache, not backend

      storage.invalidateCache();
      await expect(storage.forAccount(ACCOUNT_A).getLinkSecret()).resolves.toBe('NEW_SECRET');
      expect(getCount(key)).toBe(2);
    });

    it('a write to one key invalidates the WHOLE cache: a warm link_secret re-reads after setConfig', async () => {
      const secretKey = scopedKey(ACCOUNT_A, KEYS.LINK_SECRET);
      const { storage, raw } = makeStorage({
        [secretKey]: 'OLD_SECRET',
        [scopedKey(ACCOUNT_A, KEYS.CONFIG)]: CONFIG_FIXTURE,
      });
      await storage.forAccount(ACCOUNT_A).getLinkSecret(); // warm link_secret cache
      await raw.set(secretKey, 'NEW_SECRET'); // out-of-band change

      await storage.forAccount(ACCOUNT_A).setConfig({ ...CONFIG_FIXTURE, toIndex: 5 }); // DIFFERENT key
      await expect(storage.forAccount(ACCOUNT_A).getLinkSecret()).resolves.toBe('NEW_SECRET');
    });

    it("a write through ANOTHER account's scope (222 setConfig) invalidates account 111's warm cache immediately", async () => {
      const keyA = scopedKey(ACCOUNT_A, KEYS.LINK_SECRET);
      const { storage, raw } = makeStorage({ [keyA]: 'OLD_SECRET' });
      await storage.forAccount(ACCOUNT_A).getLinkSecret(); // warm 111's cache
      await raw.set(keyA, 'NEW_SECRET'); // out-of-band change

      await storage.forAccount(ACCOUNT_B).setConfig(CONFIG_FIXTURE); // write in a DIFFERENT account
      await expect(storage.forAccount(ACCOUNT_A).getLinkSecret()).resolves.toBe('NEW_SECRET');
    });
  });

  describe('cross-account isolation', () => {
    it("a config set via forAccount('111') resolves null via forAccount('222')", async () => {
      const { storage } = makeStorage({});
      await storage.forAccount(ACCOUNT_A).setConfig(CONFIG_FIXTURE);
      await expect(storage.forAccount(ACCOUNT_B).getConfig()).resolves.toBeNull();
      await expect(storage.forAccount(ACCOUNT_A).getConfig()).resolves.toEqual(CONFIG_FIXTURE);
    });

    it("setConfig persists under the account-prefixed key '111:config' and NOT under the bare 'config'", async () => {
      const { storage, raw } = makeStorage({});
      await storage.forAccount(ACCOUNT_A).setConfig(CONFIG_FIXTURE);
      await expect(raw.get('111:config')).resolves.toEqual(CONFIG_FIXTURE);
      await expect(raw.get('config')).resolves.toBeNull();
    });

    it("a warm cache for 111 never serves 222: 222's first read hits the backend and returns 222's OWN value", async () => {
      const keyA = scopedKey(ACCOUNT_A, KEYS.LINK_SECRET);
      const keyB = scopedKey(ACCOUNT_B, KEYS.LINK_SECRET);
      const { storage, getCount } = makeStorage({ [keyA]: 'SECRET_OF_111', [keyB]: 'SECRET_OF_222' });

      await storage.forAccount(ACCOUNT_A).getLinkSecret(); // 111's key is now hot in cache
      expect(getCount(keyB)).toBe(0);

      await expect(storage.forAccount(ACCOUNT_B).getLinkSecret()).resolves.toBe('SECRET_OF_222');
      expect(getCount(keyB)).toBe(1); // 222's first read went to the backend, not 111's cache
    });

    it("222 resolves null for a secret that exists only for 111, even while 111's read is cached", async () => {
      const keyA = scopedKey(ACCOUNT_A, KEYS.LINK_SECRET);
      const { storage } = makeStorage({ [keyA]: 'SECRET_OF_111' });
      await storage.forAccount(ACCOUNT_A).getLinkSecret(); // warm 111
      await expect(storage.forAccount(ACCOUNT_B).getLinkSecret()).resolves.toBeNull();
    });

    it("an oauth token set via forAccount('111') resolves null via forAccount('222')", async () => {
      const { storage } = makeStorage({});
      await storage.forAccount(ACCOUNT_A).setOauthToken('tok_111');
      await expect(storage.forAccount(ACCOUNT_B).getOauthToken()).resolves.toBeNull();
    });
  });

  describe('OAuth state nonces (single-use CSRF, account-stamped)', () => {
    it('persists an issued nonce UNPREFIXED under "oauth_state:<nonce>" with exactly a { createdAt, accountId } record', async () => {
      const { storage, raw } = makeStorage({});
      await storage.issueOauthState('nonce-abc', ACCOUNT_A);

      const record = await raw.get('oauth_state:nonce-abc');
      expect(record).not.toBeNull();
      expect(Object.keys(record).sort()).toEqual(['accountId', 'createdAt']);
      expect(record.accountId).toBe(ACCOUNT_A);
      expect(typeof record.createdAt).toBe('number');
    });

    it('consume returns { accountId } exactly once and null for the second consume of the same nonce', async () => {
      const { storage } = makeStorage({});
      await storage.issueOauthState('nonce-abc', ACCOUNT_A);
      await expect(storage.consumeOauthState('nonce-abc')).resolves.toStrictEqual({
        accountId: ACCOUNT_A,
      });
      await expect(storage.consumeOauthState('nonce-abc')).resolves.toBeNull();
    });

    it('returns the accountId the nonce was ISSUED with, per nonce', async () => {
      const { storage } = makeStorage({});
      await storage.issueOauthState('nonce-a', ACCOUNT_A);
      await storage.issueOauthState('nonce-b', ACCOUNT_B);
      await expect(storage.consumeOauthState('nonce-b')).resolves.toStrictEqual({
        accountId: ACCOUNT_B,
      });
      await expect(storage.consumeOauthState('nonce-a')).resolves.toStrictEqual({
        accountId: ACCOUNT_A,
      });
    });

    it('deletes the backend entry when a nonce is consumed', async () => {
      const { storage, raw } = makeStorage({});
      await storage.issueOauthState('nonce-abc', ACCOUNT_A);
      await storage.consumeOauthState('nonce-abc');
      await expect(raw.get('oauth_state:nonce-abc')).resolves.toBeNull();
    });

    it('consume returns null for a nonce that was never issued', async () => {
      const { storage } = makeStorage({});
      await expect(storage.consumeOauthState('never-issued')).resolves.toBeNull();
    });

    it('consume returns { accountId } for a nonce 1ms younger than stateMaxAgeMs', async () => {
      const { storage } = makeStorage({});
      await storage.issueOauthState('nonce-fresh', ACCOUNT_A);
      t = STATE_MAX_AGE_MS - 1;
      await expect(storage.consumeOauthState('nonce-fresh')).resolves.toStrictEqual({
        accountId: ACCOUNT_A,
      });
    });

    it('consume returns null for a nonce aged exactly stateMaxAgeMs AND still deletes the entry (single-use regardless of age)', async () => {
      const { storage, raw } = makeStorage({});
      await storage.issueOauthState('nonce-stale', ACCOUNT_A);
      t = STATE_MAX_AGE_MS;
      await expect(storage.consumeOauthState('nonce-stale')).resolves.toBeNull();
      await expect(raw.get('oauth_state:nonce-stale')).resolves.toBeNull();
    });
  });

  describe('oauth identity (scoped, never cached)', () => {
    it('round-trips the identity object through set then get within the same account scope', async () => {
      const { storage } = makeStorage({});
      await storage.forAccount(ACCOUNT_A).setOauthIdentity({ id: '7', name: 'דנה לוי' });
      await expect(storage.forAccount(ACCOUNT_A).getOauthIdentity()).resolves.toEqual({
        id: '7',
        name: 'דנה לוי',
      });
    });

    it("stores the identity under '111:oauth_identity' and resolves null via forAccount('222')", async () => {
      const { storage, raw } = makeStorage({});
      await storage.forAccount(ACCOUNT_A).setOauthIdentity({ id: '7', name: 'דנה לוי' });
      await expect(raw.get('111:oauth_identity')).resolves.toEqual({ id: '7', name: 'דנה לוי' });
      await expect(storage.forAccount(ACCOUNT_B).getOauthIdentity()).resolves.toBeNull();
    });

    it('hits the backend on EVERY getOauthIdentity call (no caching)', async () => {
      const key = scopedKey(ACCOUNT_A, KEYS.OAUTH_IDENTITY);
      const { storage, getCount } = makeStorage({ [key]: { id: '7', name: 'דנה לוי' } });
      await storage.forAccount(ACCOUNT_A).getOauthIdentity();
      await storage.forAccount(ACCOUNT_A).getOauthIdentity();
      expect(getCount(key)).toBe(2);
    });

    it('resolves null when no identity was stored for the account', async () => {
      const { storage } = makeStorage({});
      await expect(storage.forAccount(ACCOUNT_A).getOauthIdentity()).resolves.toBeNull();
    });
  });
});
