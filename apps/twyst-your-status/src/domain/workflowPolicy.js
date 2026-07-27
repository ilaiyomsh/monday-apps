import logger from '../utils/logger.js';

export const WORKFLOW_CONFIG_VERSION = 1;

export class WorkflowConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowConfigError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message) {
  throw new WorkflowConfigError(code, message);
}

function normalizeIdentifier(value, fieldName, { label = false } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail('invalid_identifier', `${fieldName} must be a non-empty identifier.`);
  }

  const identifier = String(value).trim();
  if (!identifier) {
    fail('invalid_identifier', `${fieldName} must be a non-empty identifier.`);
  }

  if (label && !/^\d+$/.test(identifier)) {
    fail('invalid_identifier', `${fieldName} must be a non-negative integer label id.`);
  }

  return identifier;
}

function normalizeOptionalIdentifier(value, fieldName, options) {
  if (value === null || value === undefined) return null;
  return normalizeIdentifier(value, fieldName, options);
}

function normalizeIdentifierList(values, fieldName, options) {
  if (!Array.isArray(values)) {
    fail('invalid_identifier', `${fieldName} must be an array of identifiers.`);
  }

  const seen = new Set();
  const normalized = [];

  values.forEach((value) => {
    const identifier = normalizeIdentifier(value, fieldName, options);
    if (!seen.has(identifier)) {
      seen.add(identifier);
      normalized.push(identifier);
    }
  });

  return normalized;
}

function normalizePermissions(rawPermissions) {
  if (!isPlainObject(rawPermissions)) {
    fail('invalid_permissions', 'Transition permissions must be an object.');
  }

  if (rawPermissions.mode === 'any') {
    return { mode: 'any', userIds: [], teamIds: [] };
  }

  if (
    rawPermissions.mode !== 'allowlist'
    || !Array.isArray(rawPermissions.userIds)
    || !Array.isArray(rawPermissions.teamIds)
  ) {
    fail('invalid_permissions', 'Allowlist permissions require userIds and teamIds arrays.');
  }

  try {
    return {
      mode: 'allowlist',
      userIds: normalizeIdentifierList(rawPermissions.userIds, 'permissions.userIds'),
      teamIds: normalizeIdentifierList(rawPermissions.teamIds, 'permissions.teamIds'),
    };
  } catch (error) {
    if (error instanceof WorkflowConfigError) {
      fail('invalid_permissions', error.message);
    }
    throw error;
  }
}

function normalizeFormFields(rawFields) {
  if (rawFields === undefined) return [];
  if (!Array.isArray(rawFields)) {
    fail('invalid_form_field', 'Transition formFields must be an array.');
  }

  const seen = new Set();
  return rawFields.map((rawField) => {
    if (!isPlainObject(rawField)) {
      fail('invalid_form_field', 'Every transition form field must be an object.');
    }
    if (rawField.required !== undefined && typeof rawField.required !== 'boolean') {
      fail('invalid_form_field', 'A transition form field required flag must be boolean.');
    }

    const columnId = normalizeIdentifier(rawField.columnId, 'formFields.columnId');
    if (seen.has(columnId)) {
      fail('duplicate_form_field', `The form field ${columnId} is declared more than once.`);
    }
    seen.add(columnId);

    return {
      columnId,
      required: rawField.required ?? false,
      label: typeof rawField.label === 'string' ? rawField.label.trim() : '',
    };
  });
}

