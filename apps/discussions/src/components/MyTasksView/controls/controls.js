/*
 * Pure config + client-side helpers for the "My Tasks" monday-style builder
 * controls (Sort / Filter / Group). NO React here — unit-tested in controls.test.js.
 *
 * The panels read like a sentence: pick a COLUMN, then a CONDITION. Everything
 * below is the ENGLISH structural chrome (option labels, operators). COLUMN
 * display names are board-derived (Hebrew) and resolved at render time, not here.
 *
 * All sorting/filtering runs CLIENT-SIDE over the already-loaded tasks page
 * (see MyTasksView's filter -> sort -> group pipeline), so these are plain
 * in-memory array ops — instant, no re-fetch.
 *
 * Task shape (from useMyTasks/mapItem):
 *   { id, name, deadlineID: Date|null, statusID: labelId|null,
 *     priorityID: labelId|null, discussionLinkID, ... }
 */

// Shared 4 ordering options for the two status-type columns (status + priority),
// reused by BOTH sort directions and group orders. The two "Label order" entries
// are distinguished by their up/down icon (monday's asc/desc idiom).
export const STATUS_DIRS = [
  { key: 'labelAsc', label: 'סדר לייבלים', icon: 'up' },
  { key: 'labelDesc', label: 'סדר לייבלים', icon: 'down' },
  { key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' },
  { key: 'azDesc', label: 'ת → א', icon: 'alphaDesc' },
];

// SORT — column -> ordered direction options. `type` picks the column icon.
export const SORT_COLUMNS = [
  { key: 'priority', type: 'status', alias: 'priorityID', dirs: STATUS_DIRS },
  {
    key: 'deadline', type: 'date', alias: 'deadlineID',
    dirs: [
      { key: 'deadlineAsc', label: 'מהמוקדם למאוחר', icon: 'calUp' },
      { key: 'deadlineDesc', label: 'מהמאוחר למוקדם', icon: 'calDown' },
    ],
    note: 'משימות ללא דד ליין תמיד ממוינות אחרונות',
  },
  { key: 'status', type: 'status', alias: 'statusID', dirs: STATUS_DIRS },
  {
    key: 'name', type: 'text',
    dirs: [
      { key: 'nameAsc', label: 'א → ת', icon: 'alphaAsc' },
      { key: 'nameDesc', label: 'ת → א', icon: 'alphaDesc' },
    ],
  },
];

// GROUP — round224 (owner mockup, approved): ONE flat pick — status (the
// default) / person (אחריות) / priority / discussion — and the order is ALWAYS
// top-down by label order (labelAsc for the status-shaped columns, Hebrew A→Z
// for people, date-desc for discussions), so the panel offers no order picker.
// `orders` keeps a single pinned entry per column (the group state still stores
// { col, order }, saved views stay shape-compatible).
export const GROUP_COLUMNS = [
  { key: 'status', type: 'status', orders: [{ key: 'labelAsc', label: 'סדר לייבלים', icon: 'up' }] },
  { key: 'person', type: 'person', orders: [{ key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' }] },
  { key: 'priority', type: 'status', orders: [{ key: 'labelAsc', label: 'סדר לייבלים', icon: 'up' }] },
  {
    key: 'discussion', type: 'relation',
    orders: [{ key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' }],
  },
];

// FILTER — filterable columns + their operators. status/priority take a value
// list; deadline takes within (quick ranges) / before / after (a specific date).
export const FILTER_COLUMNS = [
  { key: 'status', type: 'status', alias: 'statusID', ops: ['is', 'isnot'] },
  { key: 'priority', type: 'status', alias: 'priorityID', ops: ['is', 'isnot'] },
  { key: 'deadline', type: 'date', alias: 'deadlineID', ops: ['within', 'before', 'after'] },
];

// People/assignee filter column. NOT used by My Tasks (already scoped to the
// current user) — consumed by the Previous-tasks tab, which carries a
// responsibilityID people array per task. Value list = is / is not a person id.
export const FILTER_COLUMN_PERSON = { key: 'person', type: 'person', alias: 'responsibilityID', ops: ['is', 'isnot'] };

export const OP_LABEL = {
  is: 'הוא', isnot: 'אינו',
  within: 'בטווח', before: 'לפני', after: 'אחרי',
  // round366 — free-text custom columns filter by "contains".
  contains: 'מכיל',
};

export const DEADLINE_RANGES = [
  { key: 'today', label: 'היום', icon: 'calToday' },
  { key: 'thisWeek', label: 'השבוע', icon: 'calWeek' },
  { key: 'thisMonth', label: 'החודש', icon: 'calMonth' },
  { key: 'overdue', label: 'באיחור', icon: 'clock' },
];

// Defaults are EMPTY (no sort, no grouping): every table starts with nothing
// selected unless a shared saved view (settings.preferences.savedViews) exists.
// An empty sort has NO column either — the panel shows a "Choose a column"
// placeholder, exactly like the group panel's none state.
export const DEFAULT_SORT = { col: null, dir: null, active: false };
// round224 — the DEFAULT grouping is STATUS, top-down (owner spec); a shared
// saved view still overrides it.
export const DEFAULT_GROUP = { col: 'status', order: 'labelAsc' };

// ---------------------------------------------------------------- sort -----

function rankBy(orderById, v) {
  const r = v != null && v !== '' && orderById[v] != null ? orderById[v] : undefined;
  return r == null ? Infinity : r;
}
function labelOf(labelById, v) {
  return v != null && v !== '' && labelById[v] != null ? labelById[v] : '';
}
// Hebrew-collated text compare with empty/no-value pushed LAST (both directions).
function cmpTextNoValueLast(la, lb, dir) {
  const ea = !la, eb = !lb;
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  return la.localeCompare(lb, 'he') * dir;
}

/*
 * sortTasks(list, sort, maps) — returns a sorted COPY (or the original list when
 * inactive). `sort` = { col, dir, active }. `maps` carries the status maps:
 *   { orderById, labelById, priorityOrderById, priorityLabelById }
 */
export function sortTasks(list, sort, maps = {}) {
  if (!sort || !sort.active || !sort.col || !sort.dir) return list;
  const arr = [...list];
  const { col, dir } = sort;

  if (col === 'deadline') {
    const d = dir === 'deadlineDesc' ? -1 : 1;
    arr.sort((a, b) => {
      const ta = a.deadlineID instanceof Date ? a.deadlineID.getTime() : null;
      const tb = b.deadlineID instanceof Date ? b.deadlineID.getTime() : null;
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1; // no deadline always last
      if (tb == null) return -1;
      return (ta - tb) * d;
    });
    return arr;
  }

  if (col === 'name') {
    const d = dir === 'nameDesc' ? -1 : 1;
    arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he') * d);
    return arr;
  }

  // status-type column (status | priority)
  const alias = col === 'status' ? 'statusID' : 'priorityID';
  const orderById = col === 'status' ? maps.orderById || {} : maps.priorityOrderById || {};
  const labelById = col === 'status' ? maps.labelById || {} : maps.priorityLabelById || {};

  if (dir === 'azAsc' || dir === 'azDesc') {
    const d = dir === 'azDesc' ? -1 : 1;
    arr.sort((a, b) => cmpTextNoValueLast(labelOf(labelById, a[alias]), labelOf(labelById, b[alias]), d));
    return arr;
  }

  // labelAsc / labelDesc — by display rank, no-value always last
  const d = dir === 'labelDesc' ? -1 : 1;
  arr.sort((a, b) => {
    const ra = rankBy(orderById, a[alias]);
    const rb = rankBy(orderById, b[alias]);
    if (ra === Infinity && rb === Infinity) return 0;
    if (ra === Infinity) return 1;
    if (rb === Infinity) return -1;
    return (ra - rb) * d;
  });
  return arr;
}

// --------------------------------------------------------------- filter ----

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// Current week = Sunday..Saturday (Hebrew locale week start).
function weekRange(now) {
  const start = startOfDay(now);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday
  const end = endOfDay(start);
  end.setDate(start.getDate() + 6);
  return [start, end];
}

export function colFilterActive(c) {
  return !!(c && c.values && c.values.size > 0);
}
export function deadlineFilterActive(d) {
  if (!d) return false;
  if (d.op === 'within') return !!d.range;
  if (d.op === 'before' || d.op === 'after') return !!d.date;
  return false;
}
function matchStatusCol(c, v) {
  const has = c.values.has(String(v));
  return c.op === 'isnot' ? !has : has;
}
// People column: task value is an array of { id, name }. "is" = task has ANY of
// the selected people; "is not" = task has NONE of them.
function matchPersonCol(c, people) {
  const ids = (Array.isArray(people) ? people : []).map((p) => String(p && p.id != null ? p.id : p));
  const hit = ids.some((id) => c.values.has(id));
  return c.op === 'isnot' ? !hit : hit;
}
/*
 * round366 — CUSTOM column dimensions (owner-added `custom<N>ID` mappings on
 * the tasks board) join the filter as typed dimensions. A dim is
 * { key: alias, control: 'person'|'values'|'date'|'text', title } — `control`
 * decides the state shape, the editor UI and the predicate. `file` customs are
 * not filterable (their value is an asset URL string).
 */
export function customFilterDims(customCols) {
  return (customCols || []).map((c) => {
    const t = c.type;
    /*
     * round372 — a custom STATUS column filters as a value set, exactly like a
     * dropdown. What differs is the value's SHAPE: parseValue gives a status its
     * stable label ID (a number, and 0 is a real label), not the label text, so the
     * option list must resolve ids → text via the column's status labels. The
     * comparison itself needs no special case — customComparableValues stringifies
     * the id and the Set holds id strings. 'color' is monday's legacy name for the
     * same column type and is grouped with it in the mapping screen.
     */
    const control = (t === 'people' || t === 'person' || t === 'multiple_person') ? 'person'
      : t === 'date' ? 'date'
        : (t === 'status' || t === 'color'
          || t === 'dropdown' || t === 'board_relation' || t === 'connect_boards') ? 'values'
          : (t === 'text' || t === 'long_text') ? 'text'
            : null;
    return control ? { key: c.alias, control, title: c.title || c.alias } : null;
  }).filter(Boolean);
}

// A fresh pristine state per CONTROL type (shared with useFilterBuilder's resetCol).
export function pristineFilterCol(control) {
  if (control === 'date') return { op: 'within', range: null, date: null };
  if (control === 'text') return { op: 'contains', text: '' };
  return { op: 'is', values: new Set() };
}

function textFilterActive(c) {
  return !!String(c?.text || '').trim();
}
// Free-text contains (trimmed, case-insensitive — Hebrew is unaffected, Latin benefits).
function matchTextCol(c, v) {
  const needle = String(c.text || '').trim().toLowerCase();
  return String(v ?? '').toLowerCase().includes(needle);
}
// A custom "values" column's comparable values: a board_relation contributes its
// linked item NAMES; a dropdown's parsed value is the label text (multi-label
// arrives comma-joined from monday).
export function customComparableValues(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw?.linkedItems)) return raw.linkedItems.map((it) => String(it?.name ?? ''));
  return String(raw).split(', ').map((s) => s.trim()).filter(Boolean);
}
function matchValuesCol(c, raw) {
  const hit = customComparableValues(raw).some((v) => c.values.has(v));
  return c.op === 'isnot' ? !hit : hit;
}

function customDimActive(control, c) {
  if (!c) return false;
  if (control === 'date') return deadlineFilterActive(c);
  if (control === 'text') return textFilterActive(c);
  return colFilterActive(c);
}
function matchCustomDim(control, c, raw, now) {
  if (control === 'person') return matchPersonCol(c, raw);
  if (control === 'date') return matchDeadline(c, raw, now);
  if (control === 'text') return matchTextCol(c, raw);
  return matchValuesCol(c, raw);
}

function matchDeadline(d, val, now) {
  const dt = val instanceof Date ? val : null;
  if (d.op === 'before') return dt ? dt.getTime() < startOfDay(d.date).getTime() : false;
  if (d.op === 'after') return dt ? dt.getTime() > endOfDay(d.date).getTime() : false;
  if (d.op === 'within') {
    if (!dt) return false;
    if (d.range === 'today') return sameDay(dt, now);
    if (d.range === 'overdue') return dt.getTime() < startOfDay(now).getTime();
    if (d.range === 'thisMonth') return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    if (d.range === 'thisWeek') {
      const [s, e] = weekRange(now);
      return dt.getTime() >= s.getTime() && dt.getTime() <= e.getTime();
    }
  }
  return false;
}

/*
 * filterTasks(list, filter, opts) — AND across columns; multi-value = OR within
 * a status column. `filter` = {
 *   status:   { op:'is'|'isnot', values:Set<string> },
 *   priority: { op:'is'|'isnot', values:Set<string> },
 *   deadline: { op:'within'|'before'|'after', range, date:Date },
 * }
 * opts.now lets tests pin "today".
 */
export function filterTasks(list, filter, opts = {}) {
  if (!filter) return list;
  const now = opts.now || new Date();
  // round366 — opts.custom: typed custom dims ([{key, control}]); the task's
  // value lives directly under the alias key.
  const custom = (opts.custom || []).filter((dim) => customDimActive(dim.control, filter[dim.key]));
  const s = colFilterActive(filter.status);
  const p = colFilterActive(filter.priority);
  const pr = colFilterActive(filter.person);
  const d = deadlineFilterActive(filter.deadline);
  if (!s && !p && !pr && !d && custom.length === 0) return list;
  return list.filter((tk) => {
    if (s && !matchStatusCol(filter.status, tk.statusID)) return false;
    if (p && !matchStatusCol(filter.priority, tk.priorityID)) return false;
    if (pr && !matchPersonCol(filter.person, tk.responsibilityID)) return false;
    if (d && !matchDeadline(filter.deadline, tk.deadlineID, now)) return false;
    for (const dim of custom) {
      if (!matchCustomDim(dim.control, filter[dim.key], tk[dim.key], now)) return false;
    }
    return true;
  });
}

// Active-value count for the toolbar pill badge ("/ N").
export function filterCount(filter, customDims = []) {
  if (!filter) return 0;
  let n = 0;
  if (colFilterActive(filter.status)) n += filter.status.values.size;
  if (colFilterActive(filter.priority)) n += filter.priority.values.size;
  if (colFilterActive(filter.person)) n += filter.person.values.size;
  if (deadlineFilterActive(filter.deadline)) n += 1;
  for (const dim of customDims) {
    const c = filter[dim.key];
    if (!customDimActive(dim.control, c)) continue;
    n += dim.control === 'date' || dim.control === 'text' ? 1 : c.values.size;
  }
  return n;
}

// A fresh, empty filter (one Set per status column + a default deadline row off).
// round366 — customDims seed their own pristine keys beside the fixed four.
export function emptyFilter(customDims = []) {
  const out = {
    status: { op: 'is', values: new Set() },
    priority: { op: 'is', values: new Set() },
    person: { op: 'is', values: new Set() },
    deadline: { op: 'within', range: null, date: null },
  };
  for (const dim of customDims) out[dim.key] = pristineFilterCol(dim.control);
  return out;
}

// ------------------------------------------------- saved-view (de)serialize --
// The live filter holds Sets and a Date, which don't survive JSON storage
// (settings.preferences.savedViews). Serialize to plain arrays + ISO string;
// deserialize defensively back to the live shape (garbage → empty filter).

export function serializeFilter(filter, customDims = []) {
  const f = filter || emptyFilter(customDims);
  const col = (c) => ({ op: c?.op || 'is', values: [...(c?.values || [])] });
  const dateCol = (d = {}) => ({
    op: d.op || 'within',
    range: d.range || null,
    date: d.date instanceof Date ? d.date.toISOString() : null,
  });
  const out = {
    status: col(f.status),
    priority: col(f.priority),
    person: col(f.person),
    deadline: dateCol(f.deadline),
  };
  // round366 — custom dims round-trip by their control shape.
  for (const dim of customDims) {
    const c = f[dim.key];
    out[dim.key] = dim.control === 'date' ? dateCol(c)
      : dim.control === 'text' ? { op: 'contains', text: String(c?.text || '') }
        : col(c);
  }
  return out;
}

export function deserializeFilter(saved, customDims = []) {
  const out = emptyFilter(customDims);
  if (!saved || typeof saved !== 'object') return out;
  const setCol = (key, c) => {
    if (!c || typeof c !== 'object') return;
    if (c.op === 'is' || c.op === 'isnot') out[key].op = c.op;
    out[key].values = new Set(Array.isArray(c.values) ? c.values.map(String) : []);
  };
  const setDateCol = (key, d) => {
    if (!d || typeof d !== 'object') return;
    if (d.op === 'within' || d.op === 'before' || d.op === 'after') out[key].op = d.op;
    out[key].range = typeof d.range === 'string' ? d.range : null;
    const parsed = d.date ? new Date(d.date) : null;
    out[key].date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  };
  for (const key of ['status', 'priority', 'person']) setCol(key, saved[key]);
  setDateCol('deadline', saved.deadline);
  for (const dim of customDims) {
    if (dim.control === 'date') setDateCol(dim.key, saved[dim.key]);
    else if (dim.control === 'text') {
      const c = saved[dim.key];
      if (c && typeof c === 'object' && typeof c.text === 'string') out[dim.key].text = c.text;
    } else setCol(dim.key, saved[dim.key]);
  }
  return out;
}
