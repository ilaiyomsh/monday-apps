/*
 * Real monday SDK — reimplements the Vibe-generated fluent Board API on top of
 * monday-sdk-js. All board/column knowledge comes from the active settings via
 * ./board-config-store.js; this file contains only generic query/format logic.
 *
 * Fluent surface used by the app:
 *   new XBoard().items().withColumns([...]).orderBy({column,direction})
 *               .withPagination({limit|cursor}).where({...}).execute()
 *   new XBoard().item(id?).create(payload).returnColumns([...]).execute()
 *   new XBoard().item(id).update(payload).execute()
 *   new XBoard().aggregate().groupBy(alias).countItems(name).execute()
 *   new XBoard().users.boardSubscribers().execute()
 */
import { getBoardId, getColumns } from './board-config-store.js';
import { api, parseValue, formatValue, sanitizeColumnValues, cvSelection, ensureUserPhotoSelection, normalizePhoto } from './monday-client.js';
import { getPeopleColumnIds } from './peopleColumns.js';

const DEFAULT_LIMIT = 25;

function colMap(boardKey) {
  return getColumns(boardKey);
}
function realColumnIds(boardKey) {
  return Object.values(colMap(boardKey))
    .map((c) => c?.id)
    .filter((id) => Boolean(id));
}

function mapItem(boardKey, it) {
  const cfg = colMap(boardKey);
  const byId = {};
  (it.column_values || []).forEach((cv) => { byId[cv.id] = cv; });
  const out = { id: String(it.id), name: it.name, created_at: it.created_at };
  if (it.group) out.group = { id: String(it.group.id), title: it.group.title };
  for (const alias in cfg) {
    const c = cfg[alias];
    if (!c?.id) continue;
    out[alias] = parseValue(c.type, byId[c.id]);
  }
  // Also expose LIVE people columns NOT covered by a mapped alias, keyed by raw
  // column id — permission roles for unmapped people columns (e.g. "רשם דיון")
  // read these. No-op until peopleColumns has loaded / for boards without any.
  const mappedIds = new Set(Object.values(cfg).map((c) => c?.id).filter(Boolean));
  for (const pid of getPeopleColumnIds(boardKey)) {
    if (mappedIds.has(pid)) continue;      // already exposed under its alias
    if (byId[pid] === undefined) continue; // not fetched on this item
    out[pid] = parseValue('people', byId[pid]);
  }
  return out;
}

/* ------------------------------------------------------------- items query */
class ItemsQueryBuilder {
  constructor(boardKey) {
    this.boardKey = boardKey;
    this._orderBy = null;
    this._where = {};
    this._limit = DEFAULT_LIMIT;
    this._cursor = null;
    this._columns = null; // when set, only these alias columns are fetched (lean)
    this._withGroup = false; // opt in to selecting `group { id title }` per item
  }
  withColumns(aliases) {
    this._columns = Array.isArray(aliases) && aliases.length ? aliases : null;
    return this;
  }
  // Opt in to selecting `group { id title }` on each item — off by default so
  // existing queries stay lean. Used by the "My Tasks" board-group grouping.
  withGroup(on = true) { this._withGroup = !!on; return this; }
  orderBy(o) { this._orderBy = o; return this; }
  where(w) { this._where = w || {}; return this; }
  withPagination(p = {}) {
    if (p.limit != null) this._limit = p.limit;
    if (p.cursor != null) this._cursor = p.cursor;
    return this;
  }

