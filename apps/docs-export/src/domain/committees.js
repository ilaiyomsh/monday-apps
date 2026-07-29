/**
 * committees — deriving the regional-committee names from the mapped MIRROR
 * column, and filtering items by them.
 *
 * Two platform facts drive every line here (probe-verified 2026-07-29, API
 * 2026-04, re-checked at 2026-07):
 *
 * 1. **A mirror can never be filtered server-side.** ANY `query_params` rule on a
 *    mirror answers HTTP 200 carrying `InvalidColumnTypeException`
 *    (`actual_type: "lookup"`) AND `data.boards: [null]` — one mirror rule inside
 *    an otherwise-valid `and` group destroys the whole result set. So the
 *    committee filter is client-side, and lives here.
 * 2. **`display_value` cannot be split.** It joins the mirrored values with
 *    ", ", and a SINGLE source value containing ", " (e.g. "Gamma, Delta") is
 *    byte-identical to two values "Gamma" + "Delta". Names therefore come from
 *    the structured `mirrored_items` list; splitting is a last resort that is
 *    provably lossy.
 *
 * The table CELL still renders the full `display_value` (see domain/columnText.js)
 * — the ambiguity only matters when splitting into individual names.
 */

/** The lossy separator. Only used by the last-resort path below. */
const DISPLAY_SEPARATOR = ', ';

/** '' for null/undefined, trimmed otherwise. */
function trimmed(value) {
  return value == null ? '' : String(value).trim();
}

/** Append `name` unless blank or already present (order-preserving dedupe). */
function pushUnique(out, name) {
  if (name && !out.includes(name)) out.push(name);
}

/**
 * The committee names on one item, in the order the mirror reports them.
 *
 * Preference per mirrored item: `mirrored_value.text` → `linked_item.name`.
 * Only when `mirrored_items` produced nothing at all do we fall back to
 * splitting `display_value` — that path CANNOT distinguish one comma-bearing
 * value from two values, so it is a data-loss risk we accept rather than
 * dropping the item out of the report entirely.
 *
 * @param {{cv?: Record<string, object>}} item Item as returned by services/itemsQuery.
 * @param {string} mirrorColumnId `settings.columns.committee`.
 * @returns {string[]} Unique, trimmed names; `[]` when the mirror is empty.
 */
export function committeeNames(item, mirrorColumnId) {
  const cv = item && item.cv ? item.cv[mirrorColumnId] : null;
  if (!cv) return [];

  const names = [];
  if (Array.isArray(cv.mirrored_items)) {
    for (const mi of cv.mirrored_items) {
      if (!mi) continue;
      const fromValue = trimmed(mi.mirrored_value && mi.mirrored_value.text);
      // linked_item.name covers a mirrored source column that is not a
      // TextValue, where the union fragment matches nothing.
      pushUnique(names, fromValue || trimmed(mi.linked_item && mi.linked_item.name));
    }
    if (names.length) return names;
  }

  // Last resort. Reached when mirrored_items was not selected, or when every
  // entry was unusable — an item with a non-empty display_value must still be
  // filterable, even at the cost of possibly over-splitting one name.
  const display = trimmed(cv.display_value);
  if (!display) return [];
  for (const part of display.split(DISPLAY_SEPARATOR)) pushUnique(names, trimmed(part));
  return names;
}

/**
 * Every committee present in the fetched items — the options the user picks from.
 *
 * FIRST-APPEARANCE order, deliberately not alphabetical: it mirrors the board's
 * own order and needs no locale collation for Hebrew.
 *
 * @param {object[]} items
 * @param {string} mirrorColumnId
 * @returns {string[]}
 */
export function committeesFromItems(items, mirrorColumnId) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    for (const name of committeeNames(item, mirrorColumnId)) pushUnique(out, name);
  }
  return out;
}

/**
 * The items belonging to at least one of the selected committees.
 *
 * Selection semantics, deliberately asymmetric:
 * - `null`/`undefined` (not specified) → NO filtering, every item passes.
 * - `[]` (explicitly nothing chosen) → NO items. The alternative — treating an
 *   empty choice as "all" — would silently put other committees' rows into a
 *   report the user believes is narrowed.
 *
 * Matching is exact after trimming: a partial name is a different committee
 * (crucially, "Gamma" is NOT the committee named "Gamma, Delta").
 *
 * @param {object[]} items
 * @param {string} mirrorColumnId
 * @param {string[]} [selected]
 * @returns {object[]} The same item objects, in the input order.
 */
export function filterByCommittees(items, mirrorColumnId, selected) {
  const list = Array.isArray(items) ? items : [];
  if (selected == null) return list.slice();

  const wanted = new Set(
    (Array.isArray(selected) ? selected : [selected]).map(trimmed).filter(Boolean)
  );
  if (wanted.size === 0) return [];

  return list.filter((item) => committeeNames(item, mirrorColumnId).some((n) => wanted.has(n)));
}
