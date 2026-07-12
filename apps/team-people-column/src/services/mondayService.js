import mondaySdk from 'monday-sdk-js';
import logger from '../utils/logger';

const monday = mondaySdk();

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
    const response = await monday.api(query, { variables });

    if (response.errors) {
      throw new Error(response.errors[0]?.message || 'GraphQL query failed');
    }

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

  // App storage (app-wide)
  async getAppStorage(key) {
    const response = await monday.storage.getItem(key);
    return parseStoredValue(response.data?.value, key, 'app');
  },

  async setAppStorage(key, value) {
    const response = await monday.storage.setItem(key, JSON.stringify(value));
    assertStorageWriteOk(response, key, 'app');
  },
};

export default mondayService;
