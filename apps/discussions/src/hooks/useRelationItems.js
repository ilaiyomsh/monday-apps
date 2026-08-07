import { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/mondayApi/monday-client.js';
import { getBoardId, getColumns } from '../utils/mondayApi/board-config-store.js';
import logger from '../utils/logger.js';

/*
 * round368 §4 (owner request) — a CUSTOM `board_relation` column ("connected
 * board") added through the mapping screen is now EDITABLE in the task tables,
 * so the cell needs the candidate items of the board it connects to.
 *
 * Two facts drive the shape of this hook:
 *   1. The mapping stores only { id, type, title } for a custom column — the
 *      CONNECTED board id lives in monday's own `settings_str`
 *      (`{ boardIds: [...], allowMultipleItems }`), so it must be read from the
 *      API, not from settings. Reading it live also means an owner rewiring the
 *      monday column is picked up without touching the app's config.
 *   2. `BoardSDK` is bound to the app's OWN board keys (getBoardId), so an
 *      arbitrary connected board has to be queried with a raw items_page call.
 *
 * Cached per board+column (module level) so every row/cell shares one fetch.
 */

const cache = new Map();
const inflight = new Map();
const MODULE = 'useRelationItems';
const PAGE = 200;
const MAX_PAGES = 10; // 2,000 candidate items is far past any realistic picker

const keyOf = (boardKey, alias) => `${boardKey}::${alias}`;

/*
 * The connected-board settings of a relation column. Exported for tests: monday
 * returns EITHER the typed `settings` object (API 2025-10+) or the legacy
 * `settings_str` JSON, and a malformed string must degrade to "no board" rather
 * than throw inside a render path.
 */
export function parseRelationSettings(column) {
  const typed = column?.settings;
  const raw = column?.settings_str;
  let settings = null;
  if (typed && typeof typed === 'object') settings = typed;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      logger.warn(MODULE, 'settings_str של עמודת לוח מקושר אינו JSON תקין', err);
      return { boardIds: [], allowMultiple: true };
    }
  }
  // Filter BEFORE stringifying: `String(null)` is the truthy string 'null', so a
  // map-then-filter(Boolean) would smuggle junk ids into the query. Board id 0
  // is not a thing, but keeping "0" costs nothing and a value check is honest.
  const ids = Array.isArray(settings?.boardIds)
    ? settings.boardIds.filter((v) => v !== null && v !== undefined && v !== '').map(String)
    : [];
  // monday omits allowMultipleItems on single-item columns; absent ⇒ multi.
  const allowMultiple = settings?.allowMultipleItems !== false;
  return { boardIds: ids, allowMultiple };
}

/*
 * One candidate row of the picker. `group` is what lets the panel render monday's
 * grouped "Choose items" layout — section titles plus the per-item colour bar.
 * `Item.group` is NULLABLE in the schema (a subitem has none), so the group is
 * normalized to null rather than a half-filled object: the panel then puts the
 * item in its "ungrouped" section instead of rendering an empty title.
 */
export function toCandidate(item) {
  const g = item?.group;
  return {
    id: String(item?.id),
    name: item?.name || String(item?.id),
    group: g?.id
      ? { id: String(g.id), title: g.title || '', color: g.color || '' }
      : null,
  };
}

