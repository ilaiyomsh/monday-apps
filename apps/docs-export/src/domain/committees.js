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
 * The committee names on one item, from `display_value` split on ", ".
 *
 * ONE source, deliberately (owner's call, 2026-07-29). `display_value` is the text
 * monday itself renders in the mirror cell, so it is always the mirrored VALUES and
 * always matches what the user sees on the board.
 *
 * **What was here before, and why it is gone.** The first implementation preferred
 * `mirrored_items[].mirrored_value.text` and fell back to `linked_item.name`. That
 * shipped a real bug: `mirrored_value` is the `MirroredValue` UNION and only
 * `TextValue` is a probe-confirmed member, so a mirror whose source column is a
 * status/dropdown — very common, it renders as a chip — matched no fragment, and
 * every name silently became the LINKED ITEM'S TITLE. The committee picker offered
 * task names like "הכנת תוכנית מפורטת לפרויקט" where the committees
 * "אדריכלות"/"תכנון עירוני" belonged. Never reintroduce `linked_item.name` as a
 * name source; it is a different field with a plausible-looking wrong value.
 *
 * **The accepted trade-off.** A single committee name that itself contains ", " is
 * byte-identical to two names and will split into two. That is knowingly accepted:
 * the alternative needed `mirrored_items` on every query (~+8 complexity per 4 rows)
 * plus a union-membership probe, to defend against a separator inside a committee
 * name. If such a name ever appears, the fix is to widen the `mirrored_value`
 * selection in domain/columnText.js — PROBE the union's members first (sandbox
 * 16291824), because an inline fragment on a non-member invalidates the whole query.
 *
 * @param {{cv?: Record<string, object>}} item Item as returned by services/itemsQuery.
 * @param {string} mirrorColumnId `settings.columns.committee`.
 * @returns {string[]} Unique, trimmed names; `[]` when the mirror is empty.
 */
export function committeeNames(item, mirrorColumnId) {
  const cv = item && item.cv ? item.cv[mirrorColumnId] : null;
  if (!cv) return [];

  // MirrorValue.display_value is String! and never null — empty is '' (probe-verified
  // 2026-07-29). `text` and `value` ARE null on a mirror, so neither is a substitute.
  const display = trimmed(cv.display_value);
  if (!display) return [];

  const names = [];
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
