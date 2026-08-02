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

/** Parse a dropdown column's `settings_str` labels into [{id,label,is_deactivated}].
 *  `labels` may be an object map ({ "1":"כספים" }) or an array of {id,label|name}. */
function labelsFromSettingsStr(settingsStr) {
  let s;
  try {
    s = JSON.parse(settingsStr || '{}');
  } catch (err) {
    // Malformed legacy settings_str → no labels to match on. Recorded (not
    // swallowed) so a broken column config is visible in the funnel; callers
    // degrade to "regular column", which is the safe path.
    logger.warn('managedColumns', 'settings_str parse failed — no labels resolved', err);
    return [];
  }
  const labels = s?.labels;
  if (!labels) return [];
  if (Array.isArray(labels)) {
    return labels.map((l) => ({ id: l.id, label: l.label ?? l.name ?? '', is_deactivated: l.is_deactivated }));
  }
  return Object.entries(labels).map(([id, v]) => ({
    id: Number.isNaN(Number(id)) ? id : Number(id),
    label: typeof v === 'string' ? v : (v?.name ?? v?.label ?? ''),
  }));
}

/** Board dropdown column → normalized ACTIVE labels [{id,label}] from the typed
 *  `settings.labels` array if present, else from `settings_str`. Empty and
 *  deactivated labels are dropped so the signature reflects only real options. */
function dropdownBoardLabels(col) {
  if (!col) return [];
  const typed = Array.isArray(col.settings?.labels) ? col.settings.labels : null;
  const raw = typed
    ? typed.map((l) => ({ id: l.id, label: l.label ?? l.name ?? '', is_deactivated: l.is_deactivated }))
    : labelsFromSettingsStr(col.settings_str);
  return raw.filter((l) => !l.is_deactivated && (l.label ?? '').trim() !== '');
}

/**
 * round312 — find the ACCOUNT's managed dropdown column by exact TITLE.
 *
 * Why a title lookup exists at all: label-signature detection
 * (detectManagedDropdownColumnId below) needs the column to HAVE labels, so it
 * cannot recognise a freshly created, still-empty managed column. Provisioning
 * needs exactly that recognition to stay idempotent — without it, a re-run
 * (or a top-up on an install whose UUID was never persisted) would mint a SECOND
 * account-level "סוג דיון" column, and account-level clutter cannot be cleaned up
 * from inside the app.
 *
 * Exactly one match → its id. Zero or several → null: with duplicates there is no
 * safe way to pick, and guessing would attach the wrong shared column to a
 * customer's board. Best-effort — any API failure returns null, and the caller
 * then treats the column as regular rather than breaking provisioning.
 *
 * @param {string} title
 * @returns {Promise<string|null>}
 */
export async function findManagedDropdownColumnByTitle(title) {
  const wanted = String(title || '').trim();
  if (!wanted) return null;
  try {
    const data = await api(
      `query { managed_column(state: active) { id title settings_json } }`,
      {},
      'findManagedDropdownColumnByTitle'
    );
    const hits = (data?.managed_column || []).filter(
      (m) => m?.settings_json?.type === 'dropdown' && String(m?.title || '').trim() === wanted
    );
    if (hits.length === 1) return String(hits[0].id);
    if (hits.length > 1) {
      logger.warn('managedColumns', 'כמה עמודות מנוהלות עם אותה כותרת — לא ניתן לבחור אחת', {
        title: wanted, count: hits.length,
      });
    }
    return null;
  } catch (err) {
    logger.warn('managedColumns', 'חיפוש עמודה מנוהלת לפי כותרת נכשל', err);
    return null;
  }
}

/**
 * Detect the account managed DROPDOWN column backing a board dropdown column,
 * returning its UUID (or null). The dropdown analog of detectManagedColumnId,
 * but MORE ROBUST about reading the board column's labels: a board dropdown
 * exposes them as a typed `settings.labels` array AND/OR inside `settings_str`
 * (`{"labels":{"1":"כספים",...}}` — an object map, or an array), so we read
 * whichever is populated (detection works even when the typed array is empty).
 * Matches by the exact ACTIVE label signature against account managed columns of
 * type 'dropdown'. Exactly one match → its id; 0 or >1 → null (warn on >1).
 * Best-effort: returns null on any error so the caller falls back to regular.
 *
 * @param {string|number} boardId
 * @param {string} colId
 * @returns {Promise<string|null>}
 */
