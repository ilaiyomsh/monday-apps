import { sortGroupsByOrder } from '../GroupByBuilder/groupOrders.js';
import { isValidStatus } from '../../constants/statusConfig.js';
import { customGroupBuckets } from '../../utils/customColumns.js';

/*
 * Pure grouping helpers for the "My Tasks" view. Kept separate from the React
 * component so the bucketing rules can be unit-tested without rendering.
 *
 * A task here has the shape produced by BoardSDK.mapItem / useMyTasks:
 *   { id, name, created_at, responsibilityID (people[]), deadlineID (Date|null),
 *     statusID (status label id), discussionLinkID (board_relation), taskNotesID,
 *     priority (status label id) }
 *
 * discussionLinkID is the discussion board_relation, parsed to
 *   { ids: string[], linkedItems: [{ id, name }], text }
 * so the discussion a task belongs to is discussionLinkID.linkedItems[0] (a task links
 * to a single discussion). The board-group grouping reads the monday `group`
 * carried on the item (item.group = { id, title }) when present.
 *
 * Each returned group is { key, label, color, status, items }:
 *   key    — stable react/collapse key
 *   label  — display text
 *   color  — accent color (status/priority color for those groupings; null else)
 *   status — the status label id this group represents (status grouping only;
 *            null = "no status"; undefined = N/A for other groupings)
 *   items  — the tasks in the group
 */

export const GROUP_MODES = ['none', 'discussion', 'status', 'priority', 'deadline', 'person'];

export const NO_STATUS = '__none__';
export const NO_PRIORITY = '__no_priority__';
export const NO_DISCUSSION = '__no_discussion__';
export const NO_GROUP = '__no_group__';
export const NO_DATE = '__no_date__';
export const ALL_TASKS = '__all__';

// 20-color monday LABEL palette (hex), mirrors theme-tokens.css --topic-color-1..20
// and the same string hash used by TopicsTab.topicColorStartIndex, so a
// discussion's accent here matches the topics palette and is STABLE across
// renders (no Math.random). Kept as literal hexes (not hsl(var(--topic-color-N)))
// because grouping.js must stay CSS/DOM-free for jsdom unit tests, and grp.color
// is already passed straight into style.color as a raw hex.
export const DISCUSSION_PALETTE = [
  '#00c875', '#037f4c', '#9cd326', '#cab641', '#ffcb00',
  '#fdab3d', '#ff6d3b', '#ff7575', '#df2f4a', '#bb3354',
  '#e50073', '#ff5ac4', '#9d50dd', '#784bd1', '#7e3b8a',
  '#5559df', '#225091', '#579bfc', '#007eb5', '#4eccc6',
];
function stableHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}
function discussionColor(id) {
  return DISCUSSION_PALETTE[stableHash(String(id)) % DISCUSSION_PALETTE.length];
}

/*
 * Give EVERY real group a varied, stable title color (owner request
 * 2026-07-14): groups that already carry a semantic color (status/priority
 * label colors, the discussion palette) keep it; colorless labeled groups
 * (date buckets, board groups, person groups, the "no value" buckets) get a
 * palette color hashed from their KEY — stable across renders — with a linear
 * probe past colors already used in the list, so small group sets still look
 * varied instead of colliding. An UNLABELED bucket (the ungrouped single-table
 * view) deliberately stays uncolored.
 *
 * `overrides` (round 77): a { [groupKey]: hexColor } map of USER-CHOSEN header
 * colors (right-click a group header → color palette, shared across all users).
 * An override WINS over everything — even a group's own semantic color — so the
 * owner-picked color is always what shows. Groups without an override fall back
 * to the semantic/hash behavior above.
 */
export function ensureGroupColors(groups, overrides = null) {
  const list = Array.isArray(groups) ? groups : [];
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const overrideFor = (g) => (g && g.key != null ? ov[String(g.key)] : undefined);
  // Override colors are already "taken" so the hash probe never reuses them.
  const used = new Set(list.map((g) => overrideFor(g) || g?.color).filter(Boolean));
  return list.map((g) => {
    if (!g) return g;
    const override = overrideFor(g);
    if (override) return { ...g, color: override };
    if (g.color || !g.label) return g;
    let i = stableHash(String(g.key)) % DISCUSSION_PALETTE.length;
    for (let step = 0; step < DISCUSSION_PALETTE.length && used.has(DISCUSSION_PALETTE[i]); step += 1) {
      i = (i + 1) % DISCUSSION_PALETTE.length;
    }
    const color = DISCUSSION_PALETTE[i];
    used.add(color);
    return { ...g, color };
  });
}