function normalizeTransition(rawTransition) {
  if (!isPlainObject(rawTransition)) {
    fail('invalid_transition', 'Every transition must be an object.');
  }

  const fromLabelId = normalizeIdentifier(
    rawTransition.fromLabelId,
    'transition.fromLabelId',
    { label: true },
  );
  const toLabelId = normalizeIdentifier(
    rawTransition.toLabelId,
    'transition.toLabelId',
    { label: true },
  );

  if (fromLabelId === toLabelId) {
    fail('self_transition', 'A transition cannot point to the same status label.');
  }

  const rawRequiredColumnIds = rawTransition.requiredColumnIds ?? [];
  if (!Array.isArray(rawRequiredColumnIds)) {
    fail('invalid_transition', 'Transition requiredColumnIds must be an array.');
  }

  return {
    id: normalizeIdentifier(rawTransition.id, 'transition.id'),
    fromLabelId,
    toLabelId,
    permissions: normalizePermissions(rawTransition.permissions),
    requiredColumnIds: normalizeIdentifierList(
      rawRequiredColumnIds,
      'transition.requiredColumnIds',
    ),
    formFields: normalizeFormFields(rawTransition.formFields),
  };
}

export function normalizeWorkflowConfig(rawConfig) {
  if (!isPlainObject(rawConfig)) {
    fail('invalid_config', 'Workflow configuration must be an object.');
  }
  if (rawConfig.schemaVersion === undefined) {
    fail('invalid_config', 'Workflow configuration must declare schemaVersion.');
  }
  if (rawConfig.schemaVersion !== WORKFLOW_CONFIG_VERSION) {
    fail('unsupported_version', `Unsupported workflow schema version: ${rawConfig.schemaVersion}.`);
  }
  if (!Array.isArray(rawConfig.transitions)) {
    fail('invalid_config', 'Workflow transitions must be an array.');
  }
  if (
    rawConfig.hiddenManualLabelIds !== undefined
    && !Array.isArray(rawConfig.hiddenManualLabelIds)
  ) {
    fail('invalid_config', 'hiddenManualLabelIds must be an array.');
  }
  if (
    rawConfig.enforcement !== undefined
    && (
      !isPlainObject(rawConfig.enforcement)
      || typeof rawConfig.enforcement.enabled !== 'boolean'
    )
  ) {
    fail('invalid_config', 'enforcement.enabled must be boolean.');
  }

  const transitions = rawConfig.transitions.map(normalizeTransition);
  const seenEdges = new Set();
  transitions.forEach((transition) => {
    const edge = `${transition.fromLabelId}:${transition.toLabelId}`;
    if (seenEdges.has(edge)) {
      fail('duplicate_transition', `The transition edge ${edge} is declared more than once.`);
    }
    seenEdges.add(edge);
  });

  return {
    schemaVersion: WORKFLOW_CONFIG_VERSION,
    accountId: normalizeIdentifier(rawConfig.accountId, 'accountId'),
    boardId: normalizeIdentifier(rawConfig.boardId, 'boardId'),
    targetColumnId: normalizeIdentifier(rawConfig.targetColumnId, 'targetColumnId'),
    hiddenManualLabelIds: normalizeIdentifierList(
      rawConfig.hiddenManualLabelIds ?? [],
      'hiddenManualLabelIds',
      { label: true },
    ),
    transitions,
    enforcement: {
      enabled: rawConfig.enforcement?.enabled ?? false,
    },
    updatedAt: rawConfig.updatedAt ?? null,
    updatedBy: normalizeOptionalIdentifier(rawConfig.updatedBy, 'updatedBy'),
  };
}

function hasMeaningfulContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulContent);
  if (isPlainObject(value)) return Object.values(value).some(hasMeaningfulContent);
  return true;
}

function isMondayColumnValueWrapper(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.includes('id') && keys.every((key) => ['id', 'text', 'value'].includes(key));
}

export function isFilledColumnValue(columnValue) {
  if (!isMondayColumnValueWrapper(columnValue)) {
    if (Array.isArray(columnValue)) return columnValue.length > 0;
    if (isPlainObject(columnValue)) return Object.keys(columnValue).length > 0;
    return hasMeaningfulContent(columnValue);
  }

  if (typeof columnValue.text === 'string' && columnValue.text.trim()) return true;
  if (columnValue.value === null || columnValue.value === undefined) return false;
  if (typeof columnValue.value !== 'string') return hasMeaningfulContent(columnValue.value);
  if (!columnValue.value.trim()) return false;

  try {
    return hasMeaningfulContent(JSON.parse(columnValue.value));
  } catch (error) {
    logger.warn('workflowPolicy', 'Treating malformed serialized monday value as filled.', error);
    return true;
  }
}