export async function detectManagedDropdownColumnId(boardId, colId) {
  if (!boardId || !colId) return null;
  try {
    const colData = await api(
      `query ($boardId: [ID!], $colIds: [String!]) {
         boards(ids: $boardId) { columns(ids: $colIds) { id settings settings_str } }
       }`,
      { boardId: [String(boardId)], colIds: [String(colId)] },
      'detectManagedDropdownColumnId.column'
    );
    const boardLabels = dropdownBoardLabels(colData?.boards?.[0]?.columns?.[0]);
    if (!boardLabels.length) return null;
    const boardSig = labelSignature(boardLabels);

    const mcData = await api(
      `query { managed_column(state: active) { id settings_json } }`,
      {},
      'detectManagedDropdownColumnId.list'
    );
    const managed = (mcData?.managed_column || []).filter((m) => m?.settings_json?.type === 'dropdown');
    const matches = managed.filter((m) => labelSignature(m?.settings_json?.labels || []) === boardSig);
    if (matches.length === 1) return String(matches[0].id);
    if (matches.length > 1) {
      logger.warn('managedColumns', 'ambiguous managed-dropdown label match — treating as regular', {
        colId, count: matches.length,
      });
    }
    return null;
  } catch (err) {
    logger.warn('managedColumns', 'detectManagedDropdownColumnId failed — treating as regular', err);
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
 * round304 — RENAME an existing label on an account managed DROPDOWN column.
 * Same mutation and full-label-set contract as addManagedDropdownLabel; the only
 * difference is that the target label keeps its ID and gets new text, which is
 * exactly why items keep their value (a dropdown item stores label IDs, so every
 * discussion of that type simply displays the new name).
 *
 * Behavior contract:
 * - Throws on missing managedColumnId/labelId/title, a missing managed column, or
 *   a labelId that is not on the column.
 * - A trimmed title equal to the current one returns { ok: true, unchanged: true }
 *   WITHOUT mutating.
 * - A different ACTIVE label already carrying that name throws with code
 *   'duplicate' (renaming onto an existing type would merge two types silently).
 * - Otherwise re-sends the FULL label set with the target's text replaced, at the
 *   freshly-read integer revision.
 *
 * @param {{ managedColumnId: string, labelId: string|number, title: string }} args
 * @returns {Promise<{ ok: true, unchanged?: boolean }>}
 */
export async function renameManagedDropdownLabel({ managedColumnId, labelId, title }) {
  const name = String(title || '').trim();
  if (!managedColumnId || labelId == null || !name) {
    throw new Error('renameManagedDropdownLabel: missing managedColumnId/labelId/title');
  }

  const read = await api(
    `query ($id: [String!]) { managed_column(id: $id) { id revision settings_json } }`,
    { id: [String(managedColumnId)] },
    'renameManagedDropdownLabel.read'
  );
  const mc = read?.managed_column?.[0];
  if (!mc) throw new Error('renameManagedDropdownLabel: managed column not found');
  const revision = Number(mc.revision);
  const labels = Array.isArray(mc.settings_json?.labels) ? mc.settings_json.labels : [];

  const target = labels.find((l) => String(l.id) === String(labelId));
  if (!target) throw new Error('renameManagedDropdownLabel: label not found');
  if ((target.label ?? '').trim() === name) return { ok: true, unchanged: true };
  const clash = labels.find((l) => (
    !l.is_deactivated
    && String(l.id) !== String(labelId)
    && (l.label ?? '').trim().toLowerCase() === name.toLowerCase()
  ));
  if (clash) {
    const err = new Error(`סוג דיון בשם "${name}" כבר קיים`);
    err.code = 'duplicate';
    throw err;
  }

  const labelsInput = labels.map((l) => ({
    id: Number(l.id),
    label: String(l.id) === String(labelId) ? name : (l.label ?? ''),
    is_deactivated: l.is_deactivated === true,
  }));

  const res = await api(
    `mutation ($id: String!, $rev: Int!, $s: UpdateDropdownColumnSettingsInput!) {
       update_dropdown_managed_column(id: $id, revision: $rev, settings: $s) { id revision }
     }`,
    { id: String(managedColumnId), rev: revision, s: { labels: labelsInput } },
    'renameManagedDropdownLabel'
  );
  assertNoGraphQLErrors(res, { functionName: 'renameManagedDropdownLabel' });
  logger.info('managedColumns', 'renamed label on managed dropdown column', { managedColumnId, labelId, name });
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

