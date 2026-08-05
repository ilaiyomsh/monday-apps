import { describe, expect, it } from 'vitest';
import { committeeNames, committeesFromItems, filterByCommittees } from '../committees.js';

// All mirror shapes below are VERBATIM captures from the live probe of
// 2026-07-29 (API 2026-04), scratchpad/monday-probe-findings.md → FIXTURES.
//
// The module reads `display_value` and NOTHING else (owner's call, 2026-07-29), so
// these fixtures keep their captured `mirrored_items` on purpose: they prove the
// implementation ignores that structure even when it is present and says something
// different. In particular MIRROR_WRONG_LINK_NAME is the regression guard for the
// bug that shipped — `linked_item.name` being read as if it were the mirrored value,
// which filled the committee picker with linked TASK titles instead of committees.
//
// The comma trade-off is deliberate and asserted below: MIRROR_AMBIGUOUS (ONE source
// value containing ", ") and MIRROR_TWO_VALUES (two values) have a byte-identical
// display_value, so both now yield TWO names. That is knowingly accepted — see the
// docblock in ../committees.js for what buying the exact answer back would cost.

const COL = 'wzmirror';

const mirror = (display_value, mirrored_items) => ({
  id: COL,
  type: 'mirror',
  text: null,
  value: null,
  display_value,
  mirrored_items,
});

const link = (id, name, text) => ({
  linked_board_id: '18424252630',
  linked_item: { id, name },
  mirrored_value: text === undefined ? null : { id: 'srctext', text, value: JSON.stringify(text) },
});

const MIRROR_SINGLE = mirror('Alpha', [link('12660747977', 'WZ-S1', 'Alpha')]);
const MIRROR_MULTI = mirror('Alpha, Beta', [
  link('12660747977', 'WZ-S1', 'Alpha'),
  link('12660747980', 'WZ-S2', 'Beta'),
]);
const MIRROR_EMPTY = mirror('', []);
/** ONE source value that itself contains ", " (probe item WZ-R4). */
const MIRROR_AMBIGUOUS = mirror('Gamma, Delta', [link('12660747982', 'WZ-S3', 'Gamma, Delta')]);
/** TWO source values whose display_value is byte-identical to the above. */
const MIRROR_TWO_VALUES = mirror('Gamma, Delta', [
  link('12660747990', 'WZ-S4', 'Gamma'),
  link('12660747991', 'WZ-S5', 'Delta'),
]);
/**
 * THE REGRESSION GUARD. A mirror whose source column is a status/dropdown returns no
 * `mirrored_value.text` (only TextValue is a member of the MirroredValue union), while
 * `linked_item.name` holds the linked ITEM'S TITLE. The first implementation read that
 * title as the committee name and the picker offered task names — exactly what a user
 * hit in production. display_value is the truth here.
 */
const MIRROR_WRONG_LINK_NAME = mirror('אדריכלות', [
  link('12660747999', 'הכנת תוכנית מפורטת לפרויקט', undefined),
]);

const item = (id, cvForMirror) => ({ id, name: `item-${id}`, cv: { [COL]: cvForMirror } });

