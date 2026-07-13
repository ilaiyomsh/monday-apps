/*
 * managedColumns — support for adding a status label when the mapped status
 * column is backed by an ACCOUNT-LEVEL managed column.
 *
 * WHY THIS EXISTS: a board status column that is an instance of a managed
 * column CANNOT have its labels edited via the board-level mutations
 * (`update_status_column` / `update_column` both return
 * `notices.column.settings.update.error.structure`). Managed-column labels are
 * governed at the account level and must be edited via
 * `update_status_managed_column` (UUID + integer revision) — the change then
 * propagates to every board column that instances it (verified live).
 *
 * monday exposes NO field/query mapping a board column → its managed column, so
 * we detect by matching the board column's label set against the account's
 * managed columns, and persist the resolved UUID in settings (see
 * CreateDiscussionModal / SettingsModal). This module holds the detection + the
 * managed-column label mutation. Colors: monday stores each label's `color` as a
 * numeric INDEX into the StatusColumnColors enum whose order is below.
 */
import { api } from './monday-client.js';
import { assertNoGraphQLErrors } from './assertGraphQL.js';
import logger from '../logger.js';

// The monday StatusColumnColors enum, in the order that IS the numeric color
// index (verified live: index 0→working_orange #fdab3d, 1→done_green #00c875,
// 2→stuck_red #df2f4a, 3→dark_blue #007eb5). settings/settings_json carry the
// index; the update mutations want the enum NAME.
export const STATUS_COLOR_ENUMS = [
  'working_orange', 'done_green', 'stuck_red', 'dark_blue', 'purple',
  'explosive', 'grass_green', 'bright_blue', 'saladish', 'egg_yolk',
  'blackish', 'dark_red', 'sofia_pink', 'lipstick', 'dark_purple',
  'bright_green', 'chili_blue', 'american_gray', 'brown', 'dark_orange',
  'sunset', 'bubble', 'peach', 'berry', 'winter',
  'river', 'navy', 'aquamarine', 'indigo', 'dark_indigo',
  'pecan', 'lavender', 'royal', 'steel', 'orchid',
  'lilac', 'tan', 'sky', 'coffee', 'teal',
];
const STATUS_COLOR_SET = new Set(STATUS_COLOR_ENUMS);

// A curated subset of VIVID colors to auto-assign to new labels. Excludes muted /
// gray-rendering enums — critically `explosive`, which monday renders as the
// DEFAULT gray (#c4c4c4) and then LOCKS the label (can't recolor/delete via API),
// plus american_gray/blackish/brown/steel/tan/coffee/pecan. Auto-picking any of
// these produced a gray "no color" label, so new labels draw only from here.
export const VIVID_COLOR_ENUMS = [
  'done_green', 'working_orange', 'stuck_red', 'dark_blue', 'purple',
  'dark_orange', 'bright_blue', 'sofia_pink', 'bright_green', 'egg_yolk',
  'dark_red', 'lipstick', 'grass_green', 'chili_blue', 'saladish',
  'sunset', 'berry', 'river', 'indigo', 'navy',
  'aquamarine', 'teal', 'dark_purple', 'orchid',
];

/** Pick a VIVID color enum not already used by the given label colors (enum names). */
export function pickNewLabelColor(usedColorEnums, seqIndex = 0) {
  const used = new Set(usedColorEnums);
  return (
    VIVID_COLOR_ENUMS.find((c) => !used.has(c)) ||
    VIVID_COLOR_ENUMS[seqIndex % VIVID_COLOR_ENUMS.length]
  );
}

/** Coerce a stored color (numeric index, or already an enum name) to an enum name. */
export function toColorEnum(value, fallbackIndex = 0) {
  if (typeof value === 'string' && STATUS_COLOR_SET.has(value)) return value;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0 && n < STATUS_COLOR_ENUMS.length) return STATUS_COLOR_ENUMS[n];
  return STATUS_COLOR_ENUMS[fallbackIndex % STATUS_COLOR_ENUMS.length];
}