  _buildQueryParams() {
    const cfg = colMap(this.boardKey);
    const rules = [];
    let nameSearch = null;
    const postFilters = [];

    for (const [alias, cond] of Object.entries(this._where)) {
      if (alias === 'name') { nameSearch = String(cond); continue; }
      const c = cfg[alias];
      if (!c?.id) continue;
      // NOTE: board_relation is intentionally NOT filtered server-side here.
      // monday query_params on a board_relation column match by item NAME, not
      // id, so it does not work. Relations are read from the discussion side.
      if (cond && typeof cond === 'object' && Array.isArray(cond.between)) {
        rules.push({ column_id: c.id, compare_value: cond.between, operator: 'between' });
      } else if (c.type === 'dropdown') {
        // Dropdown filters server-side via any_of on NUMERIC label ids (monday's
        // documented ID-based operator — exact match, unlike contains_text which
        // is a partial/substring match). Callers pass the dropdown label id(s);
        // NaN guard drops bad ids rather than sending null. (Mirrors the status
        // branch below — dropdown and status share the same any_of-by-id shape.)
        const arr = Array.isArray(cond) ? cond : [cond];
        const compare = arr.map((v) => Number(v)).filter((n) => Number.isFinite(n));
        if (compare.length) rules.push({ column_id: c.id, compare_value: compare, operator: 'any_of' });
      } else if (c.type === 'people') {
        // monday's any_of on a people column does NOT match a bare user id — it
        // expects the "person-<id>" form (verified against the live API). The
        // keyword "assigned_to_me" is passed through untouched.
        const arr = Array.isArray(cond) ? cond : [cond];
        const compare = arr.map((v) =>
          String(v) === 'assigned_to_me' ? 'assigned_to_me' : `person-${v}`
        );
        rules.push({ column_id: c.id, compare_value: compare, operator: 'any_of' });
      } else if (c.type === 'status') {
        // status any_of compares against the NUMERIC label index — monday
        // silently returns ZERO matches if compare_value is a string (verified
        // live: ["1"] → 0 items, [1] → matches). The label id from
        // useStatusOptions IS that index. NaN guard drops bad ids rather than
        // sending null.
        const arr = Array.isArray(cond) ? cond : [cond];
        const compare = arr.map((v) => Number(v)).filter((n) => Number.isFinite(n));
        if (compare.length) rules.push({ column_id: c.id, compare_value: compare, operator: 'any_of' });
      } else {
        rules.push({ column_id: c.id, compare_value: [String(cond)], operator: 'any_of' });
      }
    }

    const qp = {};
    if (rules.length) qp.rules = rules;
    if (this._orderBy) {
      const oc = cfg[this._orderBy.column];
      if (oc?.id) qp.order_by = [{ column_id: oc.id, direction: this._orderBy.direction || 'desc' }];
    }
    return { qp, nameSearch, postFilters };
  }

  async execute() {
    const boardId = getBoardId(this.boardKey);
    const cfg = colMap(this.boardKey);
    // Fetch only the requested columns (plus any used in where-filters), or all
    // configured columns when withColumns() wasn't called. Keeps queries light.
    const aliasSet = this._columns
      ? new Set([...this._columns, ...Object.keys(this._where).filter((a) => a !== 'name')])
      : new Set(Object.keys(cfg));
    const cols = [...aliasSet].map((a) => cfg[a]).filter((c) => c?.id);
    // Always also fetch the board's LIVE people columns (for permission roles on
    // people columns that aren't a mapped alias). Deduped against configured ids.
    const baseIds = cols.map((c) => c.id);
    const extraPeopleIds = getPeopleColumnIds(this.boardKey).filter((pid) => !baseIds.includes(pid));
    const ids = [...baseIds, ...extraPeopleIds];
    const cv = cvSelection([...cols.map((c) => c.type), ...(extraPeopleIds.length ? ['people'] : [])]);
    const groupSel = this._withGroup ? ' group { id title }' : '';
    let page;

    if (this._cursor) {
      const data = await api(
        `query ($cursor: String!, $limit: Int!, $ids: [String!]) {
           next_items_page(cursor: $cursor, limit: $limit) {
             cursor items { id name created_at${groupSel} column_values(ids: $ids) { ${cv} } }
           }
         }`,
        { cursor: this._cursor, limit: this._limit, ids }
      );
      page = data.next_items_page;
    } else {
      const { qp } = this._buildQueryParams();
      const data = await api(
        `query ($boardId: ID!, $limit: Int!, $qp: ItemsQuery, $ids: [String!]) {
           boards(ids: [$boardId]) {
             items_page(limit: $limit, query_params: $qp) {
               cursor items { id name created_at${groupSel} column_values(ids: $ids) { ${cv} } }
             }
           }
         }`,
        { boardId, limit: this._limit, qp, ids }
      );
      page = data.boards?.[0]?.items_page;
    }

    let items = (page?.items || []).map((it) => mapItem(this.boardKey, it));
    // client-side filters that monday query_params can't express cleanly
    const { nameSearch, postFilters } = this._buildQueryParams();
    if (nameSearch) {
      const s = nameSearch.toLowerCase();
      items = items.filter((it) => (it.name || '').toLowerCase().includes(s));
    }
    postFilters.forEach((f) => { items = items.filter(f); });

    return { items, cursor: page?.cursor || null };
  }
}

