// Contract tests for src/services/storage.js — the owner-token wrapper:
// a SINGLE global key ('owner:oauth_token'), a 60s in-memory read cache (a
// cached read makes NO backend call), a write updates the cache immediately,
// and a backend read failure fails soft (logs, resolves null) rather than
// throwing into the monday-api / oauth call sites. The backend is a plain
// injected fake — zero SecureStorage, zero env.

import { describe, it, expect, vi } from 'vitest';
import { createStorageService, OWNER_TOKEN_KEY } from '../src/services/storage.js';

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

describe('createStorageService — key + basic get/set', () => {
  it('uses the single global key "owner:oauth_token"', () => {
    expect(OWNER_TOKEN_KEY).toBe('owner:oauth_token');
  });

  it('getOwnerToken resolves null when nothing is stored', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await expect(storage.getOwnerToken()).resolves.toBeNull();
    expect(backend.get).toHaveBeenCalledWith(OWNER_TOKEN_KEY);
  });

  it('setOwnerToken writes through to the backend under the global key', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.setOwnerToken('at-owner-1');

    expect(backend.set).toHaveBeenCalledWith(OWNER_TOKEN_KEY, 'at-owner-1');
    expect(backend.map.get(OWNER_TOKEN_KEY)).toBe('at-owner-1');
  });

  it('getOwnerToken reads back a token stored via setOwnerToken', async () => {
    const backend = makeBackend();
    const storage = createStorageService({ backend, logger: makeLogger() });

    await storage.setOwnerToken('at-owner-2');

    await expect(storage.getOwnerToken()).resolves.toBe('at-owner-2');
  });
});

describe('createStorageService — 60s read cache', () => {
  it('a cached read makes NO backend call within the TTL', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: 'at-cached' });
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await expect(storage.getOwnerToken()).resolves.toBe('at-cached');
    expect(backend.get).toHaveBeenCalledTimes(1);

    now += 59_000; // still inside the 60s TTL
    await expect(storage.getOwnerToken()).resolves.toBe('at-cached');
    expect(backend.get).toHaveBeenCalledTimes(1); // no extra backend call
  });

  it('a read past the TTL hits the backend again', async () => {
    const backend = makeBackend({ [OWNER_TOKEN_KEY]: 'at-cached' });
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.getOwnerToken();
    now += 60_001; // just past the TTL
    await storage.getOwnerToken();

    expect(backend.get).toHaveBeenCalledTimes(2);
  });

  it('setOwnerToken updates the cache immediately — the very next read is fresh with no backend hit', async () => {
    const backend = makeBackend();
    let now = 1_000_000;
    const storage = createStorageService({ backend, logger: makeLogger(), now: () => now });

    await storage.getOwnerToken(); // caches null
    expect(backend.get).toHaveBeenCalledTimes(1);

    await storage.setOwnerToken('at-fresh');
    now += 1_000; // still inside the TTL

    await expect(storage.getOwnerToken()).resolves.toBe('at-fresh');
    expect(backend.get).toHaveBeenCalledTimes(1); // cache served it, not the backend
  });
});

describe('createStorageService — fail-soft reads', () => {
  it('a backend.get rejection resolves to null and logs via logger.error (never throws)', async () => {
    const backend = makeBackend();
    backend.get.mockRejectedValueOnce(new Error('storage backend down'));
    const logger = makeLogger();
    const storage = createStorageService({ backend, logger });

    await expect(storage.getOwnerToken()).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'owner_token_read_failed',
      'storage',
      expect.objectContaining({ error: expect.stringContaining('storage backend down') })
    );
  });
});
