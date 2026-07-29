/**
 * rowGrouping — the ordered, merge-ready table rows. The heart of this app.
 *
 * Word's vertical merge (`w:vMerge`) can only span CONSECUTIVE rows, so the
 * ordering here is forced by the output format, not chosen for looks:
 *
 *   action (first-appearance order) → committee (ascending) → date (ascending)
 *
 * Action groups keep the order they first appear in on the board — the reporter's
 * own order, which is meaningful to them and needs no Hebrew collation. Inside a
 * group, committees are sorted so equal ones become adjacent (the precondition for
 * merging them), and inside a committee run the dates read chronologically.
 *
 * Merging then happens over the RENDERED CELL TEXT, in two nested scopes:
 *   - the action cell merges across a whole action group;
 *   - the committee cell merges only WITHIN an action group — a committee merge
 *     that crossed an action boundary would swallow the next action's cell and
 *     produce a corrupt table. That confinement holds even when `mergeAction` is
 *     off, because the rows still belong to two different actions.
 *
 * A run of length 1 carries NO `rowSpan`: `w:vMerge` over a single row is a
 * malformed merge, so the renderer must not even be told about it.
 *
 * Pure module — no React, no SDK. `Row = { cells: (Cell|null)[4] }`,
 * `Cell = { text, rowSpan? }`, and `null` means "this cell is merged into the one
 * above; omit it from the row".
 */
import { columnText } from './columnText.js';

/** Cell index of each role. Index 0 is the RIGHTMOST cell once the RTL table renders. */
const CELL_ROLES = ['action', 'committee', 'report', 'date'];

const ACTION = 0;
const COMMITTEE = 1;

/** A leading 'YYYY-MM-DD' — anything else cannot be ordered chronologically. */
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * `{ [columnId]: type }` from either that map or boardMeta's `[{id, type}]` array.
 * Both shapes reach this module (settings holds ids, boardMeta holds objects), and
 * guessing wrong means every cell silently renders through the default branch.
 */
function typeMap(columnTypes) {
  if (Array.isArray(columnTypes)) {
    const map = {};
    for (const entry of columnTypes) {
      if (entry && entry.id) map[entry.id] = entry.type;
    }
    return map;
  }
  return columnTypes && typeof columnTypes === 'object' ? columnTypes : {};
}

/**
 * Sort key for the date column: ISO dates ascending, everything unusable last.
 *
 * An empty date and a non-ISO one (a hand-typed "20/07/2026" survives in a text
 * column mapped to the date role) cannot be placed chronologically. They go to the
 * END of their committee run rather than to the top, where they would read as the
 * first thing that happened.
 */
function dateSortKey(text) {
  return ISO_DATE_PREFIX.test(text) ? text : null;
}

/** Locale-aware ascending compare; used for committee names (Hebrew and Latin). */
function compareText(a, b) {
  return a.localeCompare(b, 'he');
}

/**
 * Build one row's four cell texts, in cell order.
 * @returns {string[]}
 */
function cellTexts(item, roleColumnId, types) {
  return CELL_ROLES.map((role) => {
    const columnId = roleColumnId[role];
    if (!columnId) return '';
    return columnText(types[columnId], item?.cv?.[columnId]);
  });
}

/**
 * Ordered, merge-ready rows for the report table.
 *
 * @param {Array<{id: string, cv: Object}>} items Items from services/itemsQuery,
 *   already narrowed to the selected committees.
 * @param {{columns: Object, mergeAction?: boolean, mergeCommittee?: boolean}} settings
 * @param {Object|Array<{id: string, type: string}>} columnTypes Column types by id.
 * @returns {Array<{cells: Array<{text: string, rowSpan?: number}|null>}>}
 */
export function groupRows(items, settings, columnTypes) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const roleColumnId = (settings && settings.columns) || {};
  const types = typeMap(columnTypes);
  const mergeAction = settings?.mergeAction !== false;
  const mergeCommittee = settings?.mergeCommittee !== false;

  // Decorate once: columnText is called exactly once per cell, and the sort then
  // works on plain strings. `index` keeps the sort stable for equal keys (the
  // board order), which is what makes the "invalid dates keep board order" and
  // "first appearance" guarantees hold together.
  const decorated = list.map((item, index) => ({
    index,
    texts: cellTexts(item, roleColumnId, types),
  }));

  // Action group order = first appearance on the board, NOT alphabetical.
  const actionOrder = new Map();
  for (const row of decorated) {
    const action = row.texts[ACTION];
    if (!actionOrder.has(action)) actionOrder.set(action, actionOrder.size);
  }

  decorated.sort((a, b) => {
    const byAction = actionOrder.get(a.texts[ACTION]) - actionOrder.get(b.texts[ACTION]);
    if (byAction !== 0) return byAction;

    const byCommittee = compareText(a.texts[COMMITTEE], b.texts[COMMITTEE]);
    if (byCommittee !== 0) return byCommittee;

    const aDate = dateSortKey(a.texts[3]);
    const bDate = dateSortKey(b.texts[3]);
    // Unusable dates sink to the end of the run; two of them keep board order.
    if (aDate === null || bDate === null) {
      if (aDate === bDate) return a.index - b.index;
      return aDate === null ? 1 : -1;
    }
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return a.index - b.index;
  });

  const rows = decorated.map((row) => ({
    cells: row.texts.map((text) => ({ text })),
  }));

  // Merge in the sorted plane. `runStart` is the row that carries the rowSpan;
  // every later row of the run gets null in that cell position.
  const mergeColumn = (cellIndex, sameRun) => {
    let runStart = 0;
    for (let i = 1; i <= rows.length; i += 1) {
      const continues = i < rows.length && sameRun(decorated[i - 1], decorated[i]);
      if (continues) {
        rows[i].cells[cellIndex] = null;
        continue;
      }
      const length = i - runStart;
      // A single-row run stays a plain cell: no rowSpan key at all.
      if (length > 1) rows[runStart].cells[cellIndex].rowSpan = length;
      runStart = i;
    }
  };

  const sameAction = (a, b) => a.texts[ACTION] === b.texts[ACTION];

  if (mergeAction) mergeColumn(ACTION, sameAction);
  if (mergeCommittee) {
    // The `sameAction` conjunct is the load-bearing half: without it a committee
    // that happens to be adjacent across an action boundary merges into one cell
    // spanning two actions.
    mergeColumn(COMMITTEE, (a, b) => sameAction(a, b) && a.texts[COMMITTEE] === b.texts[COMMITTEE]);
  }

  return rows;
}
