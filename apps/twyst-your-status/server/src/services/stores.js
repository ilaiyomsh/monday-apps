/**
 * stores — the guard's storage seams, multi-tenant by explicit accountId.
 *
 * tokenStore / enrollmentStore — SecureStorage-backed (per APP, so every key is
 *   `${accountId}:` prefixed — root CLAUDE.md storage rules). PLATFORM TRAP
 *   (incident-verified 2026-07-15, mapps cli.md): production apps-sdk
 *   SecureStorage 0.1.4 wraps primitives — `{ value: 'str' }` comes back
 *   verbatim — while the local shim does not. unwrapStoredValue() is the one
 *   place that difference is allowed to exist.
 *
 * rulesStore — reads the SAME rules blob the picker writes via client
 *   monday.storage: key `twystStatus:<boardId>:<columnId>`, JSON string value,
 *   read server-side through @mondaycom/apps-sdk Storage(token). A missing or
 *   corrupted blob reads as null (unguarded column) — corruption is LOGGED,
 *   never thrown; an infrastructure REJECTION is rethrown (the caller owns
 *   fail-soft policy, the store must not swallow outages as "no rules").
 */

/** Unwrap apps-sdk 0.1.4's `{ value: ... }` primitive wrapping (both shapes). */
export function unwrapStoredValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'value')) {
    return raw.value ?? null;
  }
  return raw;
}

/**
 * @param {{ secureStorage: { get(k): Promise<any>, set(k,v): Promise<any> } }} deps
 */
export function createTokenStore({ secureStorage }) {
  return {
    async getActivation(accountId) {
      const record = unwrapStoredValue(await secureStorage.get(`${accountId}:activation`));
      // A broken record must read as "not activated", never as a usable token.
      if (!record || typeof record !== 'object') return null;
      if (typeof record.token !== 'string' || record.token === '') return null;
      return record;
    },
    async setActivation(accountId, record) {
      await secureStorage.set(`${accountId}:activation`, record);
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
