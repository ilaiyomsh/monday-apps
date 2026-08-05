import { unwrapStoredValue, validToken } from './unwrapStoredValue.js';

/** Refresh proactively when less than this remains on the access token (OAuth 2.1). */
export const REFRESH_CUSHION_MS = 5 * 60_000;

/**
 * createTokenStore — refresh-aware, OAuth 2.1 (monday's New OAuth Flow).
 *
 * Each owner's record is `{ token, refreshToken, expiresAt, obtainedAt, refreshedAt,
 * status, userId, userName }` (the ACCESS token stays under `.token`). Access tokens
 * EXPIRE and refresh tokens are SINGLE-USE + rotate, so every read resolves through
 * the refresh path: fresh → return as-is; stale → single-flight refresh (per owner
 * key), persist the ROTATED pair, return the new token; invalid_grant → flag the
 * record `reauth_required` and return null (the owner must re-authorize).
 *
 * The account READER (`:token:default`) is a POINTER `{ userId }`, NOT a copy of the
 * record — with rotating refresh tokens two live copies of one grant would burn the
 * rotation (whichever refreshes first invalidates the other). getReaderToken resolves
 * the pointer through the SAME refresh path, so there is one source of truth per owner.
 * A legacy copy record with a `.token` and no `userId` is still honored (non-rotating).
 *
 * @param {{ secureStorage: object, oauthClient?: object, logger?: object, now?: () => number }} deps
 */
export function createTokenStore({ secureStorage, oauthClient, logger, now = () => Date.now() }) {
  const userKey = (accountId, userId) => `${accountId}:token:${userId}`;
  const readerKey = (accountId) => `${accountId}:token:default`;
  const TAG = 'token-store';

  // Single-flight refresh gate, keyed by the owner storage key. Overlapping reads of
  // a stale record must share ONE refresh, or the second would present the
  // already-rotated (single-use) refresh token and get a false invalid_grant.
  const refreshLanes = new Map();

  const isFresh = (record) =>
    typeof record?.expiresAt === 'number' && record.expiresAt - now() > REFRESH_CUSHION_MS;

  async function readOwner(accountId, userId) {
    return validToken(unwrapStoredValue(await secureStorage.get(userKey(accountId, userId))));
  }

  /** Refresh a stale owner record once; persist the rotated pair. Returns the fresh access token or null. */
  async function doRefresh(accountId, userId) {
    // Re-read: another lane may have rotated between the caller's read and this one.
    const record = await readOwner(accountId, userId);
    if (!record || record.status === 'reauth_required') return null;
    if (!record.refreshToken) return record.token; // non-rotating (legacy/never-refreshed)
    if (isFresh(record)) return record.token;
    if (!oauthClient) return record.token; // no refresher wired → best-effort passthrough
    try {
      const rotated = await oauthClient.refresh(record.refreshToken);
      const next = {
        ...record,
        token: rotated.accessToken,
        // No rotation in the response → the previous refresh token stays valid.
        refreshToken: rotated.refreshToken ?? record.refreshToken,
        expiresAt: rotated.expiresAtMs,
        refreshedAt: now(),
        status: 'active',
      };
      await secureStorage.set(userKey(accountId, userId), next);
      return rotated.accessToken;
    } catch (err) {
      if (err?.code === 'refresh_token_invalid') {
        // Permanently dead (rotated-away / revoked / 6-month lifetime): flag it so no
        // further refresh is attempted and the settings UI can prompt a re-authorize.
        await secureStorage.set(userKey(accountId, userId), {
          ...record, token: null, refreshToken: null, status: 'reauth_required',
        });
        logger?.warn?.('owner token refresh rejected — re-authorization required', TAG, {
          accountId, userId: String(userId),
        });
        return null;
      }
      // Transient: inside the cushion but not hard-expired the current token still
      // works — return it and let a later call retry the refresh.
      logger?.error?.('owner token refresh transient failure', TAG, {
        accountId, userId: String(userId), code: String(err?.code ?? ''), error: String(err?.message ?? err),
      });
      if (typeof record.expiresAt === 'number' && record.expiresAt > now()) return record.token;
      return null;
    }
  }

  /** Resolve a FRESH access token for one owner (refreshing if needed). null if unusable. */
  async function resolveFresh(accountId, userId) {
    const record = await readOwner(accountId, userId);
    if (!record || record.status === 'reauth_required') return null;
    if (!record.refreshToken) return record.token; // non-rotating
    if (isFresh(record)) return record.token;

    const key = userKey(accountId, userId);
    if (!refreshLanes.has(key)) {
      refreshLanes.set(key, doRefresh(accountId, userId).finally(() => refreshLanes.delete(key)));
    }
    return refreshLanes.get(key);
  }

  return {
    /** Any authorized owner's token, for reads + webhook creation. `{ token, userId } | null`. */
    async getReaderToken(accountId) {
      const pointer = unwrapStoredValue(await secureStorage.get(readerKey(accountId)));
      if (!pointer || typeof pointer !== 'object') return null;
      const userId = pointer.userId != null ? String(pointer.userId) : null;
      if (userId === null) {
        // Legacy copy record (has a token, no pointer) — honor it directly.
        const rec = validToken(pointer);
        return rec ? { token: rec.token, userId: null } : null;
      }
      const token = await resolveFresh(accountId, userId);
      return token ? { token, userId } : null;
    },
    /** The token to write a revert AS this specific owner; null if unauthorized/reauth. */
    async getOwnerToken(accountId, userId) {
      return resolveFresh(accountId, userId);
    },
    /** One owner authorizes: store their per-owner record + point the reader at them. */
    async setOwnerToken(accountId, userId, record) {
      await secureStorage.set(userKey(accountId, userId), record);
      await secureStorage.set(readerKey(accountId), { userId: String(userId) });
    },
  };
}
