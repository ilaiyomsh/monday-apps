import mondaySdk from 'monday-sdk-js';
import logger from '../utils/logger';

const monday = mondaySdk();
const STORAGE_RETRY_DELAY_MS = 350;
const API_VERSION = '2026-04';

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    logger.warn('mondayService', 'Storage response was not serializable', err);
    return String(value);
  }
}

function describeStorageError(response) {
  const raw =
    response?.errorMessage
    ?? response?.data?.error
    ?? response?.data?.errorMessage
    ?? response?.error
    ?? null;
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw.message === 'string') return raw.message;
  return `no reason field; full response: ${safeStringify(response)}`;
}

function assertStorageWriteOk(response, key, scope) {
  if (response?.data?.success === true) return;
  throw new Error(`Failed to persist ${scope} storage key "${key}": ${describeStorageError(response)}`);
}

function assertStorageReadOk(response, key) {
  if (response?.data?.success === false) {
    throw new Error(`monday storage read failed for key "${key}": ${describeStorageError(response)}`);
  }
}

// Column-view dialogs have no instanceId — use GLOBAL storage keyed by board+column.
function columnConfigKey(boardId, columnId) {
  return `twystStatus:${boardId}:${columnId}`;
}

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
  async getContext() {
    const response = await monday.get('context');
    return response.data;
  },

  listenToContext(callback) {
    return monday.listen('context', (res) => {
      callback(res.data);
    });
  },

  async getSessionToken() {
    const response = await monday.get('sessionToken');
    return response.data;
  },

  async query(query, variables = {}) {
    const response = await monday.api(query, { variables, apiVersion: API_VERSION });

    if (response.errors?.length) {
      throw new Error(response.errors[0]?.message || 'GraphQL query failed');
    }

    return response.data;
  },

  closeDialog() {
    return monday.execute('closeDialog');
  },

  openItemCard(itemId) {
    monday.execute('openItemCard', { itemId });
  },

  showNotice(message, type = 'success') {
    return monday.execute('notice', {
      message,
      type,
      timeout: 3000,
    });
  },

  async getColumnConfig(boardId, columnId) {
    const key = columnConfigKey(boardId, columnId);
    let response = await monday.storage.getItem(key);
    assertStorageReadOk(response, key);

    if (response.data?.value == null) {
      await wait(STORAGE_RETRY_DELAY_MS);
      response = await monday.storage.getItem(key);
      assertStorageReadOk(response, key);
    }

    return parseStoredValue(response.data?.value, key, 'column-config');
  },

  async setColumnConfig(boardId, columnId, value) {
    const key = columnConfigKey(boardId, columnId);
    const response = await monday.storage.setItem(key, JSON.stringify(value));
    assertStorageWriteOk(response, key, 'column-config');
  },

  async getAppStorage(key) {
    let response = await monday.storage.getItem(key);
    assertStorageReadOk(response, key);

    if (response.data?.value == null) {
      await wait(STORAGE_RETRY_DELAY_MS);
      response = await monday.storage.getItem(key);
      assertStorageReadOk(response, key);
    }

    return parseStoredValue(response.data?.value, key, 'app');
  },

  async setAppStorage(key, value) {
    const response = await monday.storage.setItem(key, JSON.stringify(value));
    assertStorageWriteOk(response, key, 'app');
  },
};

export default mondayService;