describe('committeeNames', () => {
  it('reads one name from a single-valued mirror', () => {
    expect(committeeNames(item('1', MIRROR_SINGLE), COL)).toEqual(['Alpha']);
  });

  it('reads both names from a multi-valued mirror', () => {
    expect(committeeNames(item('1', MIRROR_MULTI), COL)).toEqual(['Alpha', 'Beta']);
  });

  it('ACCEPTED TRADE-OFF: splits a single source value that contains ", " into two names', () => {
    // Not a bug — a documented cost of reading display_value only. Pinned so that if
    // someone "fixes" it they have to read the docblock and decide deliberately.
    expect(committeeNames(item('1', MIRROR_AMBIGUOUS), COL)).toEqual(['Gamma', 'Delta']);
  });

  it('cannot distinguish one comma-bearing value from two — both give the same names', () => {
    const one = item('1', MIRROR_AMBIGUOUS);
    const two = item('2', MIRROR_TWO_VALUES);
    expect(one.cv[COL].display_value).toBe(two.cv[COL].display_value); // guards the fixtures
    // Identical input text, identical output. Buying the exact answer back needs
    // mirrored_items on every query PLUS a union-membership probe.
    expect(committeeNames(one, COL)).toEqual(['Gamma', 'Delta']);
    expect(committeeNames(two, COL)).toEqual(['Gamma', 'Delta']);
  });

  it('returns an empty list for an empty mirror', () => {
    expect(committeeNames(item('1', MIRROR_EMPTY), COL)).toEqual([]);
  });

  it('returns an empty list when the item has no value for that column', () => {
    expect(committeeNames({ id: '1', name: 'x', cv: {} }, COL)).toEqual([]);
  });

  it('returns an empty list for a malformed item', () => {
    expect(committeeNames(undefined, COL)).toEqual([]);
    expect(committeeNames(null, COL)).toEqual([]);
    expect(committeeNames({ id: '1' }, COL)).toEqual([]);
  });

  it('NEVER reads linked_item.name — the production bug this module shipped', () => {
    // The mirror displays "אדריכלות"; the linked item is titled
    // "הכנת תוכנית מפורטת לפרויקט". Reading the title produced a picker full of task
    // names. Only display_value is the committee.
    expect(committeeNames(item('1', MIRROR_WRONG_LINK_NAME), COL)).toEqual(['אדריכלות']);
  });

  it('ignores mirrored_items entirely, even when it disagrees with display_value', () => {
    // Belt-and-braces on the same rule: no structured field may override the cell text.
    const cv = mirror('ועדת הצפון', [link('1', 'שם אייטם אחר לגמרי', 'טקסט אחר לגמרי')]);
    expect(committeeNames(item('1', cv), COL)).toEqual(['ועדת הצפון']);
  });

  it('is empty when display_value is empty, whatever mirrored_items holds', () => {
    // The old code would have answered ['ועדת הדרום'] here, from the link title.
    const cv = mirror('', [link('1', 'ועדת הדרום', '')]);
    expect(committeeNames(item('1', cv), COL)).toEqual([]);
  });

  it('trims surrounding whitespace off every name', () => {
    expect(committeeNames(item('1', mirror('  ועדה א  ', [])), COL)).toEqual(['ועדה א']);
    expect(committeeNames(item('1', mirror('ועדה א ,  ועדה ב', [])), COL)).toEqual([
      'ועדה א',
      'ועדה ב',
    ]);
  });

  it('de-duplicates a name repeated inside one item', () => {
    expect(committeeNames(item('1', mirror('Alpha, Alpha', [])), COL)).toEqual(['Alpha']);
  });

  it('reads display_value when mirrored_items was not selected at all', () => {
    // The shape the query actually returns now: display_value and nothing else.
    const cv = { id: COL, type: 'mirror', text: null, value: null, display_value: 'Alpha, Beta' };
    expect(committeeNames(item('1', cv), COL)).toEqual(['Alpha', 'Beta']);
  });

  it('returns an empty list when neither mirrored_items nor display_value carry anything', () => {
    expect(committeeNames(item('1', { id: COL, type: 'mirror', display_value: '' }), COL)).toEqual([]);
  });

  it('drops empty fragments produced by the display_value fallback', () => {
    const cv = { id: COL, type: 'mirror', display_value: 'Alpha, , Beta' };
    expect(committeeNames(item('1', cv), COL)).toEqual(['Alpha', 'Beta']);
  });
});