/* ---------------------------------------------------------------- mutations */
class ItemMutationBuilder {
  constructor(boardKey, itemId) {
    this.boardKey = boardKey;
    this.itemId = itemId;
    this._op = null;
    this._payload = {};
    this._opts = {};
  }
  // opts.createLabelsIfMissing → forwards monday's create_labels_if_missing, so a
  // status/dropdown value written by TEXT that has no matching label is created
  // on the fly rather than silently dropped. Off by default — enable only for the
  // specific write that needs it, to avoid minting stray labels elsewhere.
  create(payload, opts = {}) { this._op = 'create'; this._payload = payload || {}; this._opts = opts || {}; return this; }
  update(payload, opts = {}) { this._op = 'update'; this._payload = payload || {}; this._opts = opts || {}; return this; }
  returnColumns() { return this; }

  _buildColumnValues() {
    const cfg = colMap(this.boardKey);
    const cols = {};
    for (const [alias, value] of Object.entries(this._payload)) {
      if (alias === 'name') continue;
      const c = cfg[alias];
      if (!c?.id) continue;
      const f = formatValue(c.type, value);
      if (f !== undefined) cols[c.id] = f;
    }
    // Single systemic guard: strip invalid/empty entries (e.g. a null inside a
    // board_relation's item_ids, a person with no id) that monday would reject
    // with a ColumnValueException. Protects EVERY create_item / update write that
    // goes through the SDK, without altering valid payloads. See monday-client.js.
    return sanitizeColumnValues(cols);
  }

  async execute() {
    const boardId = getBoardId(this.boardKey);
    const cols = this._buildColumnValues();
    const clim = !!this._opts.createLabelsIfMissing;

    if (this._op === 'create') {
      const data = await api(
        `mutation ($boardId: ID!, $name: String!, $cols: JSON!, $clim: Boolean) {
           create_item(board_id: $boardId, item_name: $name, column_values: $cols, create_labels_if_missing: $clim) { id }
         }`,
        { boardId, name: this._payload.name || '', cols: JSON.stringify(cols), clim }
      );
      return { id: String(data.create_item.id) };
    }

    // update — monday's change_multiple_column_values also renames the item when
    // the column_values JSON carries a "name" key (handled separately from the
    // aliased columns, which _buildColumnValues deliberately skips for 'name').
    if (this._payload.name != null) cols.name = this._payload.name;
    const data = await api(
      `mutation ($boardId: ID!, $itemId: ID!, $cols: JSON!, $clim: Boolean) {
         change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cols, create_labels_if_missing: $clim) { id }
       }`,
      { boardId, itemId: String(this.itemId), cols: JSON.stringify(cols), clim }
    );
    return { id: String(data.change_multiple_column_values.id) };
  }
}

