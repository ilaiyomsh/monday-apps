/**
 * reportModel — the whole document as data: the ordered blocks, the 4-column
 * table, and the title. The .docx layer renders this and nothing else.
 *
 * This is the assembly seam, so it owns exactly two decisions and delegates the
 * rest:
 *
 * 1. **The committee filter is applied HERE, client-side.** A mirror column cannot
 *    be filtered server-side at all — any `query_params` rule on one answers
 *    HTTP 200 carrying `InvalidColumnTypeException` and nulls the whole board node
 *    (probe-verified 2026-07-29). So `services/itemsQuery` fetches the reporter's
 *    whole range and the committee narrowing happens on the fetched rows.
 * 2. **Header resolution:** the owner's override wins, then the board column's own
 *    title, then a built-in Hebrew label. The last step matters because the report
 *    can be generated from cached settings before `boardMeta` has answered — a
 *    table with blank header cells would look broken.
 *
 * Ordering and merging are rowGrouping's job; blob repair is settingsSchema's.
 * Pure module — no React, no SDK.
 */
import { filterByCommittees } from './committees.js';
import { groupRows } from './rowGrouping.js';
import { TABLE_ROLES, normalizeSettings } from './settingsSchema.js';

/**
 * Last-resort header labels, used when the board's column titles are not (yet)
 * known. Index order matches TABLE_ROLES: index 0 is the RIGHTMOST cell in RTL.
 */
export const DEFAULT_HEADERS = {
  action: 'פעולה',
  committee: 'שם הועדה האזורית',
  report: 'דיווח',
  date: 'תאריך דיווח',
};

/** How the title names each range kind. */
const KIND_LABELS = { daily: 'דוח יומי', weekly: 'דוח שבועי' };

/** '' for null/undefined/objects, trimmed otherwise. */
function str(value) {
  if (value == null || typeof value === 'object') return '';
  return String(value).trim();
}

/**
 * `{ [columnId]: {title, type} }` from boardMeta's `[{id,title,type}]` array or
 * from an already-keyed map. Both shapes reach this module depending on whether
 * the caller kept boardMeta's response or its own index of it.
 */
function columnIndex(columns) {
  if (Array.isArray(columns)) {
    const map = {};
    for (const c of columns) {
      if (c && c.id) map[c.id] = c;
    }
    return map;
  }
  return columns && typeof columns === 'object' ? columns : {};
}

/**
 * The four header strings, in cell order.
 * @returns {string[]}
 */
function resolveHeaders(settings, byId) {
  return TABLE_ROLES.map((role) => {
    const override = str(settings.headers?.[role]);
    if (override) return override;
    const boardTitle = str(byId[settings.columns?.[role]]?.title);
    return boardTitle || DEFAULT_HEADERS[role];
  });
}

/** 'דוח שבועי 26.07.2026 - 01.08.2026' — also safe to reuse as a filename stem. */
function resolveTitle(range) {
  const kindLabel = KIND_LABELS[range?.kind] || 'דוח';
  const label = str(range?.label);
  return label ? `${kindLabel} ${label}` : kindLabel;
}

/**
 * The complete report as data.
 *
 * @param {Object} args
 * @param {Array<{id: string, cv: Object}>} args.items Rows from services/itemsQuery
 *   (already scoped to the reporter and the date range by the server).
 * @param {Object} args.settings The stored settings blob — raw is fine, it is
 *   normalized here.
 * @param {Array<{id: string, title: string, type: string}>|Object} args.columns
 *   The target board's columns (boardMeta), for titles and value types.
 * @param {{kind: string, from: string, to: string, label: string}} args.range
 * @param {string[]|null} [args.selectedCommittees] `null` = no narrowing yet;
 *   `[]` = the user cleared the selection, so the report is deliberately empty.
 * @returns {{blocks: Array<{type: 'text', text: string}|{type: 'table'}>,
 *   table: {headers: string[], rows: Array<Object>}, title: string}}
 */
export function buildReportModel({ items, settings, columns, range, selectedCommittees } = {}) {
  const normalized = normalizeSettings(settings);
  const byId = columnIndex(columns);

  const filtered = filterByCommittees(items, normalized.columns.committee, selectedCommittees);

  const types = {};
  for (const [id, column] of Object.entries(byId)) types[id] = column?.type;

  return {
    // Ids are settings-panel bookkeeping; the renderer only needs type + text.
    blocks: normalized.blocks.map((block) =>
      block.type === 'table' ? { type: 'table' } : { type: 'text', text: block.text }
    ),
    table: {
      headers: resolveHeaders(normalized, byId),
      rows: groupRows(filtered, normalized, types),
    },
    title: resolveTitle(range),
  };
}
