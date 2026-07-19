// Owner-token storage — Change #143 continuation (app-identity OAuth). This
// app has exactly ONE operator: the owner authorizes once at /oauth/start and
// the resulting token is the app's write credential for the lifecycle events
// board. Unlike deadline-confirm's v3 multi-tenant storage (per-account key
// prefixes), there is no tenancy here — a SINGLE global SecureStorage key
// holds the token. Same 60s in-memory read cache contract as
// deadline-confirm's createAppStorage: a cached read makes NO backend call;
// a write updates the cache immediately so the very next read (e.g. the
// first board write attempt right after /oauth/callback) sees it.
//
// All collaborators are injected — this module imports nothing.

export const OWNER_TOKEN_KEY = 'owner:oauth_token';

/**
 * @typedef {object} StorageBackend - SecureStorage-compatible
 * @property {(key: string) => Promise<any>} get - resolves stored value or null/undefined
 * @property {(key: string, value: any) => Promise<any>} set
 * @property {(key: string) => Promise<any>} delete
 */

/**
 * @param {object} opts
 * @param {StorageBackend} opts.backend
 * @param {object} opts.logger - app logger (`(message, tag, context)` shape)
 * @param {number} [opts.ttlMs=60000]
 * @param {() => number} [opts.now=Date.now]
 * @returns {{ getOwnerToken: () => Promise<string|null>, setOwnerToken: (token: string) => Promise<void> }}
 */
export function createStorageService({ backend, logger, ttlMs = 60_000, now = Date.now }) {
  /** @type {{ value: string|null, cachedAt: number } | null} */
  let cached = null;

  return {
    /** Cached read (60s TTL). Never throws — a backend failure degrades to null. */
    async getOwnerToken() {
      if (cached && now() - cached.cachedAt < ttlMs) return cached.value;
      let value = null;
      try {
        value = (await backend.get(OWNER_TOKEN_KEY)) ?? null;
      } catch (err) {
        logger.error('owner_token_read_failed', 'storage', { error: String(err?.message ?? err) });
        value = null;
      }
      cached = { value, cachedAt: now() };
      return value;
    },

    /** Write-through; updates the cache immediately (visible on the next read). */
    async setOwnerToken(token) {
      await backend.set(OWNER_TOKEN_KEY, token);
      cached = { value: token, cachedAt: now() };
    },
  };
}
