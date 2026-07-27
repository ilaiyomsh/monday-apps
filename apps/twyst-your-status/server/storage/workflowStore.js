import { appendAuditEntry, normalizeAuditLog } from '../../src/domain/auditLog.js';
import { normalizeWorkflowConfig } from '../../src/domain/workflowPolicy.js';
import logger from '../logger.js';

const DEFAULT_MARKER_TTL_MS = 120_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

function id(value, name) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`${name} must be a string or number.`);
  }
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError(`${name} must not be blank.`);
  return normalized;
}

function segment(value) {
  return encodeURIComponent(value);
}

function configKey(accountId, boardId) {
  return `workflow:v1:${segment(accountId)}:board:${segment(boardId)}:config`;
}

function auditKey(accountId, boardId, itemId) {
  return `workflow:v1:${segment(accountId)}:board:${segment(boardId)}:item:${segment(itemId)}:audit`;
}

function markerKey(accountId, boardId, itemId, columnId) {
  return `workflow:v1:${segment(accountId)}:board:${segment(boardId)}:item:${segment(itemId)}:column:${segment(columnId)}:expected`;
}

function webhookKey(accountId, boardId) {
  return `workflow:v1:${segment(accountId)}:board:${segment(boardId)}:webhook`;
}

function oauthTokenKey(accountId) {
  return `workflow:v1:${segment(accountId)}:oauth-token`;
}

function oauthStateKey(nonce) {
  return `workflow:v1:oauth-state:${segment(nonce)}`;
}

function optionalSecret(value, name) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-blank string or null.`);
  }
  return value.trim();
}

function optionalTimestamp(value, name) {
  if (value == null) return null;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite timestamp or null.`);
  return value;
}

function normalizeOAuthTokenRecord(raw) {
  if (typeof raw === 'string' && raw.trim()) {
    return {
      v: 1,
      accessToken: raw.trim(),
      refreshToken: null,
      expiresAt: null,
      obtainedAt: null,
      status: 'active',
    };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 2) return null;
  const status = raw.status === 'reauth_required' ? 'reauth_required' : 'active';
  try {
    const normalized = {
      v: 2,
      accessToken: optionalSecret(raw.accessToken, 'accessToken'),
      refreshToken: optionalSecret(raw.refreshToken, 'refreshToken'),
      expiresAt: optionalTimestamp(raw.expiresAt, 'expiresAt'),
      obtainedAt: optionalTimestamp(raw.obtainedAt, 'obtainedAt'),
      status,
    };
    if (raw.refreshedAt != null) {
      normalized.refreshedAt = optionalTimestamp(raw.refreshedAt, 'refreshedAt');
    }
    if (status === 'active' && !normalized.accessToken) return null;
    return normalized;
  } catch (error) {
    logger.warn('invalid_oauth_token_record', 'storage', { error });
    return null;
  }
}

function normalizeMarker(raw, now) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Number.isFinite(raw.expiresAt) || raw.expiresAt <= now) return null;
  if (!['approved_action', 'rollback'].includes(raw.kind)) return null;
  try {
    return {
      kind: raw.kind,
      accountId: id(raw.accountId, 'accountId'),
      boardId: id(raw.boardId, 'boardId'),
      itemId: id(raw.itemId, 'itemId'),
      columnId: id(raw.columnId, 'columnId'),
      fromLabelId: raw.fromLabelId == null ? null : id(raw.fromLabelId, 'fromLabelId'),
      toLabelId: raw.toLabelId == null ? null : id(raw.toLabelId, 'toLabelId'),
      actorUserId: raw.actorUserId == null ? null : id(raw.actorUserId, 'actorUserId'),
      expiresAt: raw.expiresAt,
    };
  } catch (error) {
    logger.warn('invalid_expected_change_marker', 'storage', { error });
    return null;
  }
}

function markerMatches(marker, expected) {
  return ['kind', 'accountId', 'boardId', 'itemId', 'columnId', 'fromLabelId', 'toLabelId']
    .every((field) => marker[field] === expected[field]);
}