/** A normalized signature of a label set: sorted "id:label" of ACTIVE labels. */
function labelSignature(labels = []) {
  return labels
    .filter((l) => !l.is_deactivated)
    .map((l) => `${l.id}:${(l.label ?? '').trim()}`)
    .sort()
    .join('|');
}

/**
 * Detect whether a board status/dropdown column is backed by an account managed
 * column, returning that managed column's UUID (or null if it's a regular
 * column). Matches by the exact ACTIVE label set (ids + texts) — strong enough
 * to disambiguate columns that merely share a title. Best-effort: returns null
 * on any API failure so the caller falls back to the regular board-level path.
 *
 * @param {string|number} boardId
 * @param {string} colId
 * @param {{ type?: 'dropdown'|'color' }} [opts] when `type` is given, only
 *   managed columns whose settings_json.type equals it are candidates — the
 *   real account has managed columns of BOTH types named "סוג דיון", and the
 *   dropdown/status update mutations are not interchangeable.
 */
export async function detectManagedColumnId(boardId, colId, opts = {}) {
  if (!boardId || !colId) return null;
  try {
    const colData = await api(
      `query ($boardId: [ID!], $colIds: [String!]) {
         boards(ids: $boardId) { columns(ids: $colIds) { id settings } }
       }`,
      { boardId: [String(boardId)], colIds: [String(colId)] },
      'detectManagedColumnId.column'
    );
    const boardLabels = colData?.boards?.[0]?.columns?.[0]?.settings?.labels;
    if (!Array.isArray(boardLabels) || !boardLabels.length) return null;
    const boardSig = labelSignature(boardLabels);

    const mcData = await api(
      `query { managed_column(state: active) { id settings_json } }`,
      {},
      'detectManagedColumnId.list'
    );
    const managed = mcData?.managed_column || [];
    const candidates = opts?.type
      ? managed.filter((m) => m?.settings_json?.type === opts.type)
      : managed;
    const matches = candidates.filter(
      (m) => labelSignature(m?.settings_json?.labels || []) === boardSig
    );
    if (matches.length === 1) return String(matches[0].id);
    if (matches.length > 1) {
      logger.warn('managedColumns', 'ambiguous managed-column label match — treating as regular', {
        colId, count: matches.length,
      });
    }
    return null;
  } catch (err) {
    logger.warn('managedColumns', 'detectManagedColumnId failed — treating as regular', err);
    return null;
  }
}

/**
 * Add a new label to an account managed DROPDOWN column via
 * update_dropdown_managed_column — the dropdown sibling of
 * addManagedStatusLabel. Dropdown labels carry NO color/index/is_done — the
 * update input is only { id?, label, is_deactivated? }.
 *
 * Behavior contract:
 * - Throws Error('addManagedDropdownLabel: missing managedColumnId/title')
 *   when managedColumnId is falsy or title trims to ''.
 * - Reads the managed column (id, integer revision, settings_json). A missing
 *   column throws Error('addManagedDropdownLabel: managed column not found').
 * - If an ACTIVE label already matches the trimmed title case-insensitively,
 *   returns { duplicateId: <number> } WITHOUT mutating.
 * - Otherwise sends update_dropdown_managed_column with the FULL label set —
 *   every existing label re-sent as { id: Number, label, is_deactivated }
 *   (omitting one is a DELETE attempt; monday blocks it only when the label is
 *   in use, otherwise it deletes silently) — plus the new label WITHOUT an id
 *   (the server assigns it), using the freshly-read integer revision.
 * - Returns { ok: true } on success; API soft errors (REVISION_MISMATCH 409,
 *   INVALID_INPUT, permission failures) surface as thrown errors carrying
 *   `errorCode` — the caller decides retry/fallback policy.
 *
 * @param {{ managedColumnId: string, title: string }} args
 * @returns {Promise<{ ok: true } | { duplicateId: number }>}
 */
