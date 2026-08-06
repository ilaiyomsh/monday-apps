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
 * The type groups an owner may add custom columns under (owner spec: people,
 * dropdowns, board links, dates, text, files — NOT statuses/checkboxes/
 * computed). Keys match the mapping screen's COLUMN_TYPE_GROUPS keys; the
 * value is the canonical monday column TYPE stored on a new custom entry
 * (the Settings picker's type-compatibility check expands it to the group's
 * sibling types, e.g. text ⇄ long_text).
 */
export const CUSTOM_COLUMN_TYPE_GROUPS = {
  people: 'people',
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

export default {
  CUSTOM_COLUMN_BOARDS,
  CUSTOM_COLUMN_TYPE_GROUPS,
  isCustomAlias,
  canAddCustomColumn,
  nextCustomAlias,
  makeCustomColumn,
  customEntriesFor,
};
