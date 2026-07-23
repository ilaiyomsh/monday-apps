/*
 * peopleColumns — a small in-memory cache of the LIVE people columns on the
 * discussions & tasks boards ({ id, title }). Permission "roles" are one per
 * people column, derived dynamically from the real board (not the fixed alias
 * schema) so a column added on the board — e.g. "רשם דיון" — shows up as a role
 * automatically. See docs/sdk-instance-contexts.md / the permissions design.
 *
 * Module-level singleton (like board-config-store / usersStore) with a
 * subscribe()/getVersion() pair so React re-renders via useSyncExternalStore
 * when the columns load. Loaded ONCE per session (deduped) via ensurePeopleColumns().
 */
import { api } from './monday-client.js';
import { getBoardId, getColumns } from './board-config-store.js';
import logger from '../logger.js';

// Boards whose people columns become permission role-sources.
const ROLE_BOARDS = ['discussions', 'tasks'];
const PEOPLE_TYPES = new Set(['people', 'person', 'multiple_person']);

const cache = { discussions: [], tasks: [] }; // boardKey -> [{ id, title }] (people only)
// ALL columns per board ({ id, title, type }) — powers getColumnTitle for ANY
// column type (date/status/board_relation/…), not just the people role columns.
const allColumns = { discussions: [], tasks: [] };
let loaded = false;
let inFlight = null;
let version = 0;
const listeners = new Set();

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

// ---- React glue (useSyncExternalStore) ----
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getVersion() {
  return version;
}

// ---- reads (synchronous, from memory) ----
/** Live people columns for a board: [{ id, title }] (empty until loaded). */
export function getPeopleColumns(boardKey) {
  return cache[boardKey] || [];
}

/** Just the column ids for a board (empty until loaded). */
export function getPeopleColumnIds(boardKey) {
  return (cache[boardKey] || []).map((c) => c.id);
}

/**
 * The LIVE board title for a mapped alias (ANY column type), resolved alias →
 * column id (from the active config) → title (from the cached live columns).
 * Labels shown in the app (header, create modal) must use the board's own
 * column title, NOT the schema
 * title (which is Settings-only). Returns null until the live columns load or if
 * the alias isn't mapped, so callers can fall back to the schema title.
 */
export function getColumnTitle(boardKey, alias) {
  const colId = getColumns(boardKey)?.[alias]?.id;
  if (!colId) return null;
  const found = (allColumns[boardKey] || []).find((c) => c.id === String(colId));
  return found?.title || null;
}

/**
 * Whether an alias is MAPPED to a real board column in the active config (its
 * stored mapping carries an `id`). Synchronous, from the published settings —
 * unlike getColumnTitle it does NOT need the live columns to have loaded. Used
 * to drive column-conditional UI (e.g. the "מרכז דיון" role appears only when
 * that column is mapped — round219, replacing the old permissions.noCoordinator
 * switch).
 */
export function isColumnMapped(boardKey, alias) {
  return !!getColumns(boardKey)?.[alias]?.id;
}

// ---- load (once, deduped) ----
/**
 * Fetch the discussions + tasks boards' columns and cache the people ones.
 * No-op (silent) if board ids aren't mapped yet or the API fails — callers get
 * an empty list and the feature degrades to the mapped-alias behavior.
 */
export function ensurePeopleColumns() {
  if (loaded) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  const ids = ROLE_BOARDS
    .map((bk) => ({ bk, id: getBoardId(bk) }))
    .filter((x) => x.id);
  if (!ids.length) return Promise.resolve(cache); // config not published yet

  inFlight = (async () => {
    try {
      const data = await api(
        `query ($ids: [ID!]) { boards(ids: $ids) { id columns { id title type } } }`,
        { ids: ids.map((x) => String(x.id)) },
        'ensurePeopleColumns'
      );
      const byBoardId = {};
      (data?.boards || []).forEach((b) => { byBoardId[String(b.id)] = b.columns || []; });
      for (const { bk, id } of ids) {
        const cols = byBoardId[String(id)] || [];
        allColumns[bk] = cols.map((c) => ({
          id: String(c.id), title: c.title || String(c.id), type: String(c.type),
        }));
        cache[bk] = allColumns[bk].filter((c) => PEOPLE_TYPES.has(c.type));
      }
      loaded = true;
      logger.info('peopleColumns', 'loaded live people columns', {
        discussions: cache.discussions.length, tasks: cache.tasks.length,
      });
      emit();
    } catch (err) {
      logger.warn('peopleColumns', 'failed to load people columns', err);
    } finally {
      inFlight = null;
    }
    return cache;
  })();
  return inFlight;
}
