import mondaySdk from 'monday-sdk-js';
import logger from '../utils/logger';

const monday = mondaySdk();
const API_VERSION = '2026-04';

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

  /**
   * Open a nested full-size app modal (e.g. from the cramped column-settings shell).
   * @see https://developer.monday.com/apps/docs/mondayexecute#openappfeaturemodal
   */
  openAppFeatureModal(options = {}) {
    return monday.execute('openAppFeatureModal', options);
  },

  closeAppFeatureModal() {
    return monday.execute('closeAppFeatureModal');
  },

  showNotice(message, type = 'success') {
    return monday.execute('notice', {
      message,
      type,
      timeout: 3000,
    });
  },

  // ONE read, deliberately. The false-empty retry lives in useColumnSettings, its
  // only caller — having it here TOO meant an unconfigured column paid two stacked
  // 350ms waits and four reads to learn the same thing. See the comment on
  // RETRY_DELAY_MS in that hook, and getColumnConfig in apps/team-people-column,
  // which twyst was copied from and which never grew this second retry.
  async getColumnConfig(boardId, columnId) {
    const key = columnConfigKey(boardId, columnId);
    const response = await monday.storage.getItem(key);
    assertStorageReadOk(response, key);

    return parseStoredValue(response.data?.value, key, 'column-config');
  },

  async setColumnConfig(boardId, columnId, value) {
    const key = columnConfigKey(boardId, columnId);
    const response = await monday.storage.setItem(key, JSON.stringify(value));
    assertStorageWriteOk(response, key, 'column-config');
  },
};

export default mondayService;
