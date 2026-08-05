import mondaySdk from 'monday-sdk-js';
import logger from '../utils/logger';

const monday = mondaySdk();

// Coarse latency buckets (D5) so repeated api_latency health signals dedup at the
// transport instead of shipping a distinct message per call (query() is a hot path).
function latencyBucket(ms) {
  if (ms < 200) return 'fast';
  if (ms < 1000) return 'ok';
  if (ms < 3000) return 'slow';
  return 'very_slow';
}

// monday.storage.setItem resolves even when the write did not persist — the
// failure is in-band ({ data: { success:false }, errorMessage }). Treating a
// resolved promise as success would confirm a failed save to the user, so we
// throw and let the caller's catch/log/display path handle it (never swallow).
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    logger.warn('mondayService', 'Storage response was not serializable', err);
    return String(value);
  }
}

function describeStorageError(response) {
  // monday returns the failure reason under different keys and it is not always a
  // string — an object rendered via template literal becomes "[object Object]",
  // hiding the actual cause. Dig the common shapes; when none carry a readable
  // reason (e.g. an empty {}), fall back to the WHOLE response so the real shape
  // is visible for diagnosis.
  const raw =
    response?.errorMessage ??
    response?.data?.error ??
    response?.data?.errorMessage ??
    response?.error ??
    null;
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw.message === 'string') return raw.message;
  return `no reason field; full response: ${safeStringify(response)}`;
}

function assertStorageWriteOk(response, key, scope) {
  if (response?.data?.success === true) return;
  throw new Error(`Failed to persist ${scope} storage key "${key}": ${describeStorageError(response)}`);
}

// Column-view dialogs (settings + on-click) have NO instance — their context
// carries boardId + columnId but no instanceId — so monday.storage.instance
// cannot be used (it resolves success:false with an empty error). Per-column
// config is persisted in GLOBAL storage keyed by boardId + columnId, which both
// placements can reconstruct identically.
function columnConfigKey(boardId, columnId) {
  return `teamPeople:${boardId}:${columnId}`;
}

// Storage values pass through JSON.parse — a corrupted/hand-edited value must
// not crash the caller. Log it (never swallow) and treat it as missing.
function parseStoredValue(raw, key, scope) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.error('mondayService', `Corrupted JSON in ${scope} storage key "${key}"`, err);
    return null;
  }
}

const mondayService = {
  // Get initial context
  async getContext() {
    const response = await monday.get('context');
    return response.data;
  },

  // Listen for context changes
  listenToContext(callback) {
    const unsubscribe = monday.listen('context', (res) => {
      callback(res.data);
    });
    return unsubscribe;
  },

  // Execute GraphQL query
  async query(query, variables = {}) {
    // No API-Version pin (monday-api check's WARN is consciously accepted): inside
    // the platform iframe monday.api() runs against the version the PARENT app
    // negotiates and ignores a client-set pin, so hardcoding one would be a fake
    // pin, not a real guarantee. (A server-side / monday-code call WOULD pin.)
    const t0 = Date.now();
    let response;
    try {
      response = await monday.api(query, { variables });
    } catch (e) {
      // network/SDK throw (not a GraphQL error response) — record latency + rethrow
      logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: false });
      throw e;
    }

    if (response.errors) {
      logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: false });
      throw new Error(response.errors[0]?.message || 'GraphQL query failed');
    }

    // API-latency health (D5): bucketed so it dedups; ships as kind='health' (inert until active).
    logger.health('api_latency', { bucket: latencyBucket(Date.now() - t0), ok: true });
    return response.data;
  },

  // Close dialog (for column views)
  closeDialog() {
    monday.execute('closeDialog');
  },

  // Open item card
  openItemCard(itemId) {
    monday.execute('openItemCard', { itemId });
  },

  // Show notice/toast
  showNotice(message, type = 'success') {
    monday.execute('notice', {
      message,
      type, // 'success' | 'error' | 'info'
      timeout: 3000,
    });
  },

  // Per-column config — GLOBAL storage keyed by boardId+columnId (see
  // columnConfigKey above: column-view dialogs have no instanceId, so
  // monday.storage.instance writes resolve success:false in production).
  async getColumnConfig(boardId, columnId) {
    const key = columnConfigKey(boardId, columnId);
    const response = await monday.storage.getItem(key);
    return parseStoredValue(response.data?.value, key, 'column-config');
  },

  async setColumnConfig(boardId, columnId, value) {
    const key = columnConfigKey(boardId, columnId);
    const response = await monday.storage.setItem(key, JSON.stringify(value));
    assertStorageWriteOk(response, key, 'column-config');
  },

  // App storage (app-wide). Currently unused in production (no src call sites),
  // but a future caller must not inherit an unguarded await: wrap the fallible
  // ops so any failure is logged (not just an unhandledrejection with zero
  // context) before it rethrows to the caller's own catch/log/display path.
  async getAppStorage(key) {
    try {
      const response = await monday.storage.getItem(key);
      return parseStoredValue(response.data?.value, key, 'app');
    } catch (err) {
      logger.error('mondayService', `Failed to read app storage key "${key}"`, err);
      throw err;
    }
  },

  async setAppStorage(key, value) {
    try {
      const response = await monday.storage.setItem(key, JSON.stringify(value));
      assertStorageWriteOk(response, key, 'app');
    } catch (err) {
      logger.error('mondayService', `Failed to write app storage key "${key}"`, err);
      throw err;
    }
  },
};

export default mondayService;