/* --------------------------------------------------------------- aggregate */
class AggregateBuilder {
  constructor(boardKey) {
    this.boardKey = boardKey;
    this._groupBy = null;
    this._countName = 'count';
  }
  groupBy(alias) { this._groupBy = alias; return this; }
  countItems(name) { this._countName = name || 'count'; return this; }

  async execute() {
    const cfg = colMap(this.boardKey);
    const c = cfg[this._groupBy];
    if (!c) return [];
    const boardId = getBoardId(this.boardKey);

    const groups = {};
    let cursor = null;
    let guard = 0;
    do {
      const q = new ItemsQueryBuilder(this.boardKey);
      q._limit = 100;
      q._cursor = cursor;
      q._columns = [this._groupBy]; // aggregate only needs the grouped column
      const res = await q.execute();
      for (const it of res.items) {
        const v = it[this._groupBy];
        if (v == null || v === '') continue;
        groups[v] = (groups[v] || 0) + 1;
      }
      cursor = res.cursor;
      guard += 1;
    } while (cursor && guard < 20);

    return Object.entries(groups).map(([k, n]) => ({
      [this._groupBy]: k,
      [this._countName]: n,
    }));
  }
}

/* ------------------------------------------------------------- subscribers */
function makeUsers(boardKey) {
  return {
    boardSubscribers() {
      return {
        async execute() {
          const boardId = getBoardId(boardKey);
          const photo = await ensureUserPhotoSelection();
          const data = await api(
            `query ($boardId: [ID!]) {
               boards(ids: $boardId) { subscribers { id name ${photo} } }
             }`,
            { boardId: [boardId] },
            'boardSubscribers'
          );
          return (data.boards?.[0]?.subscribers || []).map((u) => ({
            id: String(u.id),
            name: u.name,
            photo_thumb: normalizePhoto(u),
          }));
        },
      };
    },

    // All users in the account (not just this board's subscribers) — so the
    // people picker can find everyone, matching monday's native picker. Routed
    // through api() with a fnName so safeApi logs the request + response.
    accountUsers() {
      return {
        async execute() {
          const photo = await ensureUserPhotoSelection();
          const data = await api(
            `query { users (limit: 500) { id name ${photo} } }`,
            {},
            'accountUsers'
          );
          return (data.users || []).map((u) => ({
            id: String(u.id),
            name: u.name,
            photo_thumb: normalizePhoto(u),
          }));
        },
      };
    },
  };
}

/* ------------------------------------------------------------- board class */
class BoardBase {
  constructor(boardKey) {
    this.boardKey = boardKey;
    this.users = makeUsers(boardKey);
  }
  items() { return new ItemsQueryBuilder(this.boardKey); }
  item(id) { return new ItemMutationBuilder(this.boardKey, id); }
  aggregate() { return new AggregateBuilder(this.boardKey); }

  // Fetch ONE item by id with ALL configured columns deserialized (the lean list
  // query only pulls a couple of columns; this is the "click pulls the rest" read
  // used by the card header, the edit/duplicate prefill, and the docx export).
  async itemById(id) {
    if (!id) return null;
    const cols = Object.values(colMap(this.boardKey)).filter((c) => c?.id);
    const colIds = cols.map((c) => c.id);
    const cv = cvSelection(cols.map((c) => c.type));
    const data = await api(
      `query ($ids: [ID!], $colIds: [String!]) {
         items(ids: $ids) { id name column_values(ids: $colIds) { ${cv} } }
       }`,
      { ids: [String(id)], colIds },
      `${this.boardKey}.itemById`
    );
    const it = data?.items?.[0];
    return it ? mapItem(this.boardKey, it) : null;
  }
}

export class דיונים1Board extends BoardBase {
  constructor() { super('discussions'); }
}
export class משימות1Board extends BoardBase {
  constructor() { super('tasks'); }
}
export class נושאיםלדיון1Board extends BoardBase {
  constructor() { super('topics'); }
}
export class החלטות1Board extends BoardBase {
  constructor() { super('decisions'); }
}
