// T9b storage surface — the tenant's Gmail sending identity.
//
// Two properties carry real weight here and are the reason this is a separate
// suite rather than a line in storage.test.js:
//
//  1. ACCOUNT SCOPING. Owner decision 2026-07-29: each organization sends from
//     its own internal mailbox, so the record must sit under `${accountId}:`.
//     (D13 had specified an unprefixed app-global key for a single vendor
//     mailbox.) An unprefixed key would hand the first tenant to connect the
//     sending identity of every other tenant.
//  2. NO READ CACHE. The record carries the access token WITH its expiry, and
//     gmail-sender.js decides whether to refresh from that timestamp. The
//     60s read cache against a 60s refresh cushion could hand back a token
//     that expires mid-send, so these accessors must read through.

import { describe, it, expect } from 'vitest';
import { createAppStorage, KEYS } from '../src/services/storage.js';

/** Backend double that counts every get so cache behaviour is observable. */
function countingBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  const gets = [];
  return {
    data,
    gets,
    get: async (key) => {
      gets.push(key);
      return data.get(key) ?? null;
    },
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

const RECORD = {
  refreshToken: 'rt1',
  accessToken: 'at1',
  accessTokenExpiresAt: 999,
  senderAddress: 'deadline@twyst.co.il',
  connectedAt: 1,
};

describe('google sender record — key scoping', () => {
  it('writes under the account prefix, never an app-global key', async () => {
    const backend = countingBackend();
    const storage = createAppStorage({ backend });
    await storage.forAccount('111').setGoogleSender(RECORD);
    expect([...backend.data.keys()]).toEqual([`111:${KEYS.GOOGLE_SENDER}`]);
    expect(backend.data.has(KEYS.GOOGLE_SENDER)).toBe(false);
  });

  it('round-trips the record for its own account', async () => {
    const storage = createAppStorage({ backend: countingBackend() });
    await storage.forAccount('111').setGoogleSender(RECORD);
    await expect(storage.forAccount('111').getGoogleSender()).resolves.toEqual(RECORD);
  });

  it('does not leak one tenant sending identity to another', async () => {
    const storage = createAppStorage({ backend: countingBackend() });
    await storage.forAccount('111').setGoogleSender(RECORD);
    await expect(storage.forAccount('222').getGoogleSender()).resolves.toBeNull();
  });

  it('returns null — not undefined — when the tenant never connected', async () => {
    const storage = createAppStorage({ backend: countingBackend() });
    await expect(storage.forAccount('333').getGoogleSender()).resolves.toBeNull();
  });
});

describe('google sender record — read-through, not cached', () => {
  it('hits the backend on every read so a refreshed token is never served stale', async () => {
    const backend = countingBackend({ [`111:${KEYS.GOOGLE_SENDER}`]: RECORD });
    // Frozen clock: a cached read would be inside the TTL and skip the backend.
    const storage = createAppStorage({ backend, now: () => 1_000 });
    await storage.forAccount('111').getGoogleSender();
    await storage.forAccount('111').getGoogleSender();
    expect(backend.gets.filter((k) => k === `111:${KEYS.GOOGLE_SENDER}`)).toHaveLength(2);
  });

  it('serves the token written by a refresh, not the one read a moment earlier', async () => {
    const backend = countingBackend({ [`111:${KEYS.GOOGLE_SENDER}`]: RECORD });
    const storage = createAppStorage({ backend, now: () => 1_000 });
    const scoped = storage.forAccount('111');
    await scoped.getGoogleSender();
    await scoped.setGoogleSender({ ...RECORD, accessToken: 'at2', accessTokenExpiresAt: 5_000 });
    await expect(scoped.getGoogleSender()).resolves.toMatchObject({ accessToken: 'at2' });
  });
});
