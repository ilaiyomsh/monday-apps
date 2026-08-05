/**
 * The ONE query the whole interaction runs: every item in the chosen range that
 * the CURRENT USER appears in, filtered server-side, drained across pages.
 *
 * @module services/itemsQuery
 *
 * Two rules go to the server (`operator: and`, a true conjunction — and the
 * default): `date between [from,to]` and `people any_of ["person-<userId>"]`.
 * Everything after that — the committee list, the committee filter, sorting,
 * merging, the .docx — is client-side work over the returned rows. Zero further
 * API calls.
 *
 * The guards below all defend against LIVE-PROBED silent failures (2026-07-29).
 * Each of these returns zero rows with NO GraphQL error, i.e. it is
 * indistinguishable from "this reporter has nothing to report today":
 *   - a one-element `compare_value` (`["d"]`) or a bare scalar;
 *   - a REVERSED range (`[end, start]`);
 *   - a non-ISO date (`"20/07/2026"`);
 *   - a bare numeric user id — the `person-<id>` prefix is MANDATORY, as a string
 *     AND as a number the unprefixed form matches nothing.
 * And one that is worse than silent: a **mirror** column anywhere in
 * `query_params` returns HTTP 200 carrying `InvalidColumnTypeException`
 * (`actual_type: "lookup"`) with `data.boards: [null]` — it does not filter badly,
 * it wipes the entire result set. That is why the committee filter is client-side
 * and why this module refuses to build a rule on a mirror at all.
 */
import { api } from './monday-client.js';
import { rangeItemsQuery, nextItemsQuery } from './queries.js';
// The column_values SELECTION comes from the same module that RENDERS those
// values (domain/columnText.js). Keeping them together is deliberate: a type the
// renderer reads from a typed field (e.g. timeline's from/to) but the query never
// selected renders as a silently empty cell, and that is exactly the drift a
// second fragment table produces.
import { cvSelection } from '../domain/columnText.js';
import logger from '../utils/logger.js';

/** monday's per-page maximum for items_page. */
export const PAGE_LIMIT = 500;

/**
 * Hard stop on the cursor drain: 20 pages × 500 = 10k rows, far beyond any
 * daily/weekly personal report. Hitting it means something is wrong with the
 * filter, and the report would be TRUNCATED — so it is logged loudly, never
 * silently returned as if complete.
 */
export const MAX_PAGES = 20;

/** monday's mirror columns report as `lookup` internally; both spellings occur. */
const MIRROR_TYPES = new Set(['mirror', 'lookup']);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A strict ISO calendar date. The regex alone would accept 2026-13-45, which
 * monday answers with zero rows and no error, so the value must also round-trip
 * through Date.
 * @param {string} value
 * @returns {boolean}
 */
function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertRangeDate(label, value) {
  if (!isIsoDate(value)) {
    throw new Error(
      `fetchRangeItems: ${label} "${value}" is not a strict YYYY-MM-DD calendar date — ` +
        'monday silently returns ZERO rows (no error) for any other format.'
    );
  }
}

/**
 * Build the `query_params` for the range read — exactly the payload verified live.
 *
 * A single day is expressed as the SAME date twice (`["d","d"]`), which is the
 * form that works; `between` is inclusive of BOTH endpoints.
 *
 * @param {Object} args
 * @param {string} args.dateColumnId
 * @param {string} args.personColumnId
 * @param {string|number} args.userId
 * @param {string} args.from - YYYY-MM-DD
 * @param {string} args.to - YYYY-MM-DD (>= from)
 * @returns {{operator: 'and', rules: Array<Object>}}
 */
export function buildRangeQueryParams({ dateColumnId, personColumnId, userId, from, to }) {
  if (!dateColumnId) {
    throw new Error('fetchRangeItems: dateColumnId is not mapped — map the date column in settings.');
  }
  if (!personColumnId) {
    throw new Error(
      'fetchRangeItems: personColumnId is not mapped — map the people column in settings.'
    );
  }
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    throw new Error(
      'fetchRangeItems: userId is required — without it the personal scope would silently widen ' +
        'to the whole board.'
    );
  }
  assertRangeDate('from', from);
  assertRangeDate('to', to);
  if (from > to) {
    throw new Error(
      `fetchRangeItems: the range "${from}".."${to}" is reversed — monday returns zero rows ` +
        'for a reversed between range, with no error.'
    );
  }

  return {
    operator: 'and',
    rules: [
      { column_id: dateColumnId, compare_value: [from, to], operator: 'between' },
      // The "person-" prefix is MANDATORY: a bare id matches nothing, silently.
      { column_id: personColumnId, compare_value: [`person-${userId}`], operator: 'any_of' },
    ],
  };
}

