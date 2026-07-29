import { describe, expect, it } from 'vitest';
import { committeeNames, committeesFromItems, filterByCommittees } from '../committees.js';

// All mirror shapes below are VERBATIM captures from the live probe of
// 2026-07-29 (API 2026-04), scratchpad/monday-probe-findings.md → FIXTURES.
// The pair that matters most is MIRROR_AMBIGUOUS vs MIRROR_TWO_VALUES: their
// display_value is byte-identical ("Gamma, Delta"), yet one is ONE committee and
// the other is TWO. That is why display_value.split(', ') is banned.

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

const item = (id, cvForMirror) => ({ id, name: `item-${id}`, cv: { [COL]: cvForMirror } });

describe('committeeNames', () => {
  it('reads one name from a single-valued mirror', () => {
    expect(committeeNames(item('1', MIRROR_SINGLE), COL)).toEqual(['Alpha']);
  });

  it('reads both names from a multi-valued mirror', () => {
    expect(committeeNames(item('1', MIRROR_MULTI), COL)).toEqual(['Alpha', 'Beta']);
  });

  it('keeps ONE name when a single source value contains ", "', () => {
    // The whole reason this module exists.
    expect(committeeNames(item('1', MIRROR_AMBIGUOUS), COL)).toEqual(['Gamma, Delta']);
  });

  it('distinguishes one comma-bearing value from two values with the same display_value', () => {
    const one = item('1', MIRROR_AMBIGUOUS);
    const two = item('2', MIRROR_TWO_VALUES);
    expect(one.cv[COL].display_value).toBe(two.cv[COL].display_value); // guards the fixtures
    expect(committeeNames(one, COL)).toEqual(['Gamma, Delta']);
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

  it('falls back to the linked item name when the mirrored value carries no text', () => {
    // Happens when the mirrored source column is not a TextValue, so the
    // union fragment matches nothing.
    expect(committeeNames(item('1', mirror('WZ-S1', [link('1', 'ועדת הצפון', undefined)])), COL)).toEqual(
      ['ועדת הצפון']
    );
  });

  it('falls back to the linked item name when the mirrored value text is empty', () => {
    expect(committeeNames(item('1', mirror('x', [link('1', 'ועדת הדרום', '')])), COL)).toEqual([
      'ועדת הדרום',
    ]);
  });

  it('trims surrounding whitespace off every name', () => {
    expect(committeeNames(item('1', mirror('a, b', [link('1', 'X', '  ועדה א  ')])), COL)).toEqual([
      'ועדה א',
    ]);
  });

  it('drops entries that carry neither a mirrored text nor a linked item name', () => {
    const cv = mirror('Alpha', [
      { linked_board_id: 'b', linked_item: null, mirrored_value: null },
      link('2', 'WZ-S2', 'Alpha'),
    ]);
    expect(committeeNames(item('1', cv), COL)).toEqual(['Alpha']);
  });

  it('de-duplicates a name repeated inside one item', () => {
    const cv = mirror('Alpha, Alpha', [link('1', 'a', 'Alpha'), link('2', 'b', 'Alpha')]);
    expect(committeeNames(item('1', cv), COL)).toEqual(['Alpha']);
  });

  it('splits display_value only when mirrored_items was not selected at all', () => {
    // The lossy last resort: an "Alpha, Beta" here could really be one value.
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
      item('3', MIRROR_AMBIGUOUS), // Gamma, Delta (one name)
    ];
    expect(committeesFromItems(items, COL)).toEqual(['Alpha', 'Beta', 'Gamma, Delta']);
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
    item('3', MIRROR_AMBIGUOUS), // "Gamma, Delta" as ONE committee
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

  it('does NOT match a fragment of a committee whose own name contains ", "', () => {
    // Item 3's single committee is "Gamma, Delta"; "Gamma" is not that committee.
    expect(filterByCommittees(items, COL, ['Gamma'])).toEqual([]);
    expect(filterByCommittees(items, COL, ['Gamma, Delta']).map((i) => i.id)).toEqual(['3']);
  });

  it('drops items with no committee at all', () => {
    expect(filterByCommittees(items, COL, ['Alpha', 'Beta', 'Gamma, Delta']).map((i) => i.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('preserves the input order of the surviving items', () => {
    const reordered = [items[2], items[1], items[0]];
    expect(filterByCommittees(reordered, COL, ['Alpha', 'Gamma, Delta']).map((i) => i.id)).toEqual([
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
