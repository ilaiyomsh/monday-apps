import { useEffect, useState } from 'react';
import { api } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import { addManagedDropdownLabel } from '../utils/mondayApi/managedColumns.js';
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
  try { s = JSON.parse(settingsStr || '{}'); } catch { return []; }
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
    });
    return () => { cancelled = true; };
  }, [key, boardId, colId]);

  // Re-read the cache when a label is added elsewhere (addDropdownLabel → notify).
  useEffect(() => {
    if (!key) return undefined;
    return subscribe(() => {
      if (cache.has(key)) setState({ ...cache.get(key), loading: false });
    });
  }, [key]);

  return state;
}

/**
 * Add a NEW label to a DROPDOWN column, then re-load the column, refresh the
 * module cache, notify subscribers (so the live picker updates), and return the
 * new label's server-assigned id (or null if it couldn't be resolved).
 *
 * The label is created on the account-level MANAGED DROPDOWN backing the column
 * (`update_dropdown_managed_column` via addManagedDropdownLabel); the change
 * propagates to the board column instancing it. `managedColumnId` is REQUIRED —
 * a plain/locked dropdown has no managed backing, so the caller
 * (CreateDiscussionModal) keeps its app-side-only fallback for that case instead
 * of calling here. Mirrors useStatusOptions.addStatusLabel's reload+notify shape.
 *
 * @param {{ boardKey: string, alias: string, title: string, managedColumnId?: string|null }} args
 */
export async function addDropdownLabel({ boardKey, alias, title, managedColumnId = null }) {
  const name = String(title || '').trim();
  const boardId = getBoardId(boardKey) || null;
  const colId = getColumns(boardKey)?.[alias]?.id || null;
  if (!name || !boardId || !colId) {
    throw new Error('addDropdownLabel: missing name/board/column');
  }
  if (!managedColumnId) {
    throw new Error('addDropdownLabel: missing managedColumnId (no managed dropdown backing)');
  }

  await addManagedDropdownLabel({ managedColumnId, title: name });

  // Re-load the board column so we pick up the server-assigned id (the managed
  // change propagates to the board column), then refresh cache + notify.
  const key = `${boardId}:${colId}`;
  const prevIds = new Set((cache.get(key)?.options || []).map((o) => o.id));
  const fresh = await load(boardId, colId);
  cache.set(key, fresh);
  notify();

  logger.info('useDropdownOptions', 'added dropdown label', { boardKey, alias, name, managed: !!managedColumnId });
  const added = fresh.options.find(
    (o) => (o.label ?? '').trim().toLowerCase() === name.toLowerCase() && !prevIds.has(o.id)
  ) || fresh.options.find((o) => (o.label ?? '').trim().toLowerCase() === name.toLowerCase());
  return added ? added.id : null;
}

export default useDropdownOptions;
