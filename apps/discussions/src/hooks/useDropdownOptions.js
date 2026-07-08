import { useEffect, useState } from 'react';
import { api } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';

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

  return state;
}

export default useDropdownOptions;
