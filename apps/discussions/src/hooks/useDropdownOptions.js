import { useEffect, useState } from 'react';
import { api } from '../utils/mondayApi/monday-client.js';
import { assertNoGraphQLErrors } from '../utils/mondayApi/assertGraphQL.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import {
  addManagedDropdownLabel,
  detectManagedDropdownColumnId,
} from '../utils/mondayApi/managedColumns.js';
import logger from '../utils/logger.js';

/*
 * Loads the available labels of a DROPDOWN column (by board key + alias), so a
 * chips picker can offer exactly the options configured in monday — nothing is
 * hardcoded. Mirrors useStatusOptions, but dropdown VALUES are written/read by
 * label NAME (formatValue('dropdown', [names]) -> { labels:[...] };
 * parseValue('dropdown') -> comma-joined text), so options expose the name.
 *
 * Reads the typed `settings` first (API 2025-10+); for dropdown that's
 * `{ options: [{ id, label }] }`. Falls back to parsing `settings_str`
 * (`{ labels: [{ id, name }] }`) for older instances.
 *
 * Returns: { options: [{ id, label }], labels: string[], loading }.
 * Cached per board+column so it's fetched once across all consumers.
 */
const cache = new Map();
const inflight = new Map();

// ---- change-notification (so a newly added label propagates without reload) ----
// Mirrors useStatusOptions: `addDropdownLabel` refreshes this column's cache
// entry, bumps `version`, and every mounted hook re-reads its entry via the
// subscription below.
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

const EMPTY = { options: [], labels: [] };

function parseTypedSettings(settings) {
  const list = Array.isArray(settings?.options)
    ? settings.options
    : Array.isArray(settings?.labels)
      ? settings.labels
      : null;
  if (!list) return null;
  return list
    .map((o) => ({ id: o.id, label: o.label ?? o.name ?? '' }))
    .filter((o) => o.label && o.label.trim() !== '');
}

function parseSettingsStr(settingsStr) {
  let s;
  try {
    s = JSON.parse(settingsStr || '{}');
  } catch (err) {
    // Malformed legacy settings_str → empty options; recorded so a broken
    // column config is visible in the funnel instead of a silently empty picker.
    logger.error('useDropdownOptions', 'settings_str parse failed', err);
    return [];
  }
  const labels = s.labels || [];
  const entries = Array.isArray(labels) ? labels : Object.entries(labels).map(([id, v]) => ({ id, name: typeof v === 'string' ? v : v?.name }));
  return entries
    .map((l) => ({ id: l.id, label: l.name ?? l.label ?? '' }))
    .filter((o) => o.label && o.label.trim() !== '');
}

async function load(boardId, colId) {
  const data = await api(
    `query ($boardId: [ID!], $colIds: [String!]) {
       boards(ids: $boardId) { columns(ids: $colIds) { id settings settings_str } }
     }`,
    { boardId: [String(boardId)], colIds: [String(colId)] },
    'useDropdownOptions'
  );
  const col = data?.boards?.[0]?.columns?.[0];
  const options = parseTypedSettings(col?.settings) ?? parseSettingsStr(col?.settings_str);
  return { options, labels: options.map((o) => o.label) };
}

/**
 * Add a NEW label to a dropdown column (by board key + alias) DIRECTLY — the
 * replacement for relying on create_labels_if_missing at save time (which
 * silently cannot create labels on managed columns; 2026-07-12 incident).
 * Dual-path like useStatusOptions.addStatusLabel:
 *
 * - Empty/blank title, or an unresolved board/column mapping, throws
 *   Error('addDropdownLabel: missing name/board/column').
 * - When `managedColumnId` resolves (the given hint, else the config-store
 *   `getColumns(boardKey)[alias].managedColumnId`), the label is added via
 *   addManagedDropdownLabel (account-level mutation) — the regular board-level
 *   mutation is NOT attempted.
 * - Otherwise the REGULAR path runs: read the column's settings + string
 *   revision, short-circuit if an ACTIVE label already matches the trimmed
 *   title case-insensitively (returns its id, no write), else send
 *   update_dropdown_column with the FULL label set (every existing label as
 *   { id, label, is_deactivated } — a partial set DELETES omitted labels) plus
 *   the new label without an id, at the fresh revision.
 * - SELF-HEALING FALLBACK: if the regular mutation is rejected with the
 *   managed-column discriminator — errorCode 'INVALID_ARGUMENT_EXCEPTION' and
 *   message containing 'notices.column.settings.update.error.structure' — the
 *   column is actually managed: resolve it via
 *   detectManagedDropdownColumnId(boardId, colId) — which reads the board
 *   column's labels from BOTH the typed settings and settings_str — and add via
 *   addManagedDropdownLabel. When detection finds nothing, the ORIGINAL error
 *   is rethrown. Any other error rethrows unchanged (funnel logs upstream).
 * - On success the module cache for this column is REFRESHED from the API and
 *   hook subscribers re-render, so open pickers see the new option.
 *
 * @param {{ boardKey: string, alias: string, title: string,
 *           managedColumnId?: string|null }} args
 * @returns {Promise<{ id: number|string|null, managedColumnId: string|null }>}
 *   `id` — the label's server-assigned id (or the existing one on duplicate;
 *   null only if it could not be resolved after a successful write).
 *   `managedColumnId` — the RESOLVED truth: the given hint, the UUID found by
 *   the self-heal fallback, or null for a regular column. Callers persist it
 *   when it differs from their stored hint.
 */