// Resolve the single discussion a task is linked to via the discussionLinkID
// board_relation. Returns { id, name } or null. parseValue('board_relation')
// produces { linkedItems, ids, text }; we read linkedItems first (the canonical
// shape, with `name`), tolerate a legacy `items` key, and fall back to ids +
// the raw display string (rel.text) when no linked item object is present.
export function getTaskDiscussion(task) {
  const rel = task?.discussionLinkID;
  if (!rel) return null;
  const first = (Array.isArray(rel.linkedItems) ? rel.linkedItems[0] : null)
    || (Array.isArray(rel.items) ? rel.items[0] : null);
  if (first?.id != null) return { id: String(first.id), name: first.name || rel.text || '' };
  const id = Array.isArray(rel.ids) ? rel.ids[0] : null;
  if (id != null) return { id: String(id), name: rel.text || '' };
  return null;
}

// Resolve the monday board group an item sits in. monday returns
// item.group = { id, title }; we tolerate a few shapes.
export function getTaskGroup(task) {
  const g = task?.group;
  if (!g) return null;
  const id = g.id ?? g.group_id ?? null;
  if (id == null) return null;
  return { id: String(id), title: g.title ?? g.group_title ?? '' };
}

function sortByLabelHe(a, b) {
  return (a.label || '').localeCompare(b.label || '', 'he');
}

// Group by the linked discussion. `order` is one of azAsc | azDesc | dateAsc |
// dateDesc. Date ordering reads the parent discussion's date from the injected
// `discussionDateById` map (id -> Date|number); undated discussions sort last.
// The "No discussion" bucket is pinned to an EDGE: FIRST on azAsc, LAST on
// every other order (azDesc/dateAsc/dateDesc) — owner decision 2026-07-14, so
// unlinked tasks are always at a predictable end of the board.
function groupByDiscussion(tasks, { noDiscussionLabel, order = 'azAsc', discussionDateById = {} } = {}) {
  const groups = new Map();
  tasks.forEach((t) => {
    const d = getTaskDiscussion(t);
    const key = d ? `disc:${d.id}` : NO_DISCUSSION;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        discId: d ? d.id : null,
        label: d ? d.name : (noDiscussionLabel || 'ללא דיון'),
        color: d ? discussionColor(d.id) : null,
        status: undefined,
        items: [],
      });
    }
    groups.get(key).items.push(t);
  });
  const all = [...groups.values()];
  const noDisc = all.filter((g) => g.key === NO_DISCUSSION);
  const valued = all.filter((g) => g.key !== NO_DISCUSSION);
  if (order === 'dateAsc' || order === 'dateDesc') {
    const dir = order === 'dateDesc' ? -1 : 1;
    const timeOf = (g) => {
      const v = discussionDateById[g.discId];
      const t = v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : null);
      return t;
    };
    valued.sort((a, b) => {
      const ta = timeOf(a); const tb = timeOf(b);
      if (ta == null && tb == null) return sortByLabelHe(a, b);
      if (ta == null) return 1; // undated last
      if (tb == null) return -1;
      return (ta - tb) * dir;
    });
  } else {
    const dir = order === 'azDesc' ? -1 : 1;
    valued.sort((a, b) => sortByLabelHe(a, b) * dir);
  }
  return order === 'azAsc' ? [...noDisc, ...valued] : [...valued, ...noDisc];
}

// Generic status-column grouping over `alias` (statusID = status, priority =
// priority). Uses the status maps so labels/colors match the column. `order` is
// one of labelAsc | labelDesc (by the column's display rank) or azAsc | azDesc
// (alphabetical by label text, Hebrew collation). The "no value" bucket always
// sorts LAST (an empty group at the bottom), regardless of direction.
function groupByStatusColumn(tasks, alias, {
  labelById = {}, colorById = {}, orderById = {}, isValidStatus,
  noValueKey, noValueLabel, order = 'labelAsc',
} = {}) {
  const valid = typeof isValidStatus === 'function' ? isValidStatus : (v) => v != null && v !== '';
  const groups = new Map();
  tasks.forEach((t) => {
    const raw = t[alias];
    const id = valid(raw) && labelById[raw] != null ? raw : null;
    const key = id == null ? noValueKey : String(id);
    if (!groups.has(key)) groups.set(key, { key, statusId: id, items: [] });
    groups.get(key).items.push(t);
  });
  const all = [...groups.values()].map((g) => ({
    key: g.key,
    label: g.statusId == null ? noValueLabel : (labelById[g.statusId] ?? noValueLabel),
    color: g.statusId == null ? null : (colorById[g.statusId] || null),
    status: g.statusId,
    items: g.items,
  }));
  const noVal = all.filter((g) => g.status == null);
  const valued = all.filter((g) => g.status != null);
  if (order === 'azAsc' || order === 'azDesc') {
    const dir = order === 'azDesc' ? -1 : 1;
    valued.sort((a, b) => sortByLabelHe(a, b) * dir);
  } else {
    const dir = order === 'labelDesc' ? -1 : 1;
    valued.sort((a, b) => ((orderById[a.status] ?? Infinity) - (orderById[b.status] ?? Infinity)) * dir);
  }
  return [...valued, ...noVal];
}

