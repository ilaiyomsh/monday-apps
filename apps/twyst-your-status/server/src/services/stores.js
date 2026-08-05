/**
 * stores — the guard's storage seams, multi-tenant by explicit accountId.
 *
 * IDENTITY MODEL (owner decision, round322 — no separate "bot" identity):
 * a REVERT is written with the COLUMN'S PRIMARY OWNER's token, so monday
 * records the revert as that owner (the person the settings screen designated).
 * There is no service account. Two token roles, both real owners:
 *   - a per-owner token  `${accountId}:token:${userId}` — used to write a revert
 *     AS that owner when they are the column's primary;
 *   - an account READER  `${accountId}:token:default`   — any authorized owner's
 *     token, used only for READS (labels, item values, rules) and for creating
 *     webhooks. Reads need no particular identity.
 * An owner "authorizes the guard" once (their own monday OAuth — not a bot);
 * that stores their per-owner token AND refreshes the account reader.
 *
 * rulesStore — reads the SAME rules blob the picker writes via client
 *   monday.storage: key `twystStatus:<boardId>:<columnId>`. Corruption is
 *   LOGGED, never thrown; an infrastructure REJECTION is rethrown.
 *
 * PLATFORM TRAP (incident-verified 2026-07-15, mapps cli.md): production
 * apps-sdk SecureStorage 0.1.4 wraps primitives — `{ value: 'str' }` comes
 * back verbatim. unwrapStoredValue() is the one place that difference lives.
 */

import { columnConfigStorageKey } from '../../../src/domain/columnConfigKey.js';

/** Unwrap apps-sdk 0.1.4's `{ value: ... }` primitive wrapping (both shapes). */
export function unwrapStoredValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'value')) {
    return raw.value ?? null;
  }
  return raw;
}

function validToken(record) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.token !== 'string' || record.token === '') return null;
  return record;
}

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

/**
 * @param {{ storageFactory: (token: string) => { get(k): Promise<any> }, logger?: object }} deps
 */
export function createRulesStore({ storageFactory, logger }) {
  return {
    async getRules(token, boardId, columnId) {
      const key = columnConfigStorageKey(boardId, columnId);
      const stored = unwrapStoredValue(await storageFactory(token).get(key));
      if (stored == null || stored === '') return null;
      if (typeof stored === 'object') return stored;
      try {
        return JSON.parse(stored);
      } catch (err) {
        logger?.error?.('corrupted rules blob — column treated as unguarded', 'rules-store', {
          key,
          error: String(err?.message ?? err),
        });
        return null;
      }
    },
  };
}

/**
 * bypassLog — the append-only audit of detected bypasses per column (round323).
 * A bounded rolling array under `${accountId}:bypass:${boardId}:${columnId}`
 * (SecureStorage is a KV store, not a DB). Newest last; capped at MAX_EVENTS —
 * the monitor reports recent windows, not all history, so old events age out.
 * Appends for the SAME column are serialized in-process (a promise lane per
 * key) so two concurrent webhook deliveries never lose each other's write via
 * read-modify-write; different columns append concurrently.
 * @param {{ secureStorage: { get(k): Promise<any>, set(k,v): Promise<any> }, maxEvents?: number, logger?: object }} deps
 */
export function createBypassLog({ secureStorage, maxEvents = 1000, logger }) {
  const keyOf = (accountId, boardId, columnId) => `${accountId}:bypass:${boardId}:${columnId}`;
  const lanes = new Map();

  async function readList(key) {
    const raw = unwrapStoredValue(await secureStorage.get(key));
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        // A corrupted log reads as empty rather than crashing the query; logged
        // so it is not silent (error-guard).
        logger?.error?.('corrupted bypass log — treated as empty', 'bypass-log', {
          key, error: String(err?.message ?? err),
        });
        return [];
      }
    }
    return [];
  }

  return {
    async append(accountId, boardId, columnId, record) {
      const key = keyOf(accountId, boardId, columnId);
      const prior = lanes.get(key) ?? Promise.resolve();
      const run = prior.then(async () => {
        const list = await readList(key);
        list.push(record);
        // Keep the NEWEST maxEvents and drop the oldest overflow — the direction matters
        // and is not obvious from `slice`: a bypass log read by an owner is only useful if
        // it shows the most recent events. (Restored after a cleanup batch removed it.)
        const trimmed = list.length > maxEvents ? list.slice(list.length - maxEvents) : list;
        await secureStorage.set(key, trimmed);
      });
      // Fail-soft: recording a bypass must never throw back into the guard's
      // event handling. A failed write is logged (error-guard), and the lane's
      // tail cannot reject, so the next append still chains cleanly after it.
      const settled = run.catch((err) => {
        logger?.error?.('bypass log append failed', 'bypass-log', {
          key, error: String(err?.message ?? err),
        });
      }).finally(() => {
        if (lanes.get(key) === settled) lanes.delete(key);
      });
      lanes.set(key, settled);
      return settled;
    },

    async queryRange(accountId, boardId, columnId, fromMs, toMs) {
      const list = await readList(keyOf(accountId, boardId, columnId));
      return list
        .filter((e) => typeof e?.ts === 'number' && e.ts >= fromMs && e.ts <= toMs)
        .sort((a, b) => b.ts - a.ts);
    },
  };
}

/**
 * enrollmentStore — which board+column pairs already carry our webhook.
 * @param {{ secureStorage: { get(k): Promise<any>, set(k,v): Promise<any> } }} deps
 */
export function createEnrollmentStore({ secureStorage }) {
  const keyOf = (accountId, boardId, columnId) => `${accountId}:enrolled:${boardId}:${columnId}`;
  return {
    async get(accountId, boardId, columnId) {
      return unwrapStoredValue(await secureStorage.get(keyOf(accountId, boardId, columnId)));
    },
    async set(accountId, boardId, columnId, webhookId) {
      await secureStorage.set(keyOf(accountId, boardId, columnId), webhookId);
    },
  };
}
