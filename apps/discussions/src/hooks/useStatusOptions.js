import { useEffect, useState } from 'react';
import { api } from '../utils/mondayApi/monday-client.js';
import { assertNoGraphQLErrors } from '../utils/mondayApi/assertGraphQL.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import {
  toColorEnum,
  pickNewLabelColor,
  addManagedStatusLabel,
} from '../utils/mondayApi/managedColumns.js';
import logger from '../utils/logger.js';
import { GRAY_DEFAULT_LABEL_ID } from '../constants/statusConfig.js';

/*
 * Loads the *actual* status column definition (labels + colors + display order)
 * from the tasks board's configured status column (alias `statusID`). The
 * labels/colors are NOT hardcoded — they come from the column, so the picker and
 * the status fills always match whatever was set up in monday / Settings.
 *
 * Source of truth is the TYPED `settings` field (API 2025-10+): an object whose
 * `labels` is an array of StatusLabel { id, label, color, hex, index,
 * is_deactivated, is_done }. `settings_str` is deprecated as of 2025-10, so we
 * read `settings` and only fall back to parsing `settings_str` for older
 * instances where `settings` isn't populated.
 *
 * THE KEY DISTINCTION (monday's confusing naming):
 *   - label.id    = the STABLE label id — what status VALUES carry (StatusValue.index).
 *                   We read/write status by this id.
 *   - label.index = the DISPLAY ORDER position. We sort/group by this, never write it.
 *
 * Returns:
 *   options:    [{ id, index, label, color, isDone }] sorted by display order
 *   labelById:  { [id]: label }   — id -> text, for display
 *   colorById:  { [id]: color }   — id -> css color (hex)
 *   orderById:  { [id]: rank }    — id -> 0-based display rank, for sorting groups
 *   doneId:     <id|null>         — the is_done label's id (for "is this task done?")
 *   loading:    bool
 * Cached per board+column so it's fetched once across all rows/tabs.
 */
const cache = new Map(); // key `${boardId}:${colId}` -> resolved result
const inflight = new Map();

const EMPTY = { options: [], labelById: {}, colorById: {}, orderById: {}, doneId: null, emptyLabel: null, grayLabel: null };

/*
 * round353 §3 — the GRAY DEFAULT label's stable id. monday pre-creates every status
 * column with a gray label on id 5; provisioning (and owners, by renaming it) put the
 * "not yet" text there ("טרם החל" / "טרם נבחרה"). An EMPTY cell is still *no value* —
 * monday never auto-assigns id 5 — so surfaces render `emptyLabel` for empty values,
 * which makes the gray label read as the empty state everywhere in the app.
 */
// round377 — moved to constants/statusConfig.js (see the note there).

// ---- change-notification (so a newly added label propagates without reload) ----
// The module cache never expired before; `addStatusLabel` now bumps `version`
// and every mounted hook re-reads its cache entry via a useSyncExternalStore-style
// subscription (mirrors peopleColumns.js / usersStore.js).
let version = 0;
const listeners = new Set();
function notify() {
  version += 1;
  listeners.forEach((l) => l());
}
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getVersion() {
  return version;
}

// Typed `settings`: labels is an array of StatusLabel; `id` is the stable label
// id (matches StatusValue.index), `index` is the display order, `hex` is the css
// color, `is_done` flags the done label. Skip deactivated/empty.
function parseTypedSettings(settings) {
  const labels = Array.isArray(settings?.labels) ? settings.labels : null;
  if (!labels) return null;
  return labels
    .filter((l) => !l.is_deactivated && (l.label ?? '').trim() !== '')
    .map((l) => ({
      id: l.id,
      index: l.index,
      label: l.label,
      color: l.hex || null,
      isDone: l.is_done === true,
    }))
    .sort((a, b) => a.index - b.index);
}

