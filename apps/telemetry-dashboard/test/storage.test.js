// Contract tests for src/services/storage.js — the owner-token wrapper:
// a SINGLE global key ('owner:oauth_token') now holding a v2 token RECORD
// (access + rotating refresh + expiry + status; a stored bare string is
// normalized as a LEGACY v1 record), a 60s in-memory read cache (a cached
// read makes NO backend call), write-through cache updates, fail-soft reads,
// an explicit cache invalidation hook for the token provider's in-mutex
// re-read, and the single-use expiring OAuth state nonces (PKCE verifier
// carrier). The backend is a plain injected fake — zero SecureStorage.

import { describe, it, expect, vi } from 'vitest';
import {
  createStorageService,
  OWNER_TOKEN_KEY,
  BOARD_CONFIG_KEY,
  OAUTH_STATE_PREFIX,
} from '../src/services/storage.js';

function makeLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function makeBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
    set: vi.fn(async (key, value) => {
      map.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      map.delete(key);
    }),
    map,
  };
}

const RECORD = {
  v: 2,
  accessToken: 'at-owner-1',
  refreshToken: 'rt-owner-1',
  expiresAt: 1_784_800_000_000,
  obtainedAt: 1_784_700_000_000,
  refreshedAt: null,
  status: 'active',
};

describe('createStorageService — token record get/set/clear', () => {
  it('uses the single global key "owner:oauth_token"', () => {
    expect(OWNER_TOKEN_KEY).toBe('owner:oauth_token');
  });

  it('getOwnerTokenRecord resolves null when nothing is stored', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await expect(storage.getOwnerTokenRecord()).resolves.toBeNull();
    expect(backend.get).toHaveBeenCalledWith(OWNER_TOKEN_KEY);
  });

  it('setOwnerTokenRecord writes through and getOwnerTokenRecord reads it back', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.setOwnerTokenRecord(RECORD);

    expect(backend.set).toHaveBeenCalledWith(OWNER_TOKEN_KEY, RECORD);
    await expect(storage.getOwnerTokenRecord()).resolves.toEqual(RECORD);
  });

  it('normalizes a LEGACY stored bare string to a v1 record (non-expiring, no refresh token)', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: 'at-legacy-bare' });
    const storage = createStorageService({ backend, logger: makeLogger() });

    await expect(storage.getOwnerTokenRecord()).resolves.toEqual({
      v: 1,
      accessToken: 'at-legacy-bare',
      refreshToken: null,
      expiresAt: null,
      obtainedAt: null,
      refreshedAt: null,
      status: 'active',
    });
  });

  it('a corrupt stored value (object without accessToken) degrades to null with a warn', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: { value: 42 } });
    const logger = makeLogger();
    const storage = createStorageService({ backend, logger });

    await expect(storage.getOwnerTokenRecord()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('owner_token_record_invalid', 'storage', expect.any(Object));
  });

  it('clearOwnerToken deletes the key and the very next read sees null with NO backend call', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: RECORD });
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.getOwnerTokenRecord(); // warm the cache
    await storage.clearOwnerToken();

    expect(backend.delete).toHaveBeenCalledWith(OWNER_TOKEN_KEY);
    await expect(storage.getOwnerTokenRecord()).resolves.toBeNull();
    expect(backend.get).toHaveBeenCalledTimes(1); // cache served the post-clear read
  });
});

describe('createStorageService — 60s read cache + invalidation', () => {
  it('a cached read makes NO backend call within the TTL', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: RECORD });
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await expect(storage.getOwnerTokenRecord()).resolves.toEqual(RECORD);
    expect(backend.get).toHaveBeenCalledTimes(1);

    now += 59_000; // still inside the 60s TTL
    await expect(storage.getOwnerTokenRecord()).resolves.toEqual(RECORD);
    expect(backend.get).toHaveBeenCalledTimes(1); // no extra backend call
  });

  it('a read past the TTL hits the backend again', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: RECORD });
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.getOwnerTokenRecord();
    now += 60_001; // just past the TTL
    await storage.getOwnerTokenRecord();

    expect(backend.get).toHaveBeenCalledTimes(2);
  });

  it('setOwnerTokenRecord updates the cache immediately — the very next read is fresh with no backend hit', async () => {
    const backend = makeBackend();
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.getOwnerTokenRecord(); // caches null
    expect(backend.get).toHaveBeenCalledTimes(1);

    await storage.setOwnerTokenRecord(RECORD);
    now += 1_000; // still inside the TTL

    await expect(storage.getOwnerTokenRecord()).resolves.toEqual(RECORD);
    expect(backend.get).toHaveBeenCalledTimes(1); // cache served it, not the backend
  });

  it('invalidateTokenCache forces the next read to hit the backend even inside the TTL', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: RECORD });
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.getOwnerTokenRecord();
    expect(backend.get).toHaveBeenCalledTimes(1);

    storage.invalidateTokenCache();
    now += 1_000; // still inside the TTL

    await storage.getOwnerTokenRecord();
    expect(backend.get).toHaveBeenCalledTimes(2); // cache was dropped
  });
});

