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
 * IN-MEMORY CACHE (round360): every guard event resolves a token, and SecureStorage
 * round-trips dominate that path. Two per-instance Maps cut them:
 *   - accessCache  `${accountId}:${userId}` → { token, expiresAt } — ONLY the access
 *     token and its expiry, NEVER the refresh token (the rotating refresh token has
 *     exactly one sanctioned home: the persisted record).
 *   - readerPointerCache  accountId → userId — the reader pointer, which only moves
 *     when someone re-authorizes. Legacy copy records carry token material, so they
 *     are deliberately NOT cached.
 * A hit is honored only while it still clears REFRESH_CUSHION_MS, so a cached token
 * is never staler than the storage path would allow; anything that invalidates a
 * grant (reauth flag, failed refresh) evicts its entry.
 *
 * @param {{ secureStorage: object, oauthClient?: object, logger?: object, now?: () => number }} deps
 */
export function createTokenStore({ secureStorage, oauthClient, logger, now = () => Date.now() }) {
  const userKey = (accountId, userId) => `${accountId}:token:${userId}`;
  const readerKey = (accountId) => `${accountId}:token:default`;
  const TAG = 'token-store';

  // See "IN-MEMORY CACHE" above. accountId is part of every access key so two
  // accounts sharing a userId can never collide.
  const accessCache = new Map();
  const readerPointerCache = new Map();
  const accessKey = (accountId, userId) => `${accountId}:${userId}`;

  /**
   * Cache an access token (token + expiry ONLY — never the refresh token).
   * Refuses anything uncacheable (no token / non-numeric expiry) and reports
   * whether it cached, so callers can evict a stale entry instead.
   */
  function cacheAccess(accountId, userId, token, expiresAt) {
    if (typeof token !== 'string' || token === '' || typeof expiresAt !== 'number') return false;
    accessCache.set(accessKey(accountId, userId), { token, expiresAt });
    return true;
  }

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
    if (isFresh(record)) {
      cacheAccess(accountId, userId, record.token, record.expiresAt);
      return record.token;
    }
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
      cacheAccess(accountId, userId, rotated.accessToken, rotated.expiresAtMs);
      return rotated.accessToken;
    } catch (err) {
      if (err?.code === 'refresh_token_invalid') {
        // CROSS-INSTANCE RACE GUARD (round360): monday-code runs N instances, each with
        // its own in-process refresh lane, so two instances can present the SAME
        // single-use refresh token — the loser gets invalid_grant even though the grant
        // is alive and the winner already persisted the rotated pair. Re-read before
        // flagging: a DIFFERENT persisted refreshToken means we lost that race, not the
        // grant — adopt the winner's rotation instead of killing a healthy record.
        const current = await readOwner(accountId, userId);
        if (
          current && current.status !== 'reauth_required' &&
          typeof current.refreshToken === 'string' && current.refreshToken !== '' &&
          current.refreshToken !== record.refreshToken
        ) {
          logger?.info?.('refresh lost cross-instance race — adopted newer rotation', TAG, {
            accountId, userId: String(userId),
          });
          // Same usable-token rule as the transient branch: hand back the adopted access
          // token while it is not hard-expired; a later call refreshes with the adopted
          // (newer) refresh token through the normal path.
          if (typeof current.expiresAt === 'number' && current.expiresAt > now()) {
            cacheAccess(accountId, userId, current.token, current.expiresAt);
            return current.token;
          }
          accessCache.delete(accessKey(accountId, userId));
          return null;
        }
        // Same pair on re-read → permanently dead (rotated-away / revoked / 6-month
        // lifetime): flag it so no further refresh is attempted and the settings UI can
        // prompt a re-authorize. The flag also evicts any cached access token — a flagged
        // grant must never be served from memory.
        await secureStorage.set(userKey(accountId, userId), {
          ...record, token: null, refreshToken: null, status: 'reauth_required',
        });
        accessCache.delete(accessKey(accountId, userId));
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
      // Hard-expired AND unrefreshable right now → nothing usable; evict so the cache
      // cannot outlive the failure (round360 eviction rule: null return → no cache entry).
      accessCache.delete(accessKey(accountId, userId));
      return null;
    }
  }

  /** Resolve a FRESH access token for one owner (refreshing if needed). null if unusable. */
  async function resolveFresh(accountId, userId) {
    // Access cache first (round360): a hit counts only while it still clears the
    // refresh cushion — the exact freshness rule the storage path applies — so a
    // cached answer is never staler than a stored one would be.
    const hit = accessCache.get(accessKey(accountId, userId));
    if (hit && typeof hit.expiresAt === 'number' && hit.expiresAt - now() > REFRESH_CUSHION_MS) {
      return hit.token;
    }

    const record = await readOwner(accountId, userId);
    if (!record || record.status === 'reauth_required') return null;
    if (!record.refreshToken) return record.token; // non-rotating
    if (isFresh(record)) {
      cacheAccess(accountId, userId, record.token, record.expiresAt);
      return record.token;
    }

    const key = userKey(accountId, userId);
    if (!refreshLanes.has(key)) {
      refreshLanes.set(key, doRefresh(accountId, userId).finally(() => refreshLanes.delete(key)));
    }
    return refreshLanes.get(key);
  }

  return {
    /** Any authorized owner's token, for reads + webhook creation. `{ token, userId } | null`. */
    async getReaderToken(accountId) {
      // Pointer cache first (round360): the pointer only moves on re-authorization,
      // so once known it saves the storage read; the token itself still resolves
      // through resolveFresh (and ITS cache) — the pointer cache holds no tokens.
      const cachedUserId = readerPointerCache.get(String(accountId));
      if (cachedUserId != null) {
        const token = await resolveFresh(accountId, cachedUserId);
        if (token) return { token, userId: cachedUserId };
        // The cached pointer resolved to nothing usable (reauth flag, dead grant).
        // The STORED pointer may have MOVED — a re-authorization by another owner
        // lands on whichever instance serves the OAuth callback, and only that
        // instance's caches learn about it. Evict and fall through to the storage
        // pointer, exactly like the pre-cache code recovered (round360 review
        // finding, P1: a pointer cache with no failure path went blind forever).
        readerPointerCache.delete(String(accountId));
      }
      const pointer = unwrapStoredValue(await secureStorage.get(readerKey(accountId)));
      if (!pointer || typeof pointer !== 'object') return null;
      const userId = pointer.userId != null ? String(pointer.userId) : null;
      if (userId === null) {
        // Legacy copy record (has a token, no pointer) — honor it directly. NEVER
        // cached: it carries token material, and the access cache is the only
        // sanctioned in-memory home for tokens (round360).
        const rec = validToken(pointer);
        return rec ? { token: rec.token, userId: null } : null;
      }
      const token = await resolveFresh(accountId, userId);
      // Cache the pointer only once it RESOLVED to a usable token — caching a
      // dead pointer would just re-enter the eviction dance above on every call.
      if (token) {
        readerPointerCache.set(String(accountId), userId);
        return { token, userId };
      }
      return null;
    },
    /** The token to write a revert AS this specific owner; null if unauthorized/reauth. */
    async getOwnerToken(accountId, userId) {
      return resolveFresh(accountId, userId);
    },
    /** One owner authorizes: store their per-owner record + point the reader at them. */
    async setOwnerToken(accountId, userId, record) {
      await secureStorage.set(userKey(accountId, userId), record);
      await secureStorage.set(readerKey(accountId), { userId: String(userId) });
      // Keep the in-memory layer in step with the write it just made (round360): the
      // fresh grant's access token is cacheable (token + expiry — never the refresh
      // token), and the reader now points at this owner. An uncacheable record (no
      // token / no expiry) evicts instead, so no stale entry survives the write.
      if (!cacheAccess(accountId, userId, record?.token, record?.expiresAt)) {
        accessCache.delete(accessKey(accountId, userId));
      }
      readerPointerCache.set(String(accountId), String(userId));
    },
  };
}