export async function addManagedDropdownLabel({ managedColumnId, title }) {
  const name = String(title || '').trim();
  if (!managedColumnId || !name) throw new Error('addManagedDropdownLabel: missing managedColumnId/title');

  const read = await api(
    `query ($id: [String!]) { managed_column(id: $id) { id revision settings_json } }`,
    { id: [String(managedColumnId)] },
    'addManagedDropdownLabel.read'
  );
  const mc = read?.managed_column?.[0];
  if (!mc) throw new Error('addManagedDropdownLabel: managed column not found');
  const revision = Number(mc.revision);
  const labels = Array.isArray(mc.settings_json?.labels) ? mc.settings_json.labels : [];

  // Duplicate name (active) → return the existing id, no write.
  const existing = labels.find(
    (l) => !l.is_deactivated && (l.label ?? '').trim().toLowerCase() === name.toLowerCase()
  );
  if (existing) return { duplicateId: Number(existing.id) };

  // Faithfully echo every existing label (incl. deactivated) + the id-less new
  // one — a partial set is a DELETE attempt on the omitted labels.
  const labelsInput = labels
    .map((l) => ({
      id: Number(l.id),
      label: l.label ?? '',
      is_deactivated: l.is_deactivated === true,
    }))
    .concat([{ label: name, is_deactivated: false }]);

  const res = await api(
    `mutation ($id: String!, $rev: Int!, $s: UpdateDropdownColumnSettingsInput!) {
       update_dropdown_managed_column(id: $id, revision: $rev, settings: $s) { id revision }
     }`,
    { id: String(managedColumnId), rev: revision, s: { labels: labelsInput } },
    'addManagedDropdownLabel'
  );
  assertNoGraphQLErrors(res, { functionName: 'addManagedDropdownLabel' });
  logger.info('managedColumns', 'added label to managed dropdown column', { managedColumnId, name });
  return { ok: true };
}

/**
 * Add a new label to an account managed status column via
 * update_status_managed_column. Re-sends the FULL label set (existing labels
 * keep their id + color/index/flags; the new one omits id → monday assigns it),
 * using a fresh integer revision. Change propagates to all board columns.
 * Returns the mutation result; the caller re-reads the board column for the new
 * label id.
 */
export async function addManagedStatusLabel({ managedColumnId, title }) {
  const name = String(title || '').trim();
  if (!managedColumnId || !name) throw new Error('addManagedStatusLabel: missing managedColumnId/title');

  const read = await api(
    `query ($id: [String!]) { managed_column(id: $id) { id revision settings_json } }`,
    { id: [String(managedColumnId)] },
    'addManagedStatusLabel.read'
  );
  const mc = read?.managed_column?.[0];
  if (!mc) throw new Error('addManagedStatusLabel: managed column not found');
  const revision = Number(mc.revision);
  const labels = Array.isArray(mc.settings_json?.labels) ? mc.settings_json.labels : [];

  // Duplicate name (active) → return the existing id, no write.
  const existing = labels.find(
    (l) => !l.is_deactivated && (l.label ?? '').trim().toLowerCase() === name.toLowerCase()
  );
  if (existing) return { duplicateId: Number(existing.id) };

  const nextIndex = labels.reduce((m, l) => Math.max(m, Number(l.index) || 0), -1) + 1;
  const usedColors = labels.map((l) => toColorEnum(l.color, l.index));
  const color = pickNewLabelColor(usedColors, nextIndex);

  // Faithfully echo every existing label (incl. deactivated) + the new one.
  const labelsInput = labels
    .map((l) => ({
      id: Number(l.id),
      color: toColorEnum(l.color, l.index),
      label: l.label ?? '',
      index: Number(l.index),
      is_done: l.is_done === true,
      is_deactivated: l.is_deactivated === true,
    }))
    .concat([{ color, label: name, index: nextIndex, is_done: false, is_deactivated: false }]);

  const res = await api(
    `mutation ($id: String!, $rev: Int!, $s: UpdateStatusColumnSettingsInput!) {
       update_status_managed_column(id: $id, revision: $rev, settings: $s) { id revision }
     }`,
    { id: String(managedColumnId), rev: revision, s: { labels: labelsInput } },
    'addManagedStatusLabel'
  );
  assertNoGraphQLErrors(res, { functionName: 'addManagedStatusLabel' });
  logger.info('managedColumns', 'added label to managed column', { managedColumnId, name });
  return { ok: true };
}

