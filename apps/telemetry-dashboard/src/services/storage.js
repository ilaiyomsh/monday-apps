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
// The lifecycle events board config: { boardId, groupId, columns:{logical→id} }.
// A SINGLE global key (no tenancy — one operator, mirroring the owner token).
// Written by the Settings UI provisioning flow, read per-event by events-board.
export const BOARD_CONFIG_KEY = 'lifecycle:board_config';

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
 * @returns {{
 *   getOwnerToken: () => Promise<string|null>,
 *   setOwnerToken: (token: string) => Promise<void>,
 *   getBoardConfig: () => Promise<object|null>,
 *   setBoardConfig: (config: object) => Promise<void>,
 * }}
 */
export function createStorageService({ backend, logger, ttlMs = 60_000, now = Date.now }) {
  /** @type {{ value: string|null, cachedAt: number } | null} */
  let cachedToken = null;
  /** @type {{ value: object|null, cachedAt: number } | null} */
  let cachedConfig = null;

  return {
    /** Cached read (60s TTL). Never throws — a backend failure degrades to null. */
    async getOwnerToken() {
      if (cachedToken && now() - cachedToken.cachedAt < ttlMs) return cachedToken.value;
      let value = null;
      try {
        value = (await backend.get(OWNER_TOKEN_KEY)) ?? null;
      } catch (err) {
        logger.error('owner_token_read_failed', 'storage', { error: String(err?.message ?? err) });
        value = null;
      }
      cachedToken = { value, cachedAt: now() };
      return value;
    },

    /** Write-through; updates the cache immediately (visible on the next read). */
    async setOwnerToken(token) {
      await backend.set(OWNER_TOKEN_KEY, token);
      cachedToken = { value: token, cachedAt: now() };
    },

    /**
     * The events-board config, cached (60s TTL). Never throws — a backend
     * failure degrades to null so the webhook path stays fail-soft. A stored
     * value that is not a plain object also degrades to null.
     * @returns {Promise<object|null>}
     */
    async getBoardConfig() {
      if (cachedConfig && now() - cachedConfig.cachedAt < ttlMs) return cachedConfig.value;
      let value = null;
      try {
        const raw = await backend.get(BOARD_CONFIG_KEY);
        value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
      } catch (err) {
        logger.error('board_config_read_failed', 'storage', {
          error: String(err?.message ?? err),
        });
        value = null;
      }
      cachedConfig = { value, cachedAt: now() };
      return value;
    },

    /** Write-through; updates the cache immediately (visible on the next read). */
    async setBoardConfig(config) {
      await backend.set(BOARD_CONFIG_KEY, config);
      cachedConfig = { value: config, cachedAt: now() };
    },
  };
}
