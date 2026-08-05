/**
 * Every GraphQL document this app sends — three reads, no writes.
 *
 * @module services/queries
 *
 * Rules, each earned from a live probe (2026-07-29, API 2026-04; re-checked at
 * 2026-07 and 2025-04 with identical behaviour):
 *
 *  - `$variables` ONLY. Interpolation is how `ids: [undefined]` reaches the wire
 *    and comes back as an innocent-looking empty result.
 *  - A **mirror** is read through `display_value` AND `mirrored_items`.
 *    `text`/`value` are ALWAYS null on MirrorValue, and `display_value` alone is
 *    ambiguous: a single source value containing ", " (e.g. "Gamma, Delta") is
 *    byte-identical to two values "Gamma" + "Delta", so splitting the string
 *    cannot recover the committee list. `mirrored_items` is the only unambiguous
 *    source. Cost measured at ~+8 complexity over 4 rows, scaling with the number
 *    of LINKS — acceptable for a daily/weekly range.
 *  - A mirror is NEVER allowed into `query_params` (see services/itemsQuery.js).
 *  - `next_items_page` is a **ROOT** field. Nesting it under `boards` is a schema
 *    error; forgetting it is the classic "only the first 500 rows" bug.
 *  - `boards(ids:)` takes `[ID!]`, `column_values(ids:)` takes `[String!]`.
 */

/*
 * The `column_values { … }` SELECTION is NOT built here: it comes from
 * `domain/columnText.js` → `cvSelection(types)`, the same module that renders
 * those values into table cells. That pairing is deliberate — a typed field the
 * renderer reads but the query never selected (timeline's from/to is the live
 * example) produces a silently empty cell, so the fragment table and the reader
 * must never be able to drift apart. These documents take the finished selection
 * as a parameter and only own the SHAPE of the request.
 */

/** Board name + every column's id/title/type — drives the settings column pickers. */
export const BOARD_META_QUERY = `query DocsExportBoardMeta($boardId: [ID!]) {
  boards(ids: $boardId) {
    id
    name
    columns { id title type }
  }
}`;

/**
 * Board owners. A board_view context carries no permissions, so the owner-only
 * settings gate has to ask the API.
 */
export const BOARD_OWNERS_QUERY = `query DocsExportBoardOwners($boardId: [ID!]) {
  boards(ids: $boardId) {
    id
    owners { id }
  }
}`;

/**
 * First page of the range query: the two server-side rules live in `$qp`.
 * @param {string} cvFields - the column_values selection (see cvSelection)
 * @returns {string}
 */
export function rangeItemsQuery(cvFields) {
  return `query DocsExportRangeItems($boardId: [ID!], $limit: Int!, $qp: ItemsQuery!, $ids: [String!]) {
  boards(ids: $boardId) {
    items_page(limit: $limit, query_params: $qp) {
      cursor
      items {
        id
        name
        column_values(ids: $ids) { ${cvFields} }
      }
    }
  }
}`;
}

/**
 * Continuation page. `next_items_page` is a ROOT field and carries the filter
 * inside the cursor — passing `query_params` again is rejected.
 * @param {string} cvFields - the column_values selection (see cvSelection)
 * @returns {string}
 */
export function nextItemsQuery(cvFields) {
  return `query DocsExportNextRangeItems($cursor: String!, $limit: Int!, $ids: [String!]) {
  next_items_page(cursor: $cursor, limit: $limit) {
    cursor
    items {
      id
      name
      column_values(ids: $ids) { ${cvFields} }
    }
  }
}`;
}