describe('committeesFromItems', () => {
  it('collects every committee once, in first-appearance order', () => {
    const items = [
      item('1', MIRROR_MULTI), // Alpha, Beta
      item('2', MIRROR_SINGLE), // Alpha (already seen)
      item('3', MIRROR_AMBIGUOUS), // "Gamma, Delta" -> two names, per the trade-off
    ];
    expect(committeesFromItems(items, COL)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('does not sort the committees alphabetically', () => {
    const items = [item('1', mirror('ת', [link('1', 'a', 'ת')])), item('2', mirror('א', [link('2', 'b', 'א')]))];
    expect(committeesFromItems(items, COL)).toEqual(['ת', 'א']);
  });

  it('skips items with an empty mirror', () => {
    expect(committeesFromItems([item('1', MIRROR_EMPTY), item('2', MIRROR_SINGLE)], COL)).toEqual([
      'Alpha',
    ]);
  });

  it('returns an empty list for no items', () => {
    expect(committeesFromItems([], COL)).toEqual([]);
    expect(committeesFromItems(undefined, COL)).toEqual([]);
  });
});

describe('filterByCommittees', () => {
  const items = [
    item('1', MIRROR_SINGLE), // Alpha
    item('2', MIRROR_MULTI), // Alpha, Beta
    item('3', MIRROR_AMBIGUOUS), // display_value "Gamma, Delta" -> committees Gamma + Delta
    item('4', MIRROR_EMPTY), // no committee at all
  ];

  it('keeps only the items carrying a selected committee', () => {
    expect(filterByCommittees(items, COL, ['Beta']).map((i) => i.id)).toEqual(['2']);
  });

  it('keeps an item when ANY of its committees is selected', () => {
    expect(filterByCommittees(items, COL, ['Alpha']).map((i) => i.id)).toEqual(['1', '2']);
  });

  it('unions several selected committees without duplicating an item', () => {
    expect(filterByCommittees(items, COL, ['Alpha', 'Beta']).map((i) => i.id)).toEqual(['1', '2']);
  });

  it('matches on each half of a comma-bearing display_value, per the trade-off', () => {
    // Item 3's display_value is "Gamma, Delta", which becomes two committees. Selecting
    // either one matches it, and the un-split whole matches NOTHING — there is no
    // committee by that name any more. Pinned so the consequence is visible, not implied.
    expect(filterByCommittees(items, COL, ['Gamma']).map((i) => i.id)).toEqual(['3']);
    expect(filterByCommittees(items, COL, ['Delta']).map((i) => i.id)).toEqual(['3']);
    expect(filterByCommittees(items, COL, ['Gamma, Delta'])).toEqual([]);
  });

  it('drops items with no committee at all', () => {
    expect(filterByCommittees(items, COL, ['Alpha', 'Beta', 'Gamma']).map((i) => i.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('preserves the input order of the surviving items', () => {
    const reordered = [items[2], items[1], items[0]];
    expect(filterByCommittees(reordered, COL, ['Alpha', 'Gamma']).map((i) => i.id)).toEqual([
      '3',
      '2',
      '1',
    ]);
  });

  it('returns the very same item objects, not copies', () => {
    expect(filterByCommittees(items, COL, ['Beta'])[0]).toBe(items[1]);
  });

  it('returns NOTHING for an explicitly empty selection', () => {
    // "no committee chosen" must never silently widen the report to every
    // committee the reporter can see.
    expect(filterByCommittees(items, COL, [])).toEqual([]);
  });

  it('applies no filter at all when the selection is not specified', () => {
    expect(filterByCommittees(items, COL, null).map((i) => i.id)).toEqual(['1', '2', '3', '4']);
    expect(filterByCommittees(items, COL).map((i) => i.id)).toEqual(['1', '2', '3', '4']);
  });

  it('ignores blank entries in the selection', () => {
    expect(filterByCommittees(items, COL, ['', '   ']).map((i) => i.id)).toEqual([]);
    expect(filterByCommittees(items, COL, ['  Beta  ']).map((i) => i.id)).toEqual(['2']);
  });

  it('matches exactly — a differently-cased or partial name is not the committee', () => {
    expect(filterByCommittees(items, COL, ['alpha'])).toEqual([]);
    expect(filterByCommittees(items, COL, ['Alph'])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [...items];
    filterByCommittees(input, COL, ['Alpha']);
    expect(input).toHaveLength(4);
    expect(input.map((i) => i.id)).toEqual(['1', '2', '3', '4']);
  });

  it('returns an empty list for no items', () => {
    expect(filterByCommittees([], COL, ['Alpha'])).toEqual([]);
    expect(filterByCommittees(undefined, COL, ['Alpha'])).toEqual([]);
  });
});
