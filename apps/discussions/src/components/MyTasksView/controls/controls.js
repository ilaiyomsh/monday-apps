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
  { key: 'labelAsc', label: 'Label order', icon: 'up' },
  { key: 'labelDesc', label: 'Label order', icon: 'down' },
  { key: 'azAsc', label: 'A → Z', icon: 'alphaAsc' },
  { key: 'azDesc', label: 'Z → A', icon: 'alphaDesc' },
];

// SORT — column -> ordered direction options. `type` picks the column icon.
export const SORT_COLUMNS = [
  { key: 'priority', type: 'status', alias: 'priorityID', dirs: STATUS_DIRS },
  {
    key: 'deadline', type: 'date', alias: 'deadlineID',
    dirs: [
      { key: 'deadlineAsc', label: 'Earliest first', icon: 'calUp' },
      { key: 'deadlineDesc', label: 'Latest first', icon: 'calDown' },
    ],
    note: 'Tasks with no deadline always sort last',
  },
  { key: 'status', type: 'status', alias: 'statusID', dirs: STATUS_DIRS },
  {
    key: 'name', type: 'text',
    dirs: [
      { key: 'nameAsc', label: 'A → Z', icon: 'alphaAsc' },
      { key: 'nameDesc', label: 'Z → A', icon: 'alphaDesc' },
    ],
  },
];

// GROUP — column -> ordered "order" options. status/priority reuse STATUS_DIRS.
export const GROUP_COLUMNS = [
  { key: 'status', type: 'status', orders: STATUS_DIRS },
  { key: 'priority', type: 'status', orders: STATUS_DIRS },
  {
    key: 'discussion', type: 'relation',
    orders: [
      { key: 'azAsc', label: 'A → Z', icon: 'alphaAsc' },
      { key: 'azDesc', label: 'Z → A', icon: 'alphaDesc' },
      { key: 'dateAsc', label: 'Date ↑', icon: 'calUp' },
      { key: 'dateDesc', label: 'Date ↓', icon: 'calDown' },
    ],
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
  is: 'is', isnot: 'is not',
  within: 'within', before: 'before', after: 'after',
};

export const DEADLINE_RANGES = [
  { key: 'today', label: 'Today', icon: 'calToday' },
  { key: 'thisWeek', label: 'This week', icon: 'calWeek' },
  { key: 'thisMonth', label: 'This month', icon: 'calMonth' },
  { key: 'overdue', label: 'Overdue', icon: 'clock' },
];

// Defaults are EMPTY (no sort, no grouping): every table starts with nothing
// selected unless a shared saved view (settings.preferences.savedViews) exists.
// An empty sort has NO column either — the panel shows a "Choose a column"
// placeholder, exactly like the group panel's none state.
export const DEFAULT_SORT = { col: null, dir: null, active: false };
export const DEFAULT_GROUP = { col: 'none' };

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
  const s = colFilterActive(filter.status);
  const p = colFilterActive(filter.priority);
  const pr = colFilterActive(filter.person);
  const d = deadlineFilterActive(filter.deadline);
  if (!s && !p && !pr && !d) return list;
  return list.filter((tk) => {
    if (s && !matchStatusCol(filter.status, tk.statusID)) return false;
    if (p && !matchStatusCol(filter.priority, tk.priorityID)) return false;
    if (pr && !matchPersonCol(filter.person, tk.responsibilityID)) return false;
    if (d && !matchDeadline(filter.deadline, tk.deadlineID, now)) return false;
    return true;
  });
}

// Active-value count for the toolbar pill badge ("/ N").
export function filterCount(filter) {
  if (!filter) return 0;
  let n = 0;
  if (colFilterActive(filter.status)) n += filter.status.values.size;
  if (colFilterActive(filter.priority)) n += filter.priority.values.size;
  if (colFilterActive(filter.person)) n += filter.person.values.size;
  if (deadlineFilterActive(filter.deadline)) n += 1;
  return n;
}

// A fresh, empty filter (one Set per status column + a default deadline row off).
export function emptyFilter() {
  return {
    status: { op: 'is', values: new Set() },
    priority: { op: 'is', values: new Set() },
    person: { op: 'is', values: new Set() },
    deadline: { op: 'within', range: null, date: null },
  };
}

// ------------------------------------------------- saved-view (de)serialize --
// The live filter holds Sets and a Date, which don't survive JSON storage
// (settings.preferences.savedViews). Serialize to plain arrays + ISO string;
// deserialize defensively back to the live shape (garbage → empty filter).

export function serializeFilter(filter) {
  const f = filter || emptyFilter();
  const col = (c) => ({ op: c?.op || 'is', values: [...(c?.values || [])] });
  const d = f.deadline || {};
  return {
    status: col(f.status),
    priority: col(f.priority),
    person: col(f.person),
    deadline: {
      op: d.op || 'within',
      range: d.range || null,
      date: d.date instanceof Date ? d.date.toISOString() : null,
    },
  };
}

export function deserializeFilter(saved) {
  const out = emptyFilter();
  if (!saved || typeof saved !== 'object') return out;
  for (const key of ['status', 'priority', 'person']) {
    const c = saved[key];
    if (!c || typeof c !== 'object') continue;
    if (c.op === 'is' || c.op === 'isnot') out[key].op = c.op;
    out[key].values = new Set(Array.isArray(c.values) ? c.values.map(String) : []);
  }
  const d = saved.deadline;
  if (d && typeof d === 'object') {
    if (d.op === 'within' || d.op === 'before' || d.op === 'after') out.deadline.op = d.op;
    out.deadline.range = typeof d.range === 'string' ? d.range : null;
    const parsed = d.date ? new Date(d.date) : null;
    out.deadline.date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  return out;
}
