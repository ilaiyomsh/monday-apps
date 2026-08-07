/*
 * round364 — CUSTOM extra column mappings (owner request).
 *
 * The mapping screen's alias lists are fixed by COLUMN_SCHEMA; this module is
 * the pure logic behind letting an owner ADD more mapped columns to the
 * discussions/tasks boards, per column-type group (e.g. another connected-board
 * column "פרויקטים" on the discussions board). Custom mappings live in
 * settings.columns[boardKey] beside the schema aliases, under generated
 * aliases `custom<N>ID`, flagged `custom: true` — the existing persistence
 * (stored settings merge OVER the schema, unknown aliases survive) carries
 * them with no storage-format change.
 *
 * Read-only by design (v1): the app DISPLAYS custom columns (discussion
 * management details row; task tables), never writes them.
 */

export const CUSTOM_COLUMN_BOARDS = ['discussions', 'tasks'];

/*
 * The type groups an owner may add custom columns under. Keys match the mapping
 * screen's COLUMN_TYPE_GROUPS keys; the value is the canonical monday column TYPE
 * stored on a new custom entry (the Settings picker's type-compatibility check
 * expands it to the group's sibling types, e.g. text ⇄ long_text, status ⇄ color).
 *
 * round372 (owner spec, reversing round364's "NOT statuses") — `status` joined the
 * set, which fixes two reported symptoms at once: the סטטוסים group had no
 * "+ הוספת עמודה מהלוח" button, AND on the DISCUSSIONS board the group did not
 * render at all. The second one follows from the first: the mapping sidebar keeps a
 * folder only when it has schema entries OR custom columns may be added there, and
 * the discussions schema has zero status-type columns ("סוג דיון" is a dropdown).
 *
 * Still OUT, on purpose: `checkbox` (owner deferred it) and `formula`/`mirror`
 * (computed — monday exposes no write path, so offering one would be a trap).
 */
export const CUSTOM_COLUMN_TYPE_GROUPS = {
  people: 'people',
  status: 'status',
  dropdown: 'dropdown',
  relation: 'board_relation',
  date: 'date',
  text: 'text',
  file: 'file',
};

const CUSTOM_ALIAS_RE = /^custom(\d+)ID$/;

export function isCustomAlias(alias) {
  return typeof alias === 'string' && CUSTOM_ALIAS_RE.test(alias);
}

/** May the owner add a custom column on this board, under this type group? */
export function canAddCustomColumn(boardKey, groupKey) {
  return CUSTOM_COLUMN_BOARDS.includes(boardKey)
    && Object.prototype.hasOwnProperty.call(CUSTOM_COLUMN_TYPE_GROUPS, groupKey);
}

const customIndex = (alias) => Number(CUSTOM_ALIAS_RE.exec(alias)?.[1] || 0);

/**
 * The next free custom alias for a board's columns map — `custom<N>ID` with N
 * one above the highest existing custom index (mapped or not), so removing a
 * middle entry never reuses its alias for a different column.
 */
export function nextCustomAlias(columnsForBoard) {
  const max = Object.keys(columnsForBoard || {})
    .filter(isCustomAlias)
    .reduce((m, alias) => Math.max(m, customIndex(alias)), 0);
  return `custom${max + 1}ID`;
}

/** A fresh, unmapped custom entry for a type group (Settings draft shape). */
export function makeCustomColumn(groupKey) {
  const type = CUSTOM_COLUMN_TYPE_GROUPS[groupKey];
  if (!type) return null;
  return { id: '', type, title: '', verified: false, custom: true };
}

/**
 * The board's custom entries as [alias, col] pairs in stable index order.
 * `types` (optional array of monday column types) narrows to one type group.
 * Recognition is by ALIAS SHAPE alone — the `custom` flag is advisory and may
 * not survive every settings merge round-trip.
 */
