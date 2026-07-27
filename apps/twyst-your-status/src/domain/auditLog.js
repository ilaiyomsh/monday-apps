export const AUDIT_LOG_VERSION = 1;
export const DEFAULT_AUDIT_LOG_LIMIT = 200;

export class AuditLogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuditLogError';
    this.code = code;
  }
}

const AUDIT_SOURCES = new Set(['item_view', 'board', 'automation', 'api', 'unknown']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message) {
  throw new AuditLogError(code, message);
}

function normalizeIdentifier(value, fieldName, { label = false, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail('invalid_identifier', `${fieldName} must be a non-empty identifier.`);
  }

  const identifier = String(value).trim();
  if (!identifier || (label && !/^\d+$/.test(identifier))) {
    fail('invalid_identifier', `${fieldName} is invalid.`);
  }
  return identifier;
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneJsonValue(nestedValue)]),
    );
  }
  return value;
}

export function normalizeAuditEntry(rawEntry) {
  if (!isPlainObject(rawEntry)) {
    fail('invalid_entry', 'Audit entry must be an object.');
  }

  if (typeof rawEntry.occurredAt !== 'string') {
    fail('invalid_timestamp', 'Audit entry occurredAt must be an ISO date string.');
  }
  const timestamp = new Date(rawEntry.occurredAt);
  if (Number.isNaN(timestamp.getTime())) {
    fail('invalid_timestamp', 'Audit entry occurredAt must be a valid date.');
  }
  if (!AUDIT_SOURCES.has(rawEntry.source)) {
    fail('invalid_source', 'Audit entry source is not supported.');
  }

  const rawFormValues = rawEntry.formValues === undefined ? {} : rawEntry.formValues;
  if (!isPlainObject(rawFormValues)) {
    fail('invalid_form_values', 'Audit entry formValues must be a plain object.');
  }

  return {
    id: normalizeIdentifier(rawEntry.id, 'id'),
    accountId: normalizeIdentifier(rawEntry.accountId, 'accountId'),
    boardId: normalizeIdentifier(rawEntry.boardId, 'boardId'),
    itemId: normalizeIdentifier(rawEntry.itemId, 'itemId'),
    columnId: normalizeIdentifier(rawEntry.columnId, 'columnId'),
    actorUserId: normalizeIdentifier(rawEntry.actorUserId, 'actorUserId', { nullable: true }),
    fromLabelId: normalizeIdentifier(rawEntry.fromLabelId, 'fromLabelId', {
      label: true,
      nullable: true,
    }),
    toLabelId: normalizeIdentifier(rawEntry.toLabelId, 'toLabelId', {
      label: true,
      nullable: true,
    }),
    occurredAt: timestamp.toISOString(),
    source: rawEntry.source,
    transitionId: normalizeIdentifier(rawEntry.transitionId, 'transitionId', { nullable: true }),
    formValues: cloneJsonValue(rawFormValues),
  };
}

export function normalizeAuditLog(rawLog) {
  if (rawLog === null || rawLog === undefined) {
    return { version: AUDIT_LOG_VERSION, entries: [] };
  }
  if (!isPlainObject(rawLog)) {
    fail('invalid_log', 'Audit log must be an object.');
  }
  if (rawLog.version !== AUDIT_LOG_VERSION) {
    fail('unsupported_version', `Unsupported audit log version: ${rawLog.version}.`);
  }
  if (!Array.isArray(rawLog.entries)) {
    fail('invalid_log', 'Audit log entries must be an array.');
  }

  const seen = new Set();
  const entries = [];
  rawLog.entries.forEach((rawEntry) => {
    const entry = normalizeAuditEntry(rawEntry);
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      entries.push(entry);
    }
  });

  return { version: AUDIT_LOG_VERSION, entries };
}

export function appendAuditEntry(rawLog, rawEntry, limit = DEFAULT_AUDIT_LOG_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    fail('invalid_limit', 'Audit log limit must be an integer between 1 and 1000.');
  }

  const log = normalizeAuditLog(rawLog);
  const entry = normalizeAuditEntry(rawEntry);
  if (log.entries.some((existing) => existing.id === entry.id)) {
    return log;
  }

  return {
    version: AUDIT_LOG_VERSION,
    entries: [entry, ...log.entries].slice(0, limit),
  };
}
