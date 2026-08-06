import { columnConfigStorageKey } from '../../../../src/domain/columnConfigKey.js';
import { unwrapStoredValue } from './unwrapStoredValue.js';

/**
 * TTL CACHE (round360): rules are read on EVERY status-change event, so each result —
 * including null ("unguarded") — is held in memory for ttlMs (default 45s). The cache
 * is WEBHOOK-ONLY: it activates only when the caller passes its verified accountId
 * (the webhook handler's, from the JWT-authenticated delivery), and the entry is keyed
 * `${accountId}:${boardId}:${columnId}`. Callers that pass NO accountId — the
 * sessionToken routes, whose boardId is CLIENT-CHOSEN — always fetch fresh and never
 * touch the cache: caching a (foreign-board, own-token) probe there would let tenant B
 * poison the null that tenant A's webhook then trusts for a whole TTL (round360 review
 * finding, P1). The 45s staleness window (a rule edit may take up to 45s to be
 * enforced) is the owner-approved trade-off (round360 review doc §5). Corrupted-blob
 * and infrastructure-rejection behaviors are unchanged: corruption still logs and
 * reads as null (and that null is cached like any other), a storage REJECTION still
 * rethrows and caches nothing.
 *
 * @param {{ storageFactory: (token: string) => { get(k): Promise<any> }, logger?: object, ttlMs?: number, now?: () => number }} deps
 */
export function createRulesStore({ storageFactory, logger, ttlMs = 45_000, now = () => Date.now() }) {
  const cache = new Map(); // `${accountId}:${boardId}:${columnId}` → { value, at }
  return {
    async getRules(token, boardId, columnId, accountId = null) {
      const cacheKey = accountId == null ? null : `${accountId}:${boardId}:${columnId}`;
      if (cacheKey !== null) {
        const hit = cache.get(cacheKey);
        if (hit && now() - hit.at < ttlMs) return hit.value;
      }

      const key = columnConfigStorageKey(boardId, columnId);
      const stored = unwrapStoredValue(await storageFactory(token).get(key));
      let value;
      if (stored == null || stored === '') {
        value = null;
      } else if (typeof stored === 'object') {
        value = stored;
      } else {
        try {
          value = JSON.parse(stored);
        } catch (err) {
          logger?.error?.('corrupted rules blob — column treated as unguarded', 'rules-store', {
            key,
            error: String(err?.message ?? err),
          });
          value = null;
        }
      }
      if (cacheKey !== null) cache.set(cacheKey, { value, at: now() });
      return value;
    },
  };
}