export function createWorkflowStore({ backend, now = Date.now } = {}) {
  if (!backend || typeof backend.get !== 'function' || typeof backend.set !== 'function') {
    throw new TypeError('A storage backend with get and set methods is required.');
  }

  const locks = new Map();
  const serialize = async (key, operation) => {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  };

  return {
    async getConfig(accountIdValue, boardIdValue) {
      const accountId = id(accountIdValue, 'accountId');
      const boardId = id(boardIdValue, 'boardId');
      const raw = await backend.get(configKey(accountId, boardId));
      return raw == null ? null : normalizeWorkflowConfig(raw);
    },

    async saveConfig(rawConfig) {
      const config = normalizeWorkflowConfig(rawConfig);
      await backend.set(configKey(config.accountId, config.boardId), config);
      return config;
    },

    async getAudit(accountIdValue, boardIdValue, itemIdValue) {
      const accountId = id(accountIdValue, 'accountId');
      const boardId = id(boardIdValue, 'boardId');
      const itemId = id(itemIdValue, 'itemId');
      return normalizeAuditLog(await backend.get(auditKey(accountId, boardId, itemId)));
    },

    async appendAudit(rawEntry, limit) {
      const accountId = id(rawEntry?.accountId, 'accountId');
      const boardId = id(rawEntry?.boardId, 'boardId');
      const itemId = id(rawEntry?.itemId, 'itemId');
      const key = auditKey(accountId, boardId, itemId);
      return serialize(key, async () => {
        const updated = appendAuditEntry(await backend.get(key), rawEntry, limit);
        await backend.set(key, updated);
        return updated;
      });
    },

    async setExpectedMarker(rawMarker, ttlMs = DEFAULT_MARKER_TTL_MS) {
      if (!Number.isInteger(ttlMs) || ttlMs < 1) {
        throw new TypeError('Marker TTL must be a positive integer.');
      }
      const marker = {
        kind: rawMarker?.kind,
        accountId: id(rawMarker?.accountId, 'accountId'),
        boardId: id(rawMarker?.boardId, 'boardId'),
        itemId: id(rawMarker?.itemId, 'itemId'),
        columnId: id(rawMarker?.columnId, 'columnId'),
        fromLabelId: rawMarker?.fromLabelId == null ? null : id(rawMarker.fromLabelId, 'fromLabelId'),
        toLabelId: rawMarker?.toLabelId == null ? null : id(rawMarker.toLabelId, 'toLabelId'),
        actorUserId: rawMarker?.actorUserId == null ? null : id(rawMarker.actorUserId, 'actorUserId'),
        expiresAt: now() + ttlMs,
      };
      if (!['approved_action', 'rollback'].includes(marker.kind)) {
        throw new TypeError('Marker kind must be approved_action or rollback.');
      }
      await backend.set(
        markerKey(marker.accountId, marker.boardId, marker.itemId, marker.columnId),
        marker,
      );
      return marker;
    },

    async consumeExpectedMarker(rawExpected) {
      const expected = {
        kind: rawExpected?.kind,
        accountId: id(rawExpected?.accountId, 'accountId'),
        boardId: id(rawExpected?.boardId, 'boardId'),
        itemId: id(rawExpected?.itemId, 'itemId'),
        columnId: id(rawExpected?.columnId, 'columnId'),
        fromLabelId: rawExpected?.fromLabelId == null ? null : id(rawExpected.fromLabelId, 'fromLabelId'),
        toLabelId: rawExpected?.toLabelId == null ? null : id(rawExpected.toLabelId, 'toLabelId'),
      };
      const key = markerKey(
        expected.accountId,
        expected.boardId,
        expected.itemId,
        expected.columnId,
      );
      return serialize(key, async () => {
        const raw = await backend.get(key);
        const marker = normalizeMarker(raw, now());
        if (!marker) {
          if (raw != null && typeof backend.delete === 'function') await backend.delete(key);
          return null;
        }
        if (!markerMatches(marker, expected)) return null;
        if (typeof backend.delete === 'function') await backend.delete(key);
        return marker;
      });
    },

    async getWebhook(accountIdValue, boardIdValue) {
      return backend.get(webhookKey(id(accountIdValue, 'accountId'), id(boardIdValue, 'boardId')));
    },

    async saveWebhook(accountIdValue, boardIdValue, webhook) {
      const accountId = id(accountIdValue, 'accountId');
      const boardId = id(boardIdValue, 'boardId');
      await backend.set(webhookKey(accountId, boardId), webhook);
      return webhook;
    },

    async getOAuthTokenRecord(accountIdValue) {
      const raw = await backend.get(oauthTokenKey(id(accountIdValue, 'accountId')));
      return normalizeOAuthTokenRecord(raw);
    },

    async saveOAuthTokenRecord(accountIdValue, rawRecord) {
      const accountId = id(accountIdValue, 'accountId');
      const record = normalizeOAuthTokenRecord({ ...rawRecord, v: 2 });
      if (!record) {
        throw new TypeError('OAuth token record is invalid.');
      }
      await backend.set(oauthTokenKey(accountId), record);
      return record;
    },

    async clearOAuthToken(accountIdValue) {
      await backend.delete(oauthTokenKey(id(accountIdValue, 'accountId')));
    },

    async issueOAuthState(nonceValue, rawState) {
      const nonce = id(nonceValue, 'nonce');
      const state = {
        verifier: optionalSecret(rawState?.verifier, 'verifier'),
        accountId: id(rawState?.accountId, 'accountId'),
        userId: id(rawState?.userId, 'userId'),
        expiresAt: now() + OAUTH_STATE_TTL_MS,
      };
      await backend.set(oauthStateKey(nonce), state);
      return state;
    },

    async consumeOAuthState(nonceValue) {
      const nonce = id(nonceValue, 'nonce');
      const key = oauthStateKey(nonce);
      return serialize(key, async () => {
        const raw = await backend.get(key);
        await backend.delete(key);
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
        if (!Number.isFinite(raw.expiresAt) || raw.expiresAt <= now()) return null;
        try {
          return {
            verifier: optionalSecret(raw.verifier, 'verifier'),
            accountId: id(raw.accountId, 'accountId'),
            userId: id(raw.userId, 'userId'),
            expiresAt: raw.expiresAt,
          };
        } catch (error) {
          logger.warn('invalid_oauth_state', 'storage', { error });
          return null;
        }
      });
    },
  };
}
