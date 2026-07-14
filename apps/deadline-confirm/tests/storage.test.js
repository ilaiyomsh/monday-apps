// Contract tests for src/services/storage.js — spec §4: 60s read cache for
// config/link_secret/oauth_token, cache invalidation on any admin write,
// single-use OAuth state nonces (§8, 10-min expiry). Backend fake is the
// real (implemented) memory backend, wrapped to count calls.

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStorage, KEYS } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const TTL_MS = 60_000;
const STATE_MAX_AGE_MS = 600_000;

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

describe('createAppStorage', () => {
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

  describe('read cache (config / link_secret / oauth_token)', () => {
    const cachedReads = [
      {
        label: 'getConfig',
        key: KEYS.CONFIG,
        seeded: CONFIG_FIXTURE,
        updated: { ...CONFIG_FIXTURE, toIndex: 2, toLabel: 'הושלם' },
        read: (s) => s.getConfig(),
      },
      {
        label: 'getLinkSecret',
        key: KEYS.LINK_SECRET,
        seeded: 'q7XnT4vB9sLcRw2mZaK8yFdE1gHj0uOiPp5rNtMxWk3',
        updated: 'ROTATED_ROTATED_ROTATED_ROTATED_ROTATED_43x',
        read: (s) => s.getLinkSecret(),
      },
      {
        label: 'getOauthToken',
        key: KEYS.OAUTH_TOKEN,
        seeded: 'tok_original',
        updated: 'tok_replaced',
        read: (s) => s.getOauthToken(),
      },
    ];

    it.each(cachedReads)(
      '$label hits the backend exactly once for the first read and returns the stored value',
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

    it('getConfig resolves null when nothing was ever stored', async () => {
      const { storage } = makeStorage({});
      await expect(storage.getConfig()).resolves.toBeNull();
    });
  });

  describe('write invalidation', () => {
    const writePairs = [
      {
        label: 'setConfig/getConfig',
        key: KEYS.CONFIG,
        seeded: CONFIG_FIXTURE,
        updated: { ...CONFIG_FIXTURE, fromIndex: 3, fromLabel: 'ממתין' },
        read: (s) => s.getConfig(),
        write: (s, v) => s.setConfig(v),
      },
      {
        label: 'setLinkSecret/getLinkSecret',
        key: KEYS.LINK_SECRET,
        seeded: 'q7XnT4vB9sLcRw2mZaK8yFdE1gHj0uOiPp5rNtMxWk3',
        updated: 'NEWSECRET_NEWSECRET_NEWSECRET_NEWSECRET_43x',
        read: (s) => s.getLinkSecret(),
        write: (s, v) => s.setLinkSecret(v),
      },
      {
        label: 'setOauthToken/getOauthToken',
        key: KEYS.OAUTH_TOKEN,
        seeded: 'tok_original',
        updated: 'tok_reconnected',
        read: (s) => s.getOauthToken(),
        write: (s, v) => s.setOauthToken(v),
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
      const key = KEYS.LINK_SECRET;
      const { storage, raw, getCount } = makeStorage({ [key]: 'OLD_SECRET' });
      await storage.getLinkSecret(); // warm cache

      await raw.set(key, 'NEW_SECRET'); // bypasses the storage layer — cache must NOT notice
      await expect(storage.getLinkSecret()).resolves.toBe('OLD_SECRET');
      expect(getCount(key)).toBe(1); // stale read came from cache, not backend

      storage.invalidateCache();
      await expect(storage.getLinkSecret()).resolves.toBe('NEW_SECRET');
      expect(getCount(key)).toBe(2);
    });

    it('a write to one key invalidates the WHOLE cache: a warm link_secret re-reads after setConfig', async () => {
      const { storage, raw } = makeStorage({
        [KEYS.LINK_SECRET]: 'OLD_SECRET',
        [KEYS.CONFIG]: CONFIG_FIXTURE,
      });
      await storage.getLinkSecret(); // warm link_secret cache
      await raw.set(KEYS.LINK_SECRET, 'NEW_SECRET'); // out-of-band change

      await storage.setConfig({ ...CONFIG_FIXTURE, toIndex: 5 }); // write on a DIFFERENT key
      await expect(storage.getLinkSecret()).resolves.toBe('NEW_SECRET');
    });
  });

  describe('OAuth state nonces (single-use CSRF)', () => {
    it('persists an issued nonce under the backend key "oauth_state:<nonce>"', async () => {
      const { storage, raw } = makeStorage({});
      await storage.issueOauthState('nonce-abc');
      await expect(raw.get('oauth_state:nonce-abc')).resolves.not.toBeNull();
    });

    it('consume returns true exactly once and false for the second consume of the same nonce', async () => {
      const { storage } = makeStorage({});
      await storage.issueOauthState('nonce-abc');
      await expect(storage.consumeOauthState('nonce-abc')).resolves.toBe(true);
      await expect(storage.consumeOauthState('nonce-abc')).resolves.toBe(false);
    });

    it('deletes the backend entry when a nonce is consumed', async () => {
      const { storage, raw } = makeStorage({});
      await storage.issueOauthState('nonce-abc');
      await storage.consumeOauthState('nonce-abc');
      await expect(raw.get('oauth_state:nonce-abc')).resolves.toBeNull();
    });

    it('consume returns false for a nonce that was never issued', async () => {
      const { storage } = makeStorage({});
      await expect(storage.consumeOauthState('never-issued')).resolves.toBe(false);
    });

    it('consume returns true for a nonce 1ms younger than stateMaxAgeMs', async () => {
      const { storage } = makeStorage({});
      await storage.issueOauthState('nonce-fresh');
      t = STATE_MAX_AGE_MS - 1;
      await expect(storage.consumeOauthState('nonce-fresh')).resolves.toBe(true);
    });

    it('consume returns false for a nonce whose age is exactly stateMaxAgeMs (no longer younger)', async () => {
      const { storage } = makeStorage({});
      await storage.issueOauthState('nonce-stale');
      t = STATE_MAX_AGE_MS;
      await expect(storage.consumeOauthState('nonce-stale')).resolves.toBe(false);
    });
  });

  describe('oauth identity (never cached)', () => {
    it('round-trips the identity object through set then get', async () => {
      const { storage } = makeStorage({});
      await storage.setOauthIdentity({ id: '7', name: 'דנה לוי' });
      await expect(storage.getOauthIdentity()).resolves.toEqual({ id: '7', name: 'דנה לוי' });
    });

    it('hits the backend on EVERY getOauthIdentity call (no caching)', async () => {
      const { storage, getCount } = makeStorage({
        [KEYS.OAUTH_IDENTITY]: { id: '7', name: 'דנה לוי' },
      });
      await storage.getOauthIdentity();
      await storage.getOauthIdentity();
      expect(getCount(KEYS.OAUTH_IDENTITY)).toBe(2);
    });

    it('resolves null when no identity was stored', async () => {
      const { storage } = makeStorage({});
      await expect(storage.getOauthIdentity()).resolves.toBeNull();
    });
  });
});