export function customEntriesFor(columnsForBoard, types) {
  return Object.entries(columnsForBoard || {})
    .filter(([alias, col]) => isCustomAlias(alias) && col
      && (!types || types.includes(col.type)))
    .sort(([a], [b]) => customIndex(a) - customIndex(b));
}

/**
 * round366 — the hide-picker (BuilderIcon) icon name for a custom column type.
 */
export function customColumnIcon(type) {
  if (type === 'people' || type === 'person' || type === 'multiple_person') return 'person';
  if (type === 'date') return 'date';
  if (type === 'dropdown') return 'status';
  if (type === 'board_relation' || type === 'connect_boards') return 'relation';
  return 'text';
}

/* ------------------------------------------------------------------ round373 --
 * THE DESCRIPTOR LAYER — one type→behaviour map, read by every engine.
 *
 * Owner spec: a custom column must be a first-class column — same look, same
 * behaviour, same table powers (filter, sort, group, hide, edit) as a base
 * mapped one. Before this round each power carried its own hardcoded literal
 * (SORT_COLUMNS / GROUP_COLUMNS / the switch inside customFilterDims), so a
 * custom alias could only enter the ones that had been taught about it — filter
 * and hide. `kind` is the single fact the sort, group, filter, render and edit
 * paths all derive from, which is what keeps them from drifting apart again.
 *
 * monday exposes several type names for one behaviour ('color' is a status,
 * 'connect_boards' a board_relation, 'long_text' a text); folding them here
 * means no downstream engine ever repeats that list.
 */
export const CUSTOM_KIND_BY_TYPE = {
  status: 'status',
  color: 'status',
  people: 'person',
  person: 'person',
  multiple_person: 'person',
  date: 'date',
  dropdown: 'values',
  board_relation: 'relation',
  connect_boards: 'relation',
  text: 'text',
  long_text: 'text',
  file: 'file',
};

/** The behaviour kind of a monday column type, or null when the app can't drive it. */
export function customColumnKind(type) {
  return CUSTOM_KIND_BY_TYPE[type] || null;
}

/*
 * The FILTER control is deliberately coarser than the kind: status, dropdown and
 * relation all filter as a value set (round366's contract, which
 * customComparableValues already implements for all three). Collapsing kind and
 * control into one map would quietly change how a relation column filters.
 */
const FILTER_CONTROL_BY_KIND = {
  status: 'values',
  values: 'values',
  relation: 'values',
  person: 'person',
  date: 'date',
  text: 'text',
  file: null,
};

export function customFilterControl(kind) {
  return FILTER_CONTROL_BY_KIND[kind] ?? null;
}