describe('createStorageService — fail-soft reads', () => {
  it('a backend.get rejection resolves to null and logs via logger.error (never throws)', async () => {
    const backend = makeBackend();
    backend.get.mockRejectedValueOnce(new Error('storage backend down'));
    const logger = makeLogger();
    const storage = createStorageService({ backend, logger });

    await expect(storage.getOwnerTokenRecord()).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'owner_token_read_failed',
      'storage',
      expect.objectContaining({ error: expect.stringContaining('storage backend down') })
    );
  });
});

describe('createStorageService — OAuth state nonces (single-use, expiring, PKCE carrier)', () => {
  it('issueOauthState stores { createdAt, verifier } under the prefixed nonce key', async () => {
    const backend = makeBackend();
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.issueOauthState('nonce-1', { verifier: 'pkce-verifier-1' });

    expect(backend.map.get(`${OAUTH_STATE_PREFIX}nonce-1`)).toEqual({
      createdAt: 1_000_000,
      verifier: 'pkce-verifier-1',
    });
  });

  it('consumeOauthState returns the verifier ONCE — the record is gone afterwards (replay-proof)', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.issueOauthState('nonce-1', { verifier: 'pkce-verifier-1' });

    await expect(storage.consumeOauthState('nonce-1')).resolves.toEqual({
      verifier: 'pkce-verifier-1',
    });
    expect(backend.map.has(`${OAUTH_STATE_PREFIX}nonce-1`)).toBe(false);
    await expect(storage.consumeOauthState('nonce-1')).resolves.toBeNull();
  });

  it('an unknown nonce resolves null', async () => {
    const storage = createStorageService({ backend: makeBackend(), logger: makeLogger() });
    await expect(storage.consumeOauthState('never-issued')).resolves.toBeNull();
  });

  it('TTL boundary: consumable at 10min minus 1ms, expired (and still deleted) AT 10min', async () => {
    const backend = makeBackend();
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.issueOauthState('n-fresh', { verifier: 'v-fresh' });
    await storage.issueOauthState('n-stale', { verifier: 'v-stale' });

    now = 1_000_000 + 10 * 60_000 - 1;
    await expect(storage.consumeOauthState('n-fresh')).resolves.toEqual({ verifier: 'v-fresh' });

    now = 1_000_000 + 10 * 60_000;
    await expect(storage.consumeOauthState('n-stale')).resolves.toBeNull();
    expect(backend.map.has(`${OAUTH_STATE_PREFIX}n-stale`)).toBe(false); // consumed regardless of age
  });
});

describe('createStorageService — board config (separate key + cache)', () => {
  const CONFIG = { boardId: '123', groupId: 'g1', columns: { app: 'text_1' } };

  it('uses the single global key "lifecycle:board_config"', () => {
    expect(BOARD_CONFIG_KEY).toBe('lifecycle:board_config');
  });

  it('getBoardConfig resolves null when nothing is stored', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await expect(storage.getBoardConfig()).resolves.toBeNull();
    expect(backend.get).toHaveBeenCalledWith(BOARD_CONFIG_KEY);
  });

  it('setBoardConfig writes through and getBoardConfig reads it back', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.setBoardConfig(CONFIG);

    expect(backend.set).toHaveBeenCalledWith(BOARD_CONFIG_KEY, CONFIG);
    await expect(storage.getBoardConfig()).resolves.toEqual(CONFIG);
  });

  it('caches for 60s (a cached read makes no backend call) and setBoardConfig updates the cache immediately', async () => {
    const backend = makeBackend({ [BOARD_CONFIG_KEY]: CONFIG });
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.getBoardConfig();
    expect(backend.get).toHaveBeenCalledTimes(1);
    now += 59_000;
    await storage.getBoardConfig();
    expect(backend.get).toHaveBeenCalledTimes(1); // served from cache

    await storage.setBoardConfig({ ...CONFIG, boardId: '999' });
    await expect(storage.getBoardConfig()).resolves.toMatchObject({ boardId: '999' });
    expect(backend.get).toHaveBeenCalledTimes(1); // cache, not backend
  });

  it('the board-config cache is INDEPENDENT of the owner-token cache', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.setOwnerTokenRecord(RECORD);
    await storage.setBoardConfig(CONFIG);

    await expect(storage.getOwnerTokenRecord()).resolves.toEqual(RECORD);
    await expect(storage.getBoardConfig()).resolves.toEqual(CONFIG);
  });

  it('a non-object stored value degrades to null (defensive)', async () => {
    const backend = makeBackend({ [BOARD_CONFIG_KEY]: 'corrupt-string' });
    const storage = createStorageService({ backend, logger: makeLogger() });

    await expect(storage.getBoardConfig()).resolves.toBeNull();
  });

  it('a backend.get rejection resolves to null and logs board_config_read_failed (never throws)', async () => {
    const backend = makeBackend();
    backend.get.mockRejectedValueOnce(new Error('config backend down'));
    const logger = makeLogger();
    const storage = createStorageService({ backend, logger });

    await expect(storage.getBoardConfig()).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'board_config_read_failed',
      'storage',
      expect.objectContaining({ error: expect.stringContaining('config backend down') })
    );
  });
});
