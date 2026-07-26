// Owner-token storage — Change #143 (app-identity OAuth), #144 (OAuth 2.1).
// This app has exactly ONE operator: the owner authorizes once at
// /oauth/start and the resulting credential is the app's write identity for
// the lifecycle events board. Unlike deadline-confirm's v3 multi-tenant
// storage (per-account key prefixes), there is no tenancy here — a SINGLE
// global SecureStorage key holds the token record. Same 60s in-memory read
// cache contract as deadline-confirm's createAppStorage: a cached read makes
// NO backend call; a write updates the cache immediately so the very next
// read (e.g. the first board write attempt right after /oauth/callback)
// sees it.
//
// OAuth 2.1 (Change #144): the key now holds a v2 RECORD — access token +
// rotating refresh token + expiry + status — instead of a bare string. A
// bare string still stored from the legacy flow is normalized to a v1
// record (non-expiring, no refresh token) so it keeps working untouched.
// The single-use expiring `oauth_state:<nonce>` entries (CSRF state +
// PKCE verifier carrier, mirroring deadline-confirm's) also live here and
// are NEVER cached.
//
// All collaborators are injected — this module imports nothing.

export const OWNER_TOKEN_KEY = 'owner:oauth_token';
// The lifecycle events board config: { boardId, groupId, columns:{logical→id} }.
// A SINGLE global key (no tenancy — one operator, mirroring the owner token).
// Written by the Settings UI provisioning flow, read per-event by events-board.
export const BOARD_CONFIG_KEY = 'lifecycle:board_config';
// Single-use OAuth state nonces: `oauth_state:<nonce>` → { createdAt, verifier }.
export const OAUTH_STATE_PREFIX = 'oauth_state:';

/**
 * @typedef {object} OwnerTokenRecord
 * @property {1|2} v - 1 = legacy bare-string normalization, 2 = OAuth 2.1
 * @property {string|null} accessToken
 * @property {string|null} refreshToken - null on legacy records (never refreshed)
 * @property {number|null} expiresAt - ms epoch (JWT exp, decode-only); null = non-expiring legacy
 * @property {number|null} obtainedAt - ORIGINAL authorization time (the 6-month anchor)
 * @property {number|null} refreshedAt
 * @property {'active'|'reauth_required'} status
 */

/**
 * @typedef {object} StorageBackend - SecureStorage-compatible
 * @property {(key: string) => Promise<any>} get - resolves stored value or null/undefined
 * @property {(key: string, value: any) => Promise<any>} set
 * @property {(key: string) => Promise<any>} delete
 */

/**
 * Normalize whatever is stored under OWNER_TOKEN_KEY to an OwnerTokenRecord.
 * A bare string = a token stored by the LEGACY flow → v1 record. A corrupt
 * value degrades to null (fail-soft; the warn is the caller's signal).
 * @param {unknown} raw
 * @returns {{ record: OwnerTokenRecord|null, corrupt: boolean }}
 */
function normalizeOwnerToken(raw) {
  if (raw == null) return { record: null, corrupt: false };
  if (typeof raw === 'string') {
    return {
      record: {
        v: 1,
        accessToken: raw,
        refreshToken: null,
        expiresAt: null,
        obtainedAt: null,
        refreshedAt: null,
        status: 'active',
      },
      corrupt: false,
    };
  }
  if (
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    ('accessToken' in raw || raw.status === 'reauth_required')
  ) {
    return { record: /** @type {OwnerTokenRecord} */ (raw), corrupt: false };
  }
  return { record: null, corrupt: true };
}

/**
 * @param {object} opts
 * @param {StorageBackend} opts.backend
 * @param {object} opts.logger - app logger (`(message, tag, context)` shape)
 * @param {number} [opts.ttlMs=60000]
 * @param {number} [opts.stateMaxAgeMs=600000] - OAuth state nonce TTL (10 min)
 * @param {() => number} [opts.now=Date.now]
 * @returns {{
 *   getOwnerTokenRecord: () => Promise<OwnerTokenRecord|null>,
 *   setOwnerTokenRecord: (record: OwnerTokenRecord) => Promise<void>,
 *   clearOwnerToken: () => Promise<void>,
 *   invalidateTokenCache: () => void,
 *   issueOauthState: (nonce: string, payload: { verifier: string }) => Promise<void>,
 *   consumeOauthState: (nonce: string) => Promise<{ verifier: string }|null>,
 *   getBoardConfig: () => Promise<object|null>,
 *   setBoardConfig: (config: object) => Promise<void>,
 * }}
 */
export function createStorageService({
  backend,
  logger,
  ttlMs = 60_000,
  stateMaxAgeMs = 600_000,
  now = Date.now,
}) {
  /** @type {{ value: OwnerTokenRecord|null, cachedAt: number } | null} */
  let cachedToken = null;
  /** @type {{ value: object|null, cachedAt: number } | null} */
  let cachedConfig = null;

  return {
    /**
     * Cached read (60s TTL). Never throws — a backend failure degrades to
     * null. A legacy bare-string value is normalized to a v1 record.
     */
    async getOwnerTokenRecord() {
      if (cachedToken && now() - cachedToken.cachedAt < ttlMs) return cachedToken.value;
      let value = null;
      try {
        const raw = (await backend.get(OWNER_TOKEN_KEY)) ?? null;
        const { record, corrupt } = normalizeOwnerToken(raw);
        if (corrupt) {
          logger.warn('owner_token_record_invalid', 'storage', {});
        }
        value = record;
      } catch (err) {
        logger.error('owner_token_read_failed', 'storage', { error: String(err?.message ?? err) });
        value = null;
      }
      cachedToken = { value, cachedAt: now() };
      return value;
    },

    /** Write-through; updates the cache immediately (visible on the next read). */
    async setOwnerTokenRecord(record) {
      await backend.set(OWNER_TOKEN_KEY, record);
      cachedToken = { value: record, cachedAt: now() };
    },

    /** Delete + immediate cache visibility (disconnect must never resurrect). */
    async clearOwnerToken() {
      await backend.delete(OWNER_TOKEN_KEY);
      cachedToken = { value: null, cachedAt: now() };
    },

    /**
     * Drop the token cache so the next read hits the backend — used by the
     * token provider's single-flight refresh to re-read before spending the
     * SINGLE-USE refresh token.
     */
    invalidateTokenCache() {
      cachedToken = null;
    },

    /**
     * Store a single-use OAuth state nonce carrying the PKCE verifier
     * (mirrors deadline-confirm's issueOauthState). Never cached.
     */
    async issueOauthState(nonce, { verifier }) {
      await backend.set(`${OAUTH_STATE_PREFIX}${nonce}`, { createdAt: now(), verifier });
    },

    /**
     * Consume a state nonce: deleted on FIRST read regardless of age
     * (replay-proof), null when unknown or older than stateMaxAgeMs.
     */
    async consumeOauthState(nonce) {
      const key = `${OAUTH_STATE_PREFIX}${nonce}`;
      const entry = (await backend.get(key)) ?? null;
      if (!entry) return null;
      await backend.delete(key); // single-use: gone regardless of age
      if (now() - entry.createdAt >= stateMaxAgeMs) return null;
      return { verifier: entry.verifier };
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