export async function addDropdownLabel({ boardKey, alias, title, managedColumnId = null }) {
  const name = String(title || '').trim();
  const boardId = getBoardId(boardKey) || null;
  const colId = getColumns(boardKey)?.[alias]?.id || null;
  if (!name || !boardId || !colId) throw new Error('addDropdownLabel: missing name/board/column');

  // Resolve the managed-column id up front from the settings-persisted hint when
  // the caller didn't pass one (new installs store it). If still unresolved the
  // regular board path runs below and, on a managed instance, self-heals via
  // DETECTION — so add-type also works where the hint was never persisted.
  let resolvedManagedId = managedColumnId || getColumns(boardKey)?.[alias]?.managedColumnId || null;

  if (resolvedManagedId) {
    const r = await addManagedDropdownLabel({ managedColumnId: resolvedManagedId, title: name });
    if (r?.duplicateId != null) return { id: r.duplicateId, managedColumnId: resolvedManagedId };
  } else {
    const { revision, labels } = await loadRawDropdown(boardId, colId);
    const existing = labels.find(
      (l) => !l.is_deactivated && (l.label ?? '').trim().toLowerCase() === name.toLowerCase()
    );
    if (existing) return { id: existing.id, managedColumnId: null };

    // Full-set resend: every existing label (incl. deactivated, flag preserved)
    // + the id-less new one — a partial set DELETES the omitted labels.
    const labelsInput = labels
      .map((l) => ({ id: l.id, label: l.label ?? '', is_deactivated: l.is_deactivated === true }))
      .concat([{ label: name, is_deactivated: false }]);

    try {
      const res = await api(
        `mutation ($boardId: ID!, $columnId: String!, $revision: String!, $s: UpdateDropdownColumnSettingsInput!) {
           update_dropdown_column(board_id: $boardId, id: $columnId, revision: $revision, settings: $s) { id }
         }`,
        { boardId: String(boardId), columnId: String(colId), revision: String(revision ?? ''), s: { labels: labelsInput } },
        'addDropdownLabel'
      );
      assertNoGraphQLErrors(res, { functionName: 'addDropdownLabel' });
    } catch (err) {
      // Self-heal: monday rejects board-level label edits on a column that is a
      // MANAGED-column instance with exactly this structure error. Resolve the
      // account-level column and add there instead; anything else rethrows.
      const isManagedStructure =
        err?.errorCode === 'INVALID_ARGUMENT_EXCEPTION' &&
        String(err?.message || '').includes('notices.column.settings.update.error.structure');
      if (!isManagedStructure) throw err;
      const uuid = await detectManagedDropdownColumnId(boardId, colId);
      if (!uuid) throw err;
      logger.warn('useDropdownOptions', 'dropdown column is managed — self-healed to the managed path', {
        boardKey, alias, colId, managedColumnId: uuid,
      });
      const r = await addManagedDropdownLabel({ managedColumnId: uuid, title: name });
      resolvedManagedId = uuid;
      if (r?.duplicateId != null) return { id: r.duplicateId, managedColumnId: uuid };
    }
  }

  // Post-write re-read (managed changes propagate to the board column): resolve
  // the server-assigned id, refresh the module cache, and notify mounted hooks.
  const fresh = await load(boardId, colId);
  cache.set(`${boardId}:${colId}`, fresh);
  notify();
  logger.info('useDropdownOptions', 'added dropdown label', { boardKey, alias, name, managed: !!resolvedManagedId });
  const added = fresh.options.find(
    (o) => (o.label ?? '').trim().toLowerCase() === name.toLowerCase()
  );
  return { id: added ? added.id : null, managedColumnId: resolvedManagedId };
}

// Raw column read for the WRITE path: unlike load(), keeps deactivated labels
// (they must be re-sent on update) and fetches the column's string revision.
async function loadRawDropdown(boardId, colId) {
  const data = await api(
    `query ($boardId: [ID!], $colIds: [String!]) {
       boards(ids: $boardId) { columns(ids: $colIds) { id settings revision } }
     }`,
    { boardId: [String(boardId)], colIds: [String(colId)] },
    'addDropdownLabel.read'
  );
  const col = data?.boards?.[0]?.columns?.[0];
  return {
    revision: col?.revision,
    labels: Array.isArray(col?.settings?.labels) ? col.settings.labels : [],
  };
}

export function useDropdownOptions(boardKey, alias) {
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
    if (!key) return undefined;
    if (cache.has(key)) { setState({ ...cache.get(key), loading: false }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    let p = inflight.get(key);
    if (!p) { p = load(boardId, colId).catch(() => ({ ...EMPTY })); inflight.set(key, p); }
    p.then((res) => {
      cache.set(key, res);
      inflight.delete(key);
      if (!cancelled) setState({ ...res, loading: false });
    }).catch((err) => {
      // p already resolves EMPTY on load failure; this guards the then-callback.
      logger.error('useDropdownOptions', 'options state update failed', err);
    });
    return () => { cancelled = true; };
  }, [key, boardId, colId]);

  // Re-read the cache when a label is added elsewhere (addDropdownLabel → notify),
  // so an open picker shows the new option without a remount.
  useEffect(() => {
    if (!key) return undefined;
    return subscribe(() => {
      if (cache.has(key)) setState({ ...cache.get(key), loading: false });
    });
  }, [key]);

  return state;
}

export default useDropdownOptions;