// Group by status label id (statusID). "No status" sorts last.
function groupByStatus(tasks, opts = {}) {
  return groupByStatusColumn(tasks, 'statusID', {
    ...opts,
    noValueKey: NO_STATUS,
    noValueLabel: opts.noStatusLabel || 'ללא סטאטוס',
  });
}

// Group by the priority status column. The label DISPLAY order defines priority
// (orderById rank 0 = highest), so highest-priority groups sort first and the
// "no priority" bucket sorts last. The priority status maps arrive under the
// priority* keys so they don't collide with the statusID status maps.
function groupByPriority(tasks, opts = {}) {
  return groupByStatusColumn(tasks, 'priorityID', {
    labelById: opts.priorityLabelById || {},
    colorById: opts.priorityColorById || {},
    orderById: opts.priorityOrderById || {},
    isValidStatus: opts.isValidStatus,
    noValueKey: NO_PRIORITY,
    noValueLabel: opts.noPriorityLabel || 'ללא עדיפות',
    order: opts.order,
  });
}

// "No grouping" — a single bucket holding every task, titled by the caller
// (the app passes the localized "משימות" / "Tasks").
function groupNone(tasks, { allTasksLabel } = {}) {
  return [{ key: ALL_TASKS, label: allTasksLabel || 'משימות', color: null, status: undefined, items: [...tasks] }];
}

// Group by the monday board group the item belongs to. "No group" sorts first.
function groupByBoardGroup(tasks, { noGroupLabel } = {}) {
  const groups = new Map();
  tasks.forEach((t) => {
    const g = getTaskGroup(t);
    const key = g ? `group:${g.id}` : NO_GROUP;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: g ? g.title : (noGroupLabel || 'ללא קבוצה'),
        color: null,
        status: undefined,
        items: [],
      });
    }
    groups.get(key).items.push(t);
  });
  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_GROUP) return -1;
    if (b.key === NO_GROUP) return 1;
    return sortByLabelHe(a, b);
  });
}

// Calendar-day key + label for date grouping (kept DOM/locale-free for jsdom
// unit tests — dd/mm/yyyy, the app's date display format).
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Group by the date column (the shared `deadlineID` alias — the decision date on
// the decisions pipeline). Buckets by CALENDAR DAY; `order` is dateDesc (most
// recent day FIRST — the My-Decisions default) or dateAsc. The "no date" bucket
// always sorts LAST. Group objects carry an internal `time` for the sort only.
function groupByDate(tasks, { noDateLabel, order = 'dateDesc' } = {}) {
  const groups = new Map();
  tasks.forEach((t) => {
    const d = t.deadlineID instanceof Date ? t.deadlineID : null;
    const key = d ? `date:${dayKey(d)}` : NO_DATE;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        time: d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null,
        label: d ? dayLabel(d) : (noDateLabel || 'ללא תאריך'),
        color: null,
        status: undefined,
        items: [],
      });
    }
    groups.get(key).items.push(t);
  });
  const dir = order === 'dateAsc' ? 1 : -1; // default dateDesc — most recent day first
  const all = [...groups.values()];
  const dated = all.filter((g) => g.time != null).sort((a, b) => (a.time - b.time) * dir);
  const undated = all.filter((g) => g.time == null);
  return [...dated, ...undated];
}

// Top-level dispatcher. `mode` is one of GROUP_MODES; `opts` carries the status
// maps (for 'status'/'priority'), the chosen `order`, the injected
// `discussionDateById` map (for discussion date order), and localized labels.
export function groupMyTasks(tasks, mode, opts = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const buckets = (() => {
    switch (mode) {
      case 'none':
        return groupNone(list, opts);
      case 'discussion':
        return groupByDiscussion(list, opts);
      case 'status':
        return groupByStatus(list, opts);
      case 'priority':
        return groupByPriority(list, opts);
      case 'deadline':
        return groupByDate(list, opts);
      // round224 — "אחריות": group by the responsibility people (owner mockup).
      // Reuses the tabs' person-group engine (same bucket keys/labels).
      case 'person':
        return groupTabTasks(list, { by: 'person', order: opts.order === 'azDesc' ? 'azDesc' : 'azAsc' });
      case 'group':
        return groupByBoardGroup(list, opts);
      default:
        return groupByStatus(list, opts);
    }
  })();
  // Every labeled group leaves here with a color (semantic colors preserved).
  return ensureGroupColors(buckets);
}

