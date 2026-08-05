import { unwrapStoredValue } from './unwrapStoredValue.js';

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