function tryNormalizeIdentifier(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const identifier = String(value).trim();
  return identifier || null;
}

export function findMissingRequiredColumnIds(requiredColumnIds, itemColumnValues) {
  const normalizedIds = [];
  const seen = new Set();
  (Array.isArray(requiredColumnIds) ? requiredColumnIds : []).forEach((value) => {
    const identifier = tryNormalizeIdentifier(value);
    if (identifier !== null && !seen.has(identifier)) {
      seen.add(identifier);
      normalizedIds.push(identifier);
    }
  });

  const valuesById = new Map();
  (Array.isArray(itemColumnValues) ? itemColumnValues : []).forEach((columnValue) => {
    if (!isPlainObject(columnValue)) return;
    const identifier = tryNormalizeIdentifier(columnValue.id);
    if (identifier !== null && !valuesById.has(identifier)) {
      valuesById.set(identifier, columnValue);
    }
  });

  return normalizedIds.filter((columnId) => !isFilledColumnValue(valuesById.get(columnId)));
}

export function isActorPermitted(permissions, actor) {
  if (!isPlainObject(permissions)) return false;
  if (permissions.mode === 'any') return true;
  if (
    permissions.mode !== 'allowlist'
    || !Array.isArray(permissions.userIds)
    || !Array.isArray(permissions.teamIds)
  ) {
    return false;
  }

  const allowedUsers = new Set(permissions.userIds.map(tryNormalizeIdentifier).filter(Boolean));
  const allowedTeams = new Set(permissions.teamIds.map(tryNormalizeIdentifier).filter(Boolean));
  const actorUserId = tryNormalizeIdentifier(actor?.userId);
  const actorTeamIds = (Array.isArray(actor?.teamIds) ? actor.teamIds : [])
    .map(tryNormalizeIdentifier)
    .filter(Boolean);

  return (
    (actorUserId !== null && allowedUsers.has(actorUserId))
    || actorTeamIds.some((teamId) => allowedTeams.has(teamId))
  );
}

export function evaluateTransitionAttempt(attempt) {
  const config = normalizeWorkflowConfig(attempt?.config);
  const columnId = tryNormalizeIdentifier(attempt?.columnId);

  if (columnId !== config.targetColumnId) {
    return { kind: 'ignore', code: 'target_column_not_managed' };
  }
  if (attempt?.internalRollback === true) {
    return { kind: 'ignore', code: 'internal_rollback' };
  }

  const fromLabelId = tryNormalizeIdentifier(attempt?.fromLabelId);
  const toLabelId = tryNormalizeIdentifier(attempt?.toLabelId);
  if (fromLabelId === toLabelId) {
    return { kind: 'ignore', code: 'no_state_change' };
  }

  const transition = config.transitions.find(
    (candidate) => (
      candidate.fromLabelId === fromLabelId
      && candidate.toLabelId === toLabelId
    ),
  );
  if (!transition) {
    return { kind: 'deny', code: 'transition_not_defined' };
  }
  if (!isActorPermitted(transition.permissions, attempt?.actor)) {
    return {
      kind: 'deny',
      code: 'actor_not_permitted',
      transitionId: transition.id,
    };
  }

  const missingColumnIds = findMissingRequiredColumnIds(
    transition.requiredColumnIds,
    attempt?.itemColumnValues,
  );
  if (missingColumnIds.length > 0) {
    return {
      kind: 'deny',
      code: 'required_fields_missing',
      transitionId: transition.id,
      missingColumnIds,
    };
  }

  return {
    kind: 'allow',
    code: 'transition_allowed',
    transition,
  };
}