async function loadRelationItems(boardKey, alias) {
  const col = (getColumns(boardKey) || {})[alias];
  const hostBoardId = getBoardId(boardKey);
  if (!col?.id || !hostBoardId) return { items: [], boardName: '', allowMultiple: true, boardId: null };

  const settingsData = await api(
    `query ($boardId: [ID!], $colIds: [String!]) {
      boards(ids: $boardId) { columns(ids: $colIds) { id type settings settings_str } }
    }`,
    { boardId: [String(hostBoardId)], colIds: [String(col.id)] },
    'useRelationItems.settings'
  );
  const column = settingsData?.boards?.[0]?.columns?.[0];
  const { boardIds, allowMultiple } = parseRelationSettings(column);
  const linkedBoardId = boardIds[0] || null;
  if (!linkedBoardId) {
    logger.warn(MODULE, `לעמודת הקישור ${alias} אין לוח מקושר בהגדרות monday`);
    return { items: [], boardName: '', allowMultiple, boardId: null };
  }

  /*
   * Page 1 comes off the board (`items_page`); every continuation is the
   * TOP-LEVEL `next_items_page(cursor:)` — `items_page` takes no cursor
   * argument. Same split BoardSDK uses (BoardSDK.js:167-190), which is the
   * form verified against the live API.
   */
  const items = [];
  const first = await api(
    `query ($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        name
        items_page(limit: $limit) { cursor items { id name group { id title color } } }
      }
    }`,
    { boardId: String(linkedBoardId), limit: PAGE },
    'useRelationItems.items'
  );
  const boardName = first?.boards?.[0]?.name || '';
  let pageData = first?.boards?.[0]?.items_page;
  let page = 0;
  while (pageData) {
    for (const it of pageData.items || []) items.push(toCandidate(it));
    page += 1;
    if (!pageData.cursor || page >= MAX_PAGES) break;
    const next = await api(
      `query ($cursor: String!, $limit: Int!) {
        next_items_page(cursor: $cursor, limit: $limit) { cursor items { id name group { id title color } } }
      }`,
      { cursor: pageData.cursor, limit: PAGE },
      'useRelationItems.itemsNext'
    );
    pageData = next?.next_items_page || null;
  }

  /*
   * round378 — the candidates keep monday's BOARD order (group by group, position
   * within a group), because the picker now renders them grouped exactly like
   * monday's "Choose items" panel and a name-sort here would shuffle the sections.
   * Alphabetical is still reachable: the panel's own sort toggle applies it.
   */
  return { items, boardName, allowMultiple, boardId: String(linkedBoardId) };
}

/*
 * Returns { items: [{ id, name }], allowMultiple, loading }. Never throws: a
 * failed load resolves to an empty candidate list (the cell then still shows
 * and can CLEAR its links, it just cannot offer new ones) and logs once.
 */
export function useRelationItems(boardKey, alias) {
  const key = keyOf(boardKey, alias);
  const [state, setState] = useState(() => cache.get(key) || null);

  useEffect(() => {
    if (!boardKey || !alias) return undefined;
    let alive = true;
    const cached = cache.get(key);
    if (cached) { setState(cached); return undefined; }

    // Mirrors useDropdownOptions' loader shape: the shared promise resolves to an
    // EMPTY candidate list on failure (logged there), so the cell degrades to
    // "no options to offer" instead of breaking the row.
    let promise = inflight.get(key);
    if (!promise) {
      promise = loadRelationItems(boardKey, alias).catch((err) => {
        logger.error(MODULE, `טעינת הפריטים של עמודת הקישור ${alias} נכשלה`, err);
        return { items: [], boardName: '', allowMultiple: true, boardId: null };
      });
      inflight.set(key, promise);
    }
    promise.then((res) => {
      cache.set(key, res);
      inflight.delete(key);
      if (alive) setState(res);
    }).catch((err) => {
      // the shared promise already resolves EMPTY; this guards the callback above
      logger.error(MODULE, 'עדכון מצב פריטי הקישור נכשל', err);
    });
    return () => { alive = false; };
  }, [boardKey, alias, key]);

  /*
   * round370 §2 — MEMOIZED, and that is load-bearing, not tidiness. TaskTable's
   * per-column collector reports this value up through an effect keyed on it:
   *
   *   const rel = useRelationItems('tasks', alias);
   *   useEffect(() => { onItems(alias, rel); }, [alias, rel, onItems]);
   *
   * A fresh object literal per render made that effect fire on every render →
   * setState on the table → re-render → new object → forever. The tab froze with
   * nothing thrown and nothing logged (owner-reported: adding a custom relation
   * column "תוקע את כל המסך"). `useDropdownOptions` returns its state object
   * directly for exactly this reason, which is why dropdown columns never froze.
   * Note the `|| []` too: an unmemoized default would leak a new array each time
   * even if the wrapper were stable.
   */
  return useMemo(() => ({
    items: state?.items || [],
    boardName: state?.boardName || '',
    allowMultiple: state?.allowMultiple !== false,
    boardId: state?.boardId || null,
    loading: !state,
  }), [state]);
}

// Test/reset seam — the module cache would otherwise leak between test files.
export function __resetRelationItemsCache() {
  cache.clear();
  inflight.clear();
}

export default useRelationItems;