// Legacy fallback for instances that don't return the typed `settings` object.
// In settings_str the labels MAP key IS the stable id; labels_positions_v2 maps
// that id -> display position. (is_done isn't exposed here, so doneId is unknown.)
export function parseSettingsStr(settingsStr) {
  let s;
  try { s = JSON.parse(settingsStr || '{}'); } catch (err) { logger.warn('useStatusOptions', 'parseSettingsStr: malformed settings_str', err); return []; }
  const labels = s.labels || {};
  const colors = s.labels_colors || {};
  const positions = s.labels_positions_v2 || {};
  const entries = Array.isArray(labels)
    ? labels.map((l) => [String(l.id), l.name ?? l.label ?? ''])
    : Object.entries(labels);
  return entries
    .map(([key, label]) => ({
      id: Number(key),
      index: typeof positions[key] === 'number' ? positions[key] : Number(key),
      label: typeof label === 'string' ? label : (label?.name ?? ''),
      color: colors[key]?.color || null,
      isDone: false,
    }))
    .filter((o) => o.label && o.label.trim() !== '')
    .sort((a, b) => a.index - b.index);
}

async function load(boardId, colId) {
  const data = await api(
    `query ($boardId: [ID!], $colIds: [String!]) {
       boards(ids: $boardId) { columns(ids: $colIds) { id settings settings_str } }
     }`,
    { boardId: [String(boardId)], colIds: [String(colId)] },
    'useStatusOptions'
  );
  const col = data?.boards?.[0]?.columns?.[0];
  const options = parseTypedSettings(col?.settings) ?? parseSettingsStr(col?.settings_str);
  const labelById = {};
  const colorById = {};
  const orderById = {};
  options.forEach((o, i) => {
    labelById[o.id] = o.label;
    colorById[o.id] = o.color;
    orderById[o.id] = i; // 0-based display rank
  });
  const doneOpt = options.find((o) => o.isDone);
  const doneId = doneOpt ? doneOpt.id : null;
  // Blank gray labels are filtered out by the parsers above, so this is null unless the
  // column really carries a text on id 5 — callers keep their own fallback for null.
  // round354 (Codex P1) — AND only when id 5 is FIRST in display order, which is where an
  // empty-state label lives by definition. Boards provisioned with the OLD priority scheme
  // carry "נמוכה" on id 5 at the LAST position; without the position gate every empty
  // priority cell there would read "נמוכה", making unset indistinguishable from Low.
  const emptyLabel =
    options[0]?.id === GRAY_DEFAULT_LABEL_ID ? (labelById[GRAY_DEFAULT_LABEL_ID] ?? null) : null;
  /*
   * round375 (owner request) — the gray default label's text WITHOUT the
   * position gate, for surfaces that want "the gray default label with whatever
   * text it has, if it has any".
   *
   * It is a SEPARATE field, not a relaxation of emptyLabel, precisely because of
   * the round354 incident the gate exists for: boards provisioned with the OLD
   * priority scheme carry a real label ("נמוכה") on id 5 in the LAST position, and
   * rendering that for an empty cell makes unset indistinguishable from Low. Only
   * callers that know their column is not one of those — the owner-added custom
   * status columns — may use this. Blank-text labels are already filtered out of
   * labelById, so this is null unless the label really carries text.
   */
  const grayLabel = labelById[GRAY_DEFAULT_LABEL_ID] ?? null;
  return { options, labelById, colorById, orderById, doneId, emptyLabel, grayLabel };
}