// Direction sets per kind — the KEYS match the base columns' (sortTasks reads
// them), so a custom row in the Sort builder reads identically to a base one.
const STATUS_SORT_DIRS = [
  { key: 'labelAsc', label: 'סדר לייבלים', icon: 'up' },
  { key: 'labelDesc', label: 'סדר לייבלים', icon: 'down' },
  { key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' },
  { key: 'azDesc', label: 'ת → א', icon: 'alphaDesc' },
];
const TEXT_SORT_DIRS = [
  { key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' },
  { key: 'azDesc', label: 'ת → א', icon: 'alphaDesc' },
];
const DATE_SORT_DIRS = [
  { key: 'dateAsc', label: 'מהמוקדם למאוחר', icon: 'calUp' },
  { key: 'dateDesc', label: 'מהמאוחר למוקדם', icon: 'calDown' },
];

const SORT_DIRS_BY_KIND = {
  status: STATUS_SORT_DIRS,
  values: TEXT_SORT_DIRS,
  relation: TEXT_SORT_DIRS,
  person: TEXT_SORT_DIRS,
  text: TEXT_SORT_DIRS,
  date: DATE_SORT_DIRS,
};

// Grouping offers ONE pinned order per kind, matching GROUP_COLUMNS' shape (the
// group state stays { col, order } so saved views need no migration).
const GROUP_ORDERS_BY_KIND = {
  status: [{ key: 'labelAsc', label: 'סדר לייבלים', icon: 'up' }],
  values: [{ key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' }],
  relation: [{ key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' }],
  person: [{ key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' }],
  text: [{ key: 'azAsc', label: 'א → ת', icon: 'alphaAsc' }],
  date: [{ key: 'dateDesc', label: 'מהמאוחר למוקדם', icon: 'calDown' }],
};

function customDims(customCols, byKind) {
  return (customCols || []).map((c) => {
    const kind = customColumnKind(c.type);
    const spec = kind ? byKind[kind] : null;
    if (!spec) return null;
    return { key: c.alias, kind, title: c.title || c.alias, icon: customColumnIcon(c.type), spec };
  }).filter(Boolean);
}

/** Sortable custom columns: [{ key, kind, title, icon, dirs }]. `file` is out. */
export function customSortDims(customCols) {
  return customDims(customCols, SORT_DIRS_BY_KIND)
    .map(({ spec, ...d }) => ({ ...d, dirs: spec }));
}

/** Groupable custom columns: [{ key, kind, title, icon, orders }]. `file` is out. */
export function customGroupDims(customCols) {
  return customDims(customCols, GROUP_ORDERS_BY_KIND)
    .map(({ spec, ...d }) => ({ ...d, orders: spec }));
}

// ---- comparable extraction ------------------------------------------------

const namesOf = (people) => (Array.isArray(people) ? people : [])
  .map((p) => String(p?.name ?? p?.id ?? ''))
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, 'he'))
  .join(', ');

/**
 * The comparable behind a custom value: `{ rank, text }`.
 *   rank — the ordered position (status display rank, date timestamp), or null
 *          when the cell is EMPTY. Callers push null ranks last in BOTH
 *          directions, exactly like the base deadline/status sorts.
 *   text — the display text, for the alphabetical directions.
 *
 * A status label id of **0 is a real label**: every emptiness test here is a
 * type/NaN test, never truthiness, or the column's first label would sort as
 * "no value".
 */
export function customSortKey(kind, raw, maps = {}) {
  if (kind === 'status') {
    if (typeof raw !== 'number') return { rank: null, text: '' };
    const rank = maps.orderById?.[raw];
    return { rank: rank == null ? null : rank, text: String(maps.labelById?.[raw] ?? '') };
  }
  if (kind === 'date') {
    const t = raw instanceof Date ? raw.getTime() : NaN;
    if (Number.isNaN(t)) return { rank: null, text: '' };
    return { rank: t, text: '' };
  }
  if (kind === 'person') return { rank: null, text: namesOf(raw) };
  if (kind === 'relation') return { rank: null, text: namesOf(raw?.linkedItems) };
  return { rank: null, text: String(raw ?? '').trim() };
}

// ---- grouping -------------------------------------------------------------

const NO_VALUE_KEY = '__custom_no_value__';
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/*
 * One bucket descriptor per row: `{ key, label, color, sortRank }`, or null when
 * the cell is empty (the caller pools those into the trailing "no value" group).
 *
 * MULTI-VALUE columns (people, linked items, multi-label dropdowns) bucket by the
 * whole COMBINATION — one group per distinct set — which is the convention the
 * app already uses for its discussion and person groupings. The key is built from
 * the SORTED ids so assignment order never splits one real group in two, while
 * the label is name-sorted for reading.
 */
function bucketFor(kind, raw, opts) {
  if (kind === 'status') {
    if (typeof raw !== 'number') return null;
    const label = opts.statusOpts?.labelById?.[raw];
    if (label == null) return null;
    return {
      key: `st:${raw}`,
      label,
      color: opts.statusOpts?.colorById?.[raw] || null,
      status: raw,
      sortRank: opts.statusOpts?.orderById?.[raw] ?? Infinity,
    };
  }
  if (kind === 'date') {
    if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) return null;
    const day = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    return { key: `date:${dayKey(raw)}`, label: dayLabel(raw), color: null, sortRank: day.getTime() };
  }
  if (kind === 'person' || kind === 'relation') {
    const list = kind === 'person'
      ? (Array.isArray(raw) ? raw : [])
      : (Array.isArray(raw?.linkedItems) ? raw.linkedItems : []);
    if (!list.length) return null;
    const ids = list.map((p) => String(p?.id ?? '')).sort();
    return { key: `set:${ids.join('|')}`, label: namesOf(list), color: null, sortRank: null };
  }
  // dropdown / text — the value IS the label. A multi-label dropdown arrives
  // comma-joined from monday and groups as that whole combination.
  const text = String(raw ?? '').trim();
  if (!text) return null;
  return { key: `val:${text}`, label: text, color: null, sortRank: null };
}

/**
 * Bucket `list` by a custom column, returning the app's group shape
 * (`{ key, label, color, status, items }`). The EMPTY bucket always sorts last —
 * an unfilled cell reads as the tail of the board, in every direction, matching
 * the base status/deadline groupings.
 */
export function customGroupBuckets(list, alias, kind, opts = {}) {
  const rows = Array.isArray(list) ? list : [];
  const order = opts.order || GROUP_ORDERS_BY_KIND[kind]?.[0]?.key || 'azAsc';
  const noValueLabel = opts.noValueLabel || 'ללא ערך';
  const groups = new Map();
  const empty = [];

  rows.forEach((row) => {
    const b = bucketFor(kind, row?.[alias], opts);
    if (!b) { empty.push(row); return; }
    if (!groups.has(b.key)) {
      groups.set(b.key, { key: b.key, label: b.label, color: b.color, status: b.status, sortRank: b.sortRank, items: [] });
    }
    groups.get(b.key).items.push(row);
  });

  const valued = [...groups.values()];
  const dir = (order === 'labelDesc' || order === 'azDesc' || order === 'dateDesc') ? -1 : 1;
  valued.sort((a, b) => {
    // Ranked kinds (status display order, date) sort by rank; the rest collate
    // their labels in Hebrew.
    if (a.sortRank != null && b.sortRank != null) return (a.sortRank - b.sortRank) * dir;
    return (a.label || '').localeCompare(b.label || '', 'he') * dir;
  });

  const out = valued.map(({ sortRank, ...g }) => g);
  if (empty.length) {
    out.push({ key: NO_VALUE_KEY, label: noValueLabel, color: null, status: null, items: empty });
  }
  return out;
}

export const CUSTOM_NO_VALUE_KEY = NO_VALUE_KEY;

/**
 * The descriptor map both new engines read — `sortTasks(list, sort, { custom })`
 * and `groupTabTasks(list, { custom })` — keyed by alias.
 *
 * Only STATUS columns need loaded data (their values are stable label IDs, so
 * text/colour/display-rank all come from the column definition, collected once
 * per column by CustomStatusCollector). Every other kind is self-describing, so
 * a missing status map degrades to "unsorted/one bucket" rather than throwing —
 * which is exactly the state during the first render, before the labels land.
 */
export function customEngineDims(customCols, statusMapsByAlias = {}) {
  const out = {};
  for (const c of customCols || []) {
    const kind = customColumnKind(c.type);
    if (!kind || kind === 'file') continue;
    if (kind === 'status') {
      const m = statusMapsByAlias[c.alias] || {};
      out[c.alias] = {
        kind,
        orderById: m.orderById || {},
        labelById: m.labelById || {},
        statusOpts: m,
      };
    } else {
      out[c.alias] = { kind };
    }
  }
  return out;
}

export default {
  CUSTOM_COLUMN_BOARDS,
  CUSTOM_COLUMN_TYPE_GROUPS,
  isCustomAlias,
  canAddCustomColumn,
  nextCustomAlias,
  makeCustomColumn,
  customEntriesFor,
  customColumnKind,
  customFilterControl,
  customSortDims,
  customGroupDims,
  customSortKey,
  customGroupBuckets,
};
