/**
 * columnText — the GraphQL selection for a column value, and the plain-text
 * rendering of one.
 *
 * Every cell of the exported table is plain text, so this module is the single
 * place that knows how monday hands each column type back. Two rules learned the
 * hard way (probe-verified 2026-07-14 / 07-28 / 07-29, API 2026-04):
 *
 * - The relation family (`mirror`, `formula`, `board_relation`) returns `text`
 *   and `value` as **null**; the value only exists on the typed inline fragment.
 *   Reading `cv.text` for those types yields a silently empty cell.
 * - "Empty" is not uniform: an unset date is `""`, an unset mirror's
 *   `display_value` is `""` (the field is `String!`, never null), an unset status
 *   is `null`, and an unset people column is `""`.
 *
 * Anything unknown degrades to `cv.text` rather than guessing a fragment: an
 * invented inline fragment is a hard `UNAUTHORIZED_FIELD_OR_TYPE` that kills the
 * whole query, which is far worse than one weakly-rendered cell.
 */

/**
 * Typed inline fragments, keyed by column type. Types absent from this map are
 * served by the interface field `text` alone (status, dropdown, text, long_text,
 * numbers …) — selecting nothing extra keeps the query's complexity down.
 *
 * `mirror` selects `display_value` ONLY (owner's call, 2026-07-29).
 *
 * `mirrored_items { … mirrored_value { … } }` was here and has been removed. It cost
 * ~+8 complexity on every query and, worse, it did not work for the common case:
 * `mirrored_value` is the `MirroredValue` UNION with only `TextValue` probe-confirmed
 * as a member, so a mirror over a status/dropdown source (it renders as a chip)
 * matched no fragment and returned nothing — which then drove a fallback that read
 * the LINKED ITEM'S TITLE as if it were the mirrored value. See
 * domain/committees.js for the full account.
 *
 * `display_value` is what monday renders in the cell, so it always matches the board.
 * The one accepted cost is that a committee name containing ", " cannot be told apart
 * from two names when split. If that ever matters, re-add a `mirrored_value`
 * selection — but PROBE the union's membership first (sandbox 16291824): an inline
 * fragment on a non-member invalidates the entire query.
 */
const TYPE_FRAGMENTS = {
  date: '... on DateValue { date time }',
  people: '... on PeopleValue { persons_and_teams { id kind } text }',
  // 'person' is this app's ROLE name, not a monday column type — accepted so a
  // role list can be passed straight through without a translation step.
  person: '... on PeopleValue { persons_and_teams { id kind } text }',
  checkbox: '... on CheckboxValue { checked }',
  mirror: '... on MirrorValue { display_value }',
  formula: '... on FormulaValue { display_value }',
  board_relation: '... on BoardRelationValue { display_value linked_item_ids }',
  timeline: '... on TimelineValue { from to }',
};

/** '' for null/undefined, the trimmed-of-nothing string otherwise. Never null. */
function str(value) {
  return value == null ? '' : String(value);
}

/**
 * The leanest `column_values { … }` selection covering the given column types.
 *
 * @param {string[]} [types] Column types (duplicates and nullish entries are fine).
 * @returns {string} e.g. `id text ... on DateValue { date time }`
 */
export function cvSelection(types) {
  const list = Array.isArray(types) ? types : [];
  const frags = [];
  for (const type of list) {
    const frag = TYPE_FRAGMENTS[type];
    // Dedupe on the FRAGMENT, not the type: 'people' and 'person' share one.
    if (frag && !frags.includes(frag)) frags.push(frag);
  }
  return ['id', 'text', ...frags].join(' ');
}

/**
 * Render one column value as the plain text that goes into a table cell.
 *
 * @param {string} type monday column type (`settings.columns` role types).
 * @param {object} [cv] One entry of the item's `column_values`, or undefined
 *   when the item never had that column.
 * @returns {string} Always a string — '' when empty, NEVER null/undefined.
 */
export function columnText(type, cv) {
  if (!cv) return '';

  switch (type) {
    // A mirror's cell shows the FULL display_value, ambiguity and all — the
    // ambiguity only matters when splitting into names, never when displaying.
    case 'mirror':
      return str(cv.display_value);

    case 'formula':
      return str(cv.display_value ?? cv.text);

    case 'board_relation':
      return str(cv.display_value ?? cv.text);

    case 'date': {
      // DateValue.date is already in the account timezone — do NOT convert.
      const date = str(cv.date) || str(cv.text);
      if (!date) return '';
      // monday usually strips the seconds on read ("00:30"), but not always.
      const time = str(cv.time).slice(0, 5);
      return time ? `${date} ${time}` : date;
    }

    case 'timeline': {
      // from/to are FULL ISO timestamps on read ("2026-07-01T00:00:00+00:00"),
      // not the YYYY-MM-DD the write format uses.
      const from = str(cv.from).slice(0, 10);
      const to = str(cv.to).slice(0, 10);
      if (from && to) return `${from} - ${to}`;
      return from || to || str(cv.text);
    }

    case 'numbers': {
      // monday returns numbers as a STRING in `text`; `number` is the typed
      // field. Test for null, not truthiness — 0 is a real value.
      const text = str(cv.text);
      if (text) return text;
      return cv.number == null ? '' : String(cv.number);
    }

    case 'checkbox':
      // Strictly `true`: monday's write payload uses the STRING "false" to mean
      // unchecked, and a truthy 'false' would render every row as checked.
      return cv.checked === true ? 'כן' : '';

    case 'people':
    case 'person':
      // Unlike the relation family, PeopleValue.text IS populated (the joined
      // display names) — and it is '' rather than null when unassigned.
      return str(cv.text);

    case 'text':
    case 'long_text':
    case 'status':
    case 'dropdown':
    default:
      return str(cv.text);
  }
}
