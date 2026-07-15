// App storage over a SecureStorage-compatible backend, with a 60s in-memory
// read cache for the hot /confirm path (spec §4). ALL keys live in
// SecureStorage (owner decision 2026-07-14 — the spec's Storage/SecureStorage
// split collapsed to SecureStorage only, single-tenant).
//
// Keys: config | link_secret | oauth_token | oauth_identity | oauth_state:<nonce>

export const KEYS = {
  CONFIG: 'config',
  LINK_SECRET: 'link_secret',
  OAUTH_TOKEN: 'oauth_token',
  OAUTH_IDENTITY: 'oauth_identity',
  OAUTH_STATE_PREFIX: 'oauth_state:',
};

/**
 * @typedef {object} StorageBackend - SecureStorage-compatible
 * @property {(key: string) => Promise<any>} get - resolves stored value or null/undefined
 * @property {(key: string, value: any) => Promise<any>} set
 * @property {(key: string) => Promise<any>} delete
 */

/**
 * Create the app storage layer.
 *
 * Caching contract (spec §4): `config`, `link_secret`, `oauth_token` reads
 * are cached in memory for `ttlMs`; a cached read performs NO backend call.
 * After `ttlMs` elapses the next read hits the backend again. ANY write
 * through this layer invalidates the whole read cache immediately (admin
 * writes must be visible on the next click).
 *
 * OAuth state nonces (CSRF, spec §8): `issueOauthState(nonce)` persists
 * `oauth_state:<nonce>` with the issue time; `consumeOauthState(nonce)`
 * is SINGLE-USE — it deletes the entry and returns true only when the entry
 * existed and is younger than `stateMaxAgeMs` (default 10 min). Never cached.
 *
 * `oauth_identity` ({ id, name }) is admin-display data — read/write through,
 * never cached.
 *
 * @param {object} opts
 * @param {StorageBackend} opts.backend
 * @param {number} [opts.ttlMs=60000]
 * @param {number} [opts.stateMaxAgeMs=600000]
 * @param {() => number} [opts.now=Date.now]
 */
export function createAppStorage({ backend, ttlMs = 60_000, stateMaxAgeMs = 600_000, now = Date.now }) {
  /** @type {Map<string, { value: any, cachedAt: number }>} */
  const cache = new Map();

  function invalidateCache() {
    cache.clear();
  }

  async function cachedGet(key) {
    const entry = cache.get(key);
    if (entry && now() - entry.cachedAt < ttlMs) return entry.value;
    const value = (await backend.get(key)) ?? null;
    cache.set(key, { value, cachedAt: now() });
    return value;
  }

  async function write(key, value) {
    await backend.set(key, value);
    invalidateCache();
  }

  return {
    getConfig: () => cachedGet(KEYS.CONFIG),
    setConfig: (config) => write(KEYS.CONFIG, config),

    getLinkSecret: () => cachedGet(KEYS.LINK_SECRET),
    setLinkSecret: (secret) => write(KEYS.LINK_SECRET, secret),

    getOauthToken: () => cachedGet(KEYS.OAUTH_TOKEN),
    setOauthToken: (token) => write(KEYS.OAUTH_TOKEN, token),

    async getOauthIdentity() {
      return (await backend.get(KEYS.OAUTH_IDENTITY)) ?? null;
    },
    async setOauthIdentity(identity) {
      await backend.set(KEYS.OAUTH_IDENTITY, identity);
    },

    async issueOauthState(nonce) {
      await backend.set(`${KEYS.OAUTH_STATE_PREFIX}${nonce}`, { createdAt: now() });
    },

    async consumeOauthState(nonce) {
      const key = `${KEYS.OAUTH_STATE_PREFIX}${nonce}`;
      const entry = (await backend.get(key)) ?? null;
      if (!entry) return false;
      await backend.delete(key); // single-use: gone regardless of age
      return now() - entry.createdAt < stateMaxAgeMs;
    },

    invalidateCache,
  };
}
