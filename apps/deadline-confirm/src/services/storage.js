// App storage over a SecureStorage-compatible backend, with a 60s in-memory
// read cache for the hot /confirm path (spec §4). ALL keys live in
// SecureStorage; v3 is multi-tenant — every account's data sits under its own
// `${accountId}:` key prefix (SecureStorage is segregated per APP only, so
// account isolation is this layer's job).
//
// Keys: <accountId>:config | <accountId>:link_secret | <accountId>:oauth_token
//       <accountId>:oauth_identity | oauth_state:<nonce> (nonce unprefixed —
//       globally unique; the record carries the accountId)

export const KEYS = {
  CONFIG: 'config',
  LINK_SECRET: 'link_secret',
  OAUTH_TOKEN: 'oauth_token',
  OAUTH_IDENTITY: 'oauth_identity',
  OAUTH_STATE_PREFIX: 'oauth_state:',
  // T9b: the tenant's Gmail sending identity. Owner decision 2026-07-29 —
  // each ORGANIZATION runs its own Google OAuth client and sends from its own
  // internal mailbox, so this record is account-scoped like everything else.
  // (This supersedes D13, which specified an unprefixed app-global key for a
  // single vendor-owned mailbox.) Sharing one record across tenants would mean
  // the first tenant to connect owns everyone else's sending identity.
  GOOGLE_SENDER: 'google_sender',
  // Separate namespace from OAUTH_STATE_PREFIX — see issueGoogleOauthState.
  GOOGLE_OAUTH_STATE_PREFIX: 'google_oauth_state:',
  // Who has already been emailed in the CURRENT slot: { slot, personIds }.
  // One key per tenant, not one per slot — the stored slot IS the expiry, so a
  // record from an earlier slot reads as an empty slate and nothing accumulates.
  DIGEST_SENT: 'digest_sent',
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
 * Caching contract (spec §4): per-account `config`, `link_secret`,
 * `oauth_token` reads are cached in memory for `ttlMs`; a cached read
 * performs NO backend call. After `ttlMs` elapses the next read hits the
 * backend again. ANY write through this layer — any account — invalidates
 * the whole read cache immediately (admin writes must be visible on the
 * next click). The cache is keyed by the full prefixed key, so one
 * account's hot entry can never serve another account.
 *
 * OAuth state nonces (CSRF, spec §8): `issueOauthState(nonce, accountId)`
 * persists `oauth_state:<nonce>` with the issue time and owning account;
 * `consumeOauthState(nonce)` is SINGLE-USE — it deletes the entry and
 * returns `{ accountId }` only when the entry existed and is younger than
 * `stateMaxAgeMs` (default 10 min), else null. Never cached.
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

  /** Single-use, age-bounded state read shared by both OAuth flows. */
  async function consumeState(key) {
    const entry = (await backend.get(key)) ?? null;
    if (!entry) return null;
    await backend.delete(key); // single-use: gone regardless of age
    if (now() - entry.createdAt >= stateMaxAgeMs) return null;
    return { accountId: entry.accountId };
  }

  /**
   * Account-scoped accessors — the only way to reach config/secret/token.
   * @param {string} accountId
   */
  function forAccount(accountId) {
    const scopedKey = (name) => `${accountId}:${name}`;
    return {
      getConfig: () => cachedGet(scopedKey(KEYS.CONFIG)),
      setConfig: (config) => write(scopedKey(KEYS.CONFIG), config),

      getLinkSecret: () => cachedGet(scopedKey(KEYS.LINK_SECRET)),
      setLinkSecret: (secret) => write(scopedKey(KEYS.LINK_SECRET), secret),

      getOauthToken: () => cachedGet(scopedKey(KEYS.OAUTH_TOKEN)),
      setOauthToken: (token) => write(scopedKey(KEYS.OAUTH_TOKEN), token),

      async getOauthIdentity() {
        return (await backend.get(scopedKey(KEYS.OAUTH_IDENTITY))) ?? null;
      },
      async setOauthIdentity(identity) {
        await backend.set(scopedKey(KEYS.OAUTH_IDENTITY), identity);
      },

      // Google sending identity — read/write THROUGH, never cached. The record
      // carries the access token with its expiry, and gmail-sender.js decides
      // to refresh from that timestamp; a 60s-stale read against a 60s refresh
      // cushion could hand out a token that expires mid-send.
      async getGoogleSender() {
        return (await backend.get(scopedKey(KEYS.GOOGLE_SENDER))) ?? null;
      },
      async setGoogleSender(record) {
        await backend.set(scopedKey(KEYS.GOOGLE_SENDER), record);
      },

      // Per-slot send marker — read/write THROUGH, never cached, and the reason
      // is a number: the platform's scheduler retries with a 60s default backoff
      // and this cache holds entries for 60s. A cached read is exactly the window
      // in which a retry cannot see what the attempt before it already sent.
      async getDigestSent() {
        return (await backend.get(scopedKey(KEYS.DIGEST_SENT))) ?? null;
      },
      async setDigestSent(record) {
        await backend.set(scopedKey(KEYS.DIGEST_SENT), record);
      },
    };
  }

  return {
    forAccount,

    async issueOauthState(nonce, accountId) {
      await backend.set(`${KEYS.OAUTH_STATE_PREFIX}${nonce}`, { createdAt: now(), accountId });
    },

    async consumeOauthState(nonce) {
      return consumeState(`${KEYS.OAUTH_STATE_PREFIX}${nonce}`);
    },

    // T9b: the Google connect flow gets its OWN key namespace rather than a
    // discriminator field on the shared record. Flow separation then holds by
    // construction — a monday-issued nonce simply does not exist under the
    // Google prefix, so it can never be redeemed at the Google callback (and
    // vice versa) no matter what an attacker replays.
    async issueGoogleOauthState(nonce, accountId) {
      await backend.set(`${KEYS.GOOGLE_OAUTH_STATE_PREFIX}${nonce}`, { createdAt: now(), accountId });
    },

    async consumeGoogleOauthState(nonce) {
      return consumeState(`${KEYS.GOOGLE_OAUTH_STATE_PREFIX}${nonce}`);
    },

    invalidateCache,
  };
}