export function useStatusOptions(boardKey = 'tasks', alias = 'statusID') {
  const colId = getColumns(boardKey)?.[alias]?.id || null;
  const boardId = getBoardId(boardKey) || null;
  const key = boardId && colId ? `${boardId}:${colId}` : null;

  const [state, setState] = useState(() =>
    key && cache.has(key)
      ? { ...cache.get(key), loading: false }
      : { ...EMPTY, loading: !!key }
  );

  useEffect(() => {
    let cancelled = false;
    if (!key) return;
    if (cache.has(key)) { setState({ ...cache.get(key), loading: false }); return; }
    setState((s) => ({ ...s, loading: true }));
    let p = inflight.get(key);
    if (!p) {
      p = load(boardId, colId).catch((err) => {
        // load failure is non-fatal — fall back to empty options — but must be visible.
        logger.warn('useStatusOptions', 'status options load failed', err);
        return { ...EMPTY };
      });
      inflight.set(key, p);
    }
    p.then((res) => {
      cache.set(key, res);
      inflight.delete(key);
      if (!cancelled) setState({ ...res, loading: false });
    }).catch((err) => {
      // p already resolves EMPTY on load failure; this guards the then-callback.
      logger.error('useStatusOptions', 'options state update failed', err);
    });
    return () => { cancelled = true; };
  }, [key, boardId, colId]);

  // Re-read the cache when a label is added elsewhere (addStatusLabel → notify).
  useEffect(() => {
    if (!key) return undefined;
    return subscribe(() => {
      if (cache.has(key)) setState({ ...cache.get(key), loading: false });
    });
  }, [key]);

  return state;
}

/**
 * Fetch a status column's raw labels + revision for the `update_status_column`
 * mutation. Unlike `load`, this keeps EVERY label (incl. deactivated) and
 * resolves each label's monday color ENUM (typed `settings.labels[].color` when
 * it's an enum string, else `settings_str.labels_colors[id].color`) — the
 * mutation replaces the whole labels set, so existing labels must be echoed
 * back losslessly.
 */
async function loadRawLabels(boardId, colId) {
  const data = await api(
    `query ($boardId: [ID!], $colIds: [String!]) {
       boards(ids: $boardId) { columns(ids: $colIds) { id revision settings settings_str } }
     }`,
    { boardId: [String(boardId)], colIds: [String(colId)] },
    'useStatusOptions.loadRawLabels'
  );
  const col = data?.boards?.[0]?.columns?.[0];
  const revision = col?.revision ?? null;

  // settings_str carries enum color names keyed by label id: labels_colors[id].color
  let strColors = {};
  let strLabels = {};
  let strPositions = {};
  try {
    const s = JSON.parse(col?.settings_str || '{}');
    strColors = s.labels_colors || {};
    strLabels = s.labels || {};
    strPositions = s.labels_positions_v2 || {};
  } catch (err) { logger.warn('useStatusOptions', 'malformed settings_str; using defaults', err); }

  const typed = Array.isArray(col?.settings?.labels) ? col.settings.labels : null;
  let labels;
  if (typed) {
    // settings.labels[].color is a numeric INDEX (0,1,2,…), not an enum string —
    // map it via the real StatusColumnColors order (toColorEnum handles both).
    labels = typed.map((l) => ({
      id: Number(l.id),
      label: l.label ?? '',
      index: Number(l.index),
      color: toColorEnum(l.color, Number(l.index) || 0),
      is_deactivated: l.is_deactivated === true,
    }));
  } else {
    // Legacy settings_str path (labels map key IS the stable id).
    const entries = Array.isArray(strLabels)
      ? strLabels.map((l) => [String(l.id), l.name ?? l.label ?? ''])
      : Object.entries(strLabels);
    labels = entries.map(([key, label], i) => ({
      id: Number(key),
      label: typeof label === 'string' ? label : (label?.name ?? ''),
      index: typeof strPositions[key] === 'number' ? strPositions[key] : i,
      color: toColorEnum(strColors[key]?.color, i),
      is_deactivated: false,
    }));
  }
  // The new label's index must clear EVERY used display position, including
  // ORPHANED ones (a deleted label whose id lingers in labels_positions_v2 but
  // not in labels). Reusing an orphan's position triggers the API "structure"
  // rejection. So track the max over both live label indices and stored positions.
  const positionValues = Object.values(strPositions).filter((v) => typeof v === 'number');
  const maxPosition = Math.max(
    -1,
    ...labels.map((l) => Number(l.index) || 0),
    ...positionValues
  );
  return { revision, labels, maxPosition };
}

