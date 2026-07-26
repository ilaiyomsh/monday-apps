import mondaySdk from 'monday-sdk-js';
import logger from '../utils/logger';

const monday = mondaySdk();
const STORAGE_RETRY_DELAY_MS = 350;

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function assertStorageSucceeded(response, action, key) {
  if (response?.data?.success === false) {
    throw new Error(`monday storage ${action} failed for key "${key}"`);
  }
}

// Storage values pass through JSON.parse ג€” a corrupted/hand-edited value must
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
    const response = await monday.api(query, { variables });

    if (response.errors?.length) {
      throw new Error(response.errors[0]?.message || 'GraphQL query failed');
    }

    return response.data;
  },

  // Close dialog (for column views)
  closeDialog() {
    return monday.execute('closeDialog');
  },

  // Open item card
  openItemCard(itemId) {
    monday.execute('openItemCard', { itemId });
  },

  // Show notice/toast
  showNotice(message, type = 'success') {
    return monday.execute('notice', {
      message,
      type, // 'success' | 'error' | 'info'
      timeout: 3000,
    });
  },

  // Instance storage (per-column/widget)
  async getInstanceStorage(key) {
    const response = await monday.storage.instance.getItem(key);
    return parseStoredValue(response.data?.value, key, 'instance');
  },

  async setInstanceStorage(key, value) {
    await monday.storage.instance.setItem(key, JSON.stringify(value));
  },

  // App storage (app-wide)
  async getAppStorage(key) {
    let response = await monday.storage.getItem(key);
    assertStorageSucceeded(response, 'read', key);

    if (response.data?.value == null) {
      await wait(STORAGE_RETRY_DELAY_MS);
      response = await monday.storage.getItem(key);
      assertStorageSucceeded(response, 'read retry', key);
    }

    return parseStoredValue(response.data?.value, key, 'app');
  },

  async setAppStorage(key, value) {
    const response = await monday.storage.setItem(key, JSON.stringify(value));
    assertStorageSucceeded(response, 'write', key);
  },
};

export default mondayService;