/** Turn one raw item into the app shape: { id, name, cv: { [columnId]: rawValue } }. */
function normalizeItem(raw) {
  const cv = {};
  for (const value of raw?.column_values || []) {
    if (value?.id) cv[value.id] = value;
  }
  return { id: String(raw?.id ?? ''), name: raw?.name ?? '', cv };
}

/**
 * Fetch every item in the range that the given user appears in.
 *
 * @param {Object} args
 * @param {string|number} args.boardId - the TARGET board from settings
 * @param {string} args.dateColumnId - the mapped date column (filter + table col 4)
 * @param {string} args.personColumnId - the mapped people column (personal scope)
 * @param {string|number} args.userId - the CURRENT user
 * @param {string} args.from - YYYY-MM-DD, inclusive
 * @param {string} args.to - YYYY-MM-DD, inclusive
 * @param {Array<{id: string, type: string}>} args.columns - the columns to SELECT
 *   (all four table roles + the people column); their types drive the fragments
 * @returns {Promise<Array<{id: string, name: string, cv: Object}>>}
 */
export async function fetchRangeItems({
  boardId,
  dateColumnId,
  personColumnId,
  userId,
  from,
  to,
  columns,
}) {
  if (boardId === undefined || boardId === null || String(boardId).trim() === '') {
    throw new Error('fetchRangeItems: boardId is required — map the target board in settings.');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(
      'fetchRangeItems: columns must be a non-empty array of { id, type } — without it the ' +
        'report would be built from an empty column selection.'
    );
  }

  const typeById = new Map(columns.filter((c) => c?.id).map((c) => [c.id, c.type]));
  for (const [label, columnId] of [
    ['dateColumnId', dateColumnId],
    ['personColumnId', personColumnId],
  ]) {
    if (MIRROR_TYPES.has(typeById.get(columnId))) {
      throw new Error(
        `fetchRangeItems: refusing to filter on the mirror column "${columnId}" (${label}) — ` +
          'a mirror rule in query_params raises InvalidColumnTypeException and nulls the whole ' +
          'board node, wiping every row. Filter mirrors client-side.'
      );
    }
  }

  const qp = buildRangeQueryParams({ dateColumnId, personColumnId, userId, from, to });

  const ids = [...new Set(columns.map((c) => c?.id).filter(Boolean))];
  const cvFields = cvSelection(columns.map((c) => c?.type));

  const items = [];
  let cursor = null;
  let page = 0;

  do {
    const data = cursor
      ? await api(
          nextItemsQuery(cvFields),
          { cursor, limit: PAGE_LIMIT, ids },
          'fetchRangeItems'
        )
      : await api(
          rangeItemsQuery(cvFields),
          { boardId: [String(boardId)], limit: PAGE_LIMIT, qp, ids },
          'fetchRangeItems'
        );
    page += 1;

    let pageData;
    if (cursor) {
      pageData = data?.next_items_page;
      if (!pageData) {
        // The first page already succeeded, so this is a platform anomaly rather
        // than a caller bug. Stop, but say so — a short report must never pass
        // for a complete one.
        logger.warn(
          'itemsQuery',
          'המשך העימוד חזר ריק (next_items_page חסר) — הדוח עשוי להיות חלקי',
          { boardId: String(boardId), page }
        );
        break;
      }
    } else {
      // `data.boards: [null]` is what an InvalidColumnTypeException inside a 200
      // response looks like; `boards: []` is a deleted or unreachable board.
      // Either way this is a failure, not an empty report.
      pageData = data?.boards?.[0]?.items_page;
      if (!data?.boards?.[0] || !pageData) {
        throw new Error(
          `fetchRangeItems: monday returned a null board node for boardId "${boardId}" — the ` +
            'board is unreachable, or a rule in query_params raised InvalidColumnTypeException ' +
            '(which nulls the entire board node).'
        );
      }
    }

    for (const raw of pageData.items || []) items.push(normalizeItem(raw));
    cursor = pageData.cursor || null;

    if (cursor && page >= MAX_PAGES) {
      logger.warn(
        'itemsQuery',
        `הדוח נקטע: נעצרנו ב-MAX_PAGES (${MAX_PAGES} עמודים) והשרת עוד הציע עמוד נוסף`,
        { boardId: String(boardId), fetched: items.length, from, to }
      );
      break;
    }
  } while (cursor);

  return items;
}