// ---------------------------------------------------------------- round142 --
// Shared grouping engine for the discussion task TABS (TasksTab +
// PreviousTasksTab) — stubs, implemented behind the TDD gate.
export const NO_ASSIGNEE = '__unassigned__';
export const TAB_NO_DISCUSSION = '__nodiscussion__';

/*
 * One person-group bucket for a task (TasksTab semantics, now shared): key by
 * the SORTED person ids (stable regardless of assignment order) with a
 * 'people:' prefix, label by the same-sorted names, and carry an `assignee`
 * seed so a task created inside the group inherits its people.
 */
export function buildPersonGroup(task) {
  const people = Array.isArray(task?.responsibilityID) ? task.responsibilityID : [];
  if (people.length === 0) return { key: NO_ASSIGNEE, label: 'לא הוקצה', assignee: [] };
  const normalized = people
    .map((p) => ({ id: String(p.id), name: p.name || '' }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    key: `people:${normalized.map((p) => p.id).join('|')}`,
    label: normalized.map((p) => p.name).join(', '),
    assignee: normalized.map((p) => ({ id: p.id, kind: 'person', name: p.name })),
  };
}

/*
 * The tabs' grouping engine (extracted from the byte-similar groupedRaw blocks
 * in TasksTab and PreviousTasksTab):
 *   by      — 'status' | 'person' | 'discussion' | anything else = ungrouped
 *   order   — sortGroupsByOrder key (labelAsc/labelDesc/azAsc/azDesc); the
 *             "no value" bucket always stays FIRST (existing tab behavior)
 *   labelById/colorById/orderById — the mapped status column's maps ('status')
 * Group shape matches the tabs: { key, label, color, status, assignee?, items }.
 * Every labeled group leaves with a color (ensureGroupColors), and the callers
 * still apply their user overrides as a second ensureGroupColors pass.
 */
export function groupTabTasks(tasks, { by = 'none', order = 'azAsc', labelById = {}, colorById = {}, orderById = {}, custom = {} } = {}) {
  const list = Array.isArray(tasks) ? tasks : [];

  /*
   * round373 — grouping by a CUSTOM column. `custom[alias]` carries the column's
   * descriptor ({ kind, statusOpts? }); an alias with no entry falls through to
   * the ungrouped bucket rather than throwing, which is what a stale saved view
   * pointing at a since-removed custom column produces.
   *
   * Checked FIRST because a custom alias can never collide with a base key, and
   * ensureGroupColors still runs on the result so a colorless kind (dropdown,
   * people, text, date) gets the same varied palette every other group gets.
   */
  const dim = custom?.[by];
  if (dim) {
    return ensureGroupColors(customGroupBuckets(list, by, dim.kind, { ...dim, order }));
  }

  if (by === 'status') {
    const groups = new Map();
    list.forEach((t) => {
      const id = isValidStatus(t.statusID) && labelById[t.statusID] != null ? t.statusID : null;
      const key = id == null ? NO_STATUS : String(id);
      if (!groups.has(key)) groups.set(key, { key, statusId: id, items: [] });
      groups.get(key).items.push(t);
    });
    const out = [...groups.values()].map((g) => ({
      key: g.key,
      label: g.statusId == null ? 'ללא סטאטוס' : (labelById[g.statusId] ?? 'ללא סטאטוס'),
      color: g.statusId == null ? null : (colorById[g.statusId] || null),
      status: g.statusId,
      items: g.items,
    }));
    return ensureGroupColors(sortGroupsByOrder(out, { order, orderById, noKey: NO_STATUS }));
  }

  if (by === 'person') {
    const groups = new Map();
    list.forEach((t) => {
      const pg = buildPersonGroup(t);
      if (!groups.has(pg.key)) {
        groups.set(pg.key, { key: pg.key, label: pg.label, color: null, status: undefined, assignee: pg.assignee, items: [] });
      }
      groups.get(pg.key).items.push(t);
    });
    return ensureGroupColors(sortGroupsByOrder([...groups.values()], { order, noKey: NO_ASSIGNEE }));
  }

  if (by === 'discussion') {
    const groups = new Map();
    list.forEach((t) => {
      const linked = t.discussionLinkID?.linkedItems || [];
      const key = linked.map((d) => String(d.id)).sort().join('|') || TAB_NO_DISCUSSION;
      const label = linked.map((d) => d.name || d.id).join(', ') || 'ללא דיון מקור';
      if (!groups.has(key)) groups.set(key, { key, label, color: null, status: undefined, items: [] });
      groups.get(key).items.push(t);
    });
    return ensureGroupColors(sortGroupsByOrder([...groups.values()], { order, noKey: TAB_NO_DISCUSSION }));
  }

  return [{ key: ALL_TASKS, label: '', color: null, status: undefined, items: list }];
}