// Add a new label to a REGULAR (non-managed) board status column via
// update_status_column: re-send the FULL labels array + the new one (no `id`).
async function addRegularStatusLabel(boardId, colId, name) {
  const { revision, labels, maxPosition } = await loadRawLabels(boardId, colId);

  const existing = labels.find(
    (l) => !l.is_deactivated && l.label.trim().toLowerCase() === name.toLowerCase()
  );
  if (existing) return; // duplicate — no write

  const nextIndex = maxPosition + 1; // clears orphaned positions too
  const color = pickNewLabelColor(labels.map((l) => l.color), nextIndex);

  const all = [...labels, { label: name, index: nextIndex, color, is_deactivated: false }];
  const labelsLiteral = all
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((l) => {
      const fields = [
        Number.isFinite(l.id) ? `id: ${l.id}` : null,
        `color: ${l.color}`,
        `label: ${JSON.stringify(l.label)}`,
        `index: ${l.index}`,
        l.is_deactivated ? 'is_deactivated: true' : null,
      ].filter(Boolean);
      return `{ ${fields.join(', ')} }`;
    })
    .join(', ');

  const mutation = `mutation ($boardId: ID!, $columnId: String!, $revision: String!) {
     update_status_column(board_id: $boardId, id: $columnId, revision: $revision, settings: {
       labels: [ ${labelsLiteral} ]
     }) { id }
   }`;
  const variables = { boardId: String(boardId), columnId: String(colId), revision: String(revision ?? '') };
  const res = await api(mutation, variables, 'addStatusLabel');
  assertNoGraphQLErrors(res, { functionName: 'addStatusLabel' });
}

/**
 * Add a NEW label to a status column (name only; color auto-picked), then re-load
 * the column, refresh the module cache, notify subscribers, and return the new
 * label's server-assigned numeric id (or null if it couldn't be resolved).
 *
 * Dual-path: when `managedColumnId` is provided the column is backed by an
 * account-level MANAGED column — labels can ONLY be edited there (board-level
 * `update_status_column` is rejected), and the change propagates back to the
 * board column. Otherwise it's a regular board column. The caller
 * (CreateDiscussionModal) resolves + persists `managedColumnId` via detection.
 *
 * @param {{ boardKey: string, alias: string, title: string, managedColumnId?: string|null }} args
 */
export async function addStatusLabel({ boardKey, alias, title, managedColumnId = null }) {
  const name = String(title || '').trim();
  const boardId = getBoardId(boardKey) || null;
  const colId = getColumns(boardKey)?.[alias]?.id || null;
  if (!name || !boardId || !colId) {
    throw new Error('addStatusLabel: missing name/board/column');
  }

  if (managedColumnId) {
    const r = await addManagedStatusLabel({ managedColumnId, title: name });
    if (r?.duplicateId != null) return Number(r.duplicateId);
  } else {
    await addRegularStatusLabel(boardId, colId, name);
  }

  // Re-load the board column so we pick up the server-assigned id (the managed
  // change propagates to the board column), then refresh cache + notify.
  const prevIds = new Set((cache.get(`${boardId}:${colId}`)?.options || []).map((o) => o.id));
  const fresh = await load(boardId, colId);
  cache.set(`${boardId}:${colId}`, fresh);
  notify();

  logger.info('useStatusOptions', 'added status label', { boardKey, alias, name, managed: !!managedColumnId });
  const added = fresh.options.find(
    (o) => o.label.trim().toLowerCase() === name.toLowerCase() && !prevIds.has(o.id)
  ) || fresh.options.find((o) => o.label.trim().toLowerCase() === name.toLowerCase());
  return added ? added.id : null;
}
