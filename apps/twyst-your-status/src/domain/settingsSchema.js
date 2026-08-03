/**
 * settingsSchema — column settings contract for Twyst Your Status (client-only).
 *
 * v1 shape:
 * {
 *   version: 1,
 *   hiddenLabelIds: string[],
 *   labels: {
 *     [labelIndex: string]: {
 *       allowedUserIds: string[],
 *       allowedTeamIds: string[],
 *       requiredColumnIds: string[],
 *       requiredPeopleColumnIds: string[], // people columns the actor must appear in
 *     }
 *   }
 * }
 *
 * A label absent from `labels` (or with empty allowlists) means everyone may
 * select it. hiddenLabelIds are omitted from the picker only — automation/API
 * can still set them.
 */

import { normalizeOwners } from './columnOwners.js';
import logger from '../utils/logger.js';

export const CURRENT_VERSION = 1;

function normalizeIdentifier(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const identifier = String(value).trim();
  return identifier || null;
}

function normalizeIdentifierList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const id = normalizeIdentifier(value);
    if (id === null || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizeLabelIdList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const trimmed = String(value).trim();
    if (!/^\d+$/.test(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  });
  return out;
}

export function emptyLabelRule() {
  return {
    allowedUserIds: [],
    allowedTeamIds: [],
    requiredColumnIds: [],
    requiredPeopleColumnIds: [],
  };
}

export function normalizeLabelRule(rawRule) {
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
    return emptyLabelRule();
  }
  return {
    allowedUserIds: normalizeIdentifierList(rawRule.allowedUserIds),
    allowedTeamIds: normalizeIdentifierList(rawRule.allowedTeamIds),
    requiredColumnIds: normalizeIdentifierList(rawRule.requiredColumnIds),
    requiredPeopleColumnIds: normalizeIdentifierList(rawRule.requiredPeopleColumnIds),
    /*
     * round321 — transition restriction: after this label, ONLY these labels are
     * offered. Present ONLY as an array (empty = terminal status; nothing may
     * follow). Absence — not null, not undefined-valued — is the unrestricted
     * default: several suites pin the rule as exactly the four keys above, and
     * every settings blob stored before this round has no such key, so key-absence
     * is what "no restriction" has to look like.
     */
    ...(Array.isArray(rawRule.nextLabelIds)
      ? { nextLabelIds: normalizeLabelIdList(rawRule.nextLabelIds) }
      : {}),
  };
}

/**
 * True when the rule imposes no allowlist restriction (everyone may pick).
 */
export function isOpenAllowlist(rule) {
  const normalized = normalizeLabelRule(rule);
  return normalized.allowedUserIds.length === 0 && normalized.allowedTeamIds.length === 0;
}

/**
 * Migrate raw persisted settings to the current v1 shape.
 * null/undefined/non-object → null (unconfigured).
 */
export function migrateSettings(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const version = raw.version;
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    logger.warn(
      'settingsSchema',
      `Unknown settings version ${version}; keeping known keys and downgrading to v${CURRENT_VERSION}`,
      { fromVersion: version, toVersion: CURRENT_VERSION },
    );
  }

  // Legacy status-guard shape → treat as configured with only hidden labels.
  if (
    raw.version === 1
    && Array.isArray(raw.restrictedLabelIds)
    && raw.labels === undefined
    && raw.hiddenLabelIds === undefined
  ) {
    return {
      version: CURRENT_VERSION,
      hiddenLabelIds: normalizeLabelIdList(raw.restrictedLabelIds),
      labels: {},
    };
  }

  const labels = {};
  if (raw.labels && typeof raw.labels === 'object' && !Array.isArray(raw.labels)) {
    Object.entries(raw.labels).forEach(([key, rule]) => {
      const labelId = normalizeLabelIdList([key])[0];
      if (!labelId) return;
      labels[labelId] = normalizeLabelRule(rule);
    });
  }

  // Per-column owners (round322). Carried ONLY when a valid record is present:
  // absence stays absent so every pre-round322 blob keeps its exact 3-key shape
  // (18 suites toEqual it) and an unadopted column falls back to the legacy gate.
  const owners = normalizeOwners(raw.owners);

  return {
    version: CURRENT_VERSION,
    hiddenLabelIds: normalizeLabelIdList(raw.hiddenLabelIds ?? []),
    labels,
    ...(owners ? { owners } : {}),
  };
}

/**
 * Structural validation against live board columns (optional columns array).
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateSettings(settings, columns) {
  const problems = [];
  const s = migrateSettings(settings);
  if (!s) {
    problems.push('SETTINGS_MISSING');
    return { ok: false, problems };
  }

  const cols = Array.isArray(columns) ? columns : null;
  if (cols) {
    const columnIds = new Set(cols.map((column) => String(column.id)));
    const peopleColumnIds = new Set(
      cols.filter((column) => column.type === 'people').map((column) => String(column.id)),
    );
    Object.values(s.labels).forEach((rule) => {
      rule.requiredColumnIds.forEach((columnId) => {
        if (!columnIds.has(columnId)) {
          problems.push(`REQUIRED_COLUMN_MISSING:${columnId}`);
        }
      });
      rule.requiredPeopleColumnIds.forEach((columnId) => {
        if (!columnIds.has(columnId)) {
          problems.push(`REQUIRED_PEOPLE_COLUMN_MISSING:${columnId}`);
        } else if (!peopleColumnIds.has(columnId)) {
          problems.push(`REQUIRED_PEOPLE_COLUMN_NOT_PEOPLE:${columnId}`);
        }
      });
    });
  }

  return { ok: problems.length === 0, problems };
}

export function getLabelRule(settings, labelId) {
  const migrated = migrateSettings(settings);
  if (!migrated) return emptyLabelRule();
  const key = normalizeLabelIdList([labelId])[0];
  if (!key) return emptyLabelRule();
  return migrated.labels[key] ?? emptyLabelRule();
}

/** Unique people-column ids referenced by any label rule (for picker fetches). */
export function collectRequiredPeopleColumnIds(settings) {
  const migrated = migrateSettings(settings);
  if (!migrated) return [];
  const seen = new Set();
  const out = [];
  Object.values(migrated.labels).forEach((rule) => {
    rule.requiredPeopleColumnIds.forEach((columnId) => {
      if (seen.has(columnId)) return;
      seen.add(columnId);
      out.push(columnId);
    });
  });
  return out;
}
