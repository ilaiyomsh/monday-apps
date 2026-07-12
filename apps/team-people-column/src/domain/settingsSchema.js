/**
 * settingsSchema — the column-settings contract for team-people-column.
 *
 * Owns: the default policy, migration of persisted settings across versions, structural
 * validation of settings against a board's live columns, and policy extraction with defaults.
 *
 * Settings v1 shape:
 *   { version: 1, relationColumnId, linkedBoardId, peopleColumnId, policy }
 * where policy = { selectionMode, aggregation, includeListedPersons }.
 *
 * Pure module — no SDK/React/service imports (logger is the only dependency, for the
 * unknown-version warning).
 */

import logger from '../utils/logger.js';

/**
 * The default policy applied when settings omit a policy or individual policy fields.
 * @type {{ selectionMode: string, aggregation: string, includeListedPersons: boolean }}
 */
export const DEFAULT_POLICY = { selectionMode: 'multi', aggregation: 'union', includeListedPersons: true };

/** Current settings schema version this module writes. */
export const CURRENT_VERSION = 1;

/**
 * Extract a full policy object from a settings-like object, filling any missing field from
 * DEFAULT_POLICY. A missing/invalid `policy` yields the full default policy.
 * @param {object} [settings]
 * @returns {{ selectionMode: string, aggregation: string, includeListedPersons: boolean }}
 */
export function policyFromSettings(settings) {
  const p =
    settings && typeof settings === 'object' && settings.policy && typeof settings.policy === 'object'
      ? settings.policy
      : {};
  return {
    selectionMode: p.selectionMode ?? DEFAULT_POLICY.selectionMode,
    aggregation: p.aggregation ?? DEFAULT_POLICY.aggregation,
    includeListedPersons: p.includeListedPersons ?? DEFAULT_POLICY.includeListedPersons
  };
}

/**
 * Migrate raw persisted settings to the current v1 shape.
 * - null/undefined -> null (unconfigured)
 * - missing version -> best-effort map of known keys + default policy
 * - version === 1 -> pass through (normalized)
 * - higher unknown version -> keep known keys, downgrade to current schema, logger.warn
 * @param {*} raw
 * @returns {object|null}
 */
export function migrateSettings(raw) {
  // null / undefined (and any non-object) => unconfigured.
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return null;
  }

  const version = raw.version;

  // Unknown higher version: keep the known keys, downgrade to the current schema, and warn.
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    logger.warn(
      'settingsSchema',
      `Unknown settings version ${version}; keeping known keys and downgrading to v${CURRENT_VERSION}`,
      { fromVersion: version, toVersion: CURRENT_VERSION }
    );
  }

  // v1, versionless (best-effort), and downgraded higher-version all normalize to the same
  // known-key shape with a defaults-filled policy.
  return {
    version: CURRENT_VERSION,
    relationColumnId: raw.relationColumnId ?? null,
    linkedBoardId: raw.linkedBoardId ?? null,
    peopleColumnId: raw.peopleColumnId ?? null,
    policy: policyFromSettings(raw)
  };
}

/**
 * Validate settings against a board columns array (as returned by GetBoardColumns).
 * @param {object} settings - a v1 settings object
 * @param {Array<{id:string,type:string}>} columns
 * @returns {{ ok: boolean, problems: string[] }} problem codes:
 *   RELATION_COLUMN_MISSING | RELATION_COLUMN_TYPE_CHANGED | PEOPLE_COLUMN_MISSING
 */
export function validateSettings(settings, columns) {
  const problems = [];
  const cols = Array.isArray(columns) ? columns : [];
  const s = settings && typeof settings === 'object' ? settings : {};

  // Relation column: must exist AND still be a board_relation column.
  const relCol = cols.find((c) => c && c.id === s.relationColumnId);
  if (!relCol) {
    problems.push('RELATION_COLUMN_MISSING');
  } else if (relCol.type !== 'board_relation') {
    problems.push('RELATION_COLUMN_TYPE_CHANGED');
  }

  // People column: must exist on the linked board.
  const peopleCol = cols.find((c) => c && c.id === s.peopleColumnId);
  if (!peopleCol) {
    problems.push('PEOPLE_COLUMN_MISSING');
  }

  return { ok: problems.length === 0, problems };
}
