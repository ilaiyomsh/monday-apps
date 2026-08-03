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

/**
 * @param {{ secureStorage: { get(k): Promise<any>, set(k,v): Promise<any> } }} deps
 */
export function createTokenStore({ secureStorage }) {
  const userKey = (accountId, userId) => `${accountId}:token:${userId}`;
  const readerKey = (accountId) => `${accountId}:token:default`;
  return {
    /** Any authorized owner's token, for reads + webhook creation. */
    async getReaderToken(accountId) {
      return validToken(unwrapStoredValue(await secureStorage.get(readerKey(accountId))));
    },
    /** The token to write a revert AS this specific owner; null if unauthorized. */
    async getOwnerToken(accountId, userId) {
      const record = validToken(unwrapStoredValue(await secureStorage.get(userKey(accountId, userId))));
      return record ? record.token : null;
    },
    /** One owner authorizes: stores their per-owner token AND the account reader. */
    async setOwnerToken(accountId, userId, record) {
      await secureStorage.set(userKey(accountId, userId), record);
      await secureStorage.set(readerKey(accountId), { ...record, userId: String(userId) });
    },
  };
}

/**
 * @param {{ storageFactory: (token: string) => { get(k): Promise<any> }, logger?: object }} deps
 */
export function createRulesStore({ storageFactory, logger }) {
  return {
    async getRules(token, boardId, columnId) {
      const key = `twystStatus:${boardId}:${columnId}`;
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
