import { describe, it, expect } from 'vitest';
import { sortTasks, customFilterDims } from '../controls/controls.js';
import { groupTabTasks } from '../grouping.js';

/*
 * round373 — sort and group over a CUSTOM column. Both engines dispatched on a
 * fixed set of column keys, so an owner-added `custom<N>ID` could be filtered and
 * hidden (round366) but never sorted or grouped. These tests pin the generic
 * branch that closes that gap for every drivable type.
 */

/*
 * The DISPLAY order here is deliberately the REVERSE of the alphabetical order
 * (display: תקוע → טרם החל → בעבודה; alphabet: בעבודה → טרם החל → תקוע). With
 * the two coinciding, "sort by label order" and "sort A→Z" produce the same list
 * and neither test can tell them apart — an engine that always compared text
 * would pass both.
 */
const STATUS_MAPS = {
  custom: {
    custom1ID: {
      kind: 'status',
      orderById: { 0: 0, 5: 1, 1: 2 },
      labelById: { 0: 'תקוע', 5: 'טרם החל', 1: 'בעבודה' },
    },
  },
};

describe('sortTasks — custom status column', () => {
  const list = [
    { id: 'a', custom1ID: 0 },   // displayed FIRST, alphabetically last
    { id: 'b', custom1ID: 1 },   // displayed LAST, alphabetically first
    { id: 'c', custom1ID: null },
    { id: 'd', custom1ID: 5 },
  ];

  it('sorts by the column\'s DISPLAY order, empty last', () => {
    const out = sortTasks(list, { col: 'custom1ID', dir: 'labelAsc', active: true }, STATUS_MAPS);
    expect(out.map((t) => t.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('reverses the ranked order but KEEPS empty last', () => {
    const out = sortTasks(list, { col: 'custom1ID', dir: 'labelDesc', active: true }, STATUS_MAPS);
    expect(out.map((t) => t.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('sorts by label TEXT on azAsc — a different order than labelAsc gives', () => {
    const out = sortTasks(list, { col: 'custom1ID', dir: 'azAsc', active: true }, STATUS_MAPS);
    // בעבודה < טרם החל < תקוע (Hebrew collation), empty last — the reverse of labelAsc.
    expect(out.map((t) => t.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  /*
   * Label id 0 is a real label. If the engine tested truthiness it would fall
   * into the "no value" tail and never sort by its rank.
   */
  it('does not mistake label id 0 for an empty cell', () => {
    // Input order is the REVERSE of the expectation, so an engine that never
    // sorted (or that pooled id 0 into the empty tail) cannot pass by accident.
    const out = sortTasks(
      [{ id: 'none', custom1ID: null }, { id: 'zero', custom1ID: 0 }],
      { col: 'custom1ID', dir: 'labelAsc', active: true },
      STATUS_MAPS
    );
    expect(out.map((t) => t.id)).toEqual(['zero', 'none']);
  });

  it('leaves the list untouched when the sort is inactive', () => {
    const out = sortTasks(list, { col: 'custom1ID', dir: 'labelAsc', active: false }, STATUS_MAPS);
    expect(out).toBe(list);
  });
});

describe('sortTasks — the other custom kinds', () => {
  it('sorts a custom date column by time, undated last in both directions', () => {
    const list = [
      { id: 'late', custom2ID: new Date(2026, 5, 1) },
      { id: 'none', custom2ID: null },
      { id: 'early', custom2ID: new Date(2026, 0, 1) },
    ];
    const maps = { custom: { custom2ID: { kind: 'date' } } };
    expect(sortTasks(list, { col: 'custom2ID', dir: 'dateAsc', active: true }, maps).map((t) => t.id))
      .toEqual(['early', 'late', 'none']);
    expect(sortTasks(list, { col: 'custom2ID', dir: 'dateDesc', active: true }, maps).map((t) => t.id))
      .toEqual(['late', 'early', 'none']);
  });

  it('sorts a custom people column by the joined names', () => {
    const list = [
      { id: 'b', custom3ID: [{ id: '2', name: 'דנה' }] },
      { id: 'a', custom3ID: [{ id: '1', name: 'אבי' }] },
      { id: 'x', custom3ID: [] },
    ];
    const maps = { custom: { custom3ID: { kind: 'person' } } };
    expect(sortTasks(list, { col: 'custom3ID', dir: 'azAsc', active: true }, maps).map((t) => t.id))
      .toEqual(['a', 'b', 'x']);
  });

  it('sorts a custom connected-board column by the linked item names', () => {
    const list = [
      { id: 'b', custom4ID: { linkedItems: [{ id: '9', name: 'בטא' }] } },
      { id: 'a', custom4ID: { linkedItems: [{ id: '8', name: 'אלפא' }] } },
    ];
    const maps = { custom: { custom4ID: { kind: 'relation' } } };
    expect(sortTasks(list, { col: 'custom4ID', dir: 'azAsc', active: true }, maps).map((t) => t.id))
      .toEqual(['a', 'b']);
  });

  it('still sorts the BASE columns exactly as before', () => {
    const list = [{ id: 'b', name: 'ב' }, { id: 'a', name: 'א' }];
    expect(sortTasks(list, { col: 'name', dir: 'nameAsc', active: true }, {}).map((t) => t.id))
      .toEqual(['a', 'b']);
  });
});

describe('groupTabTasks — custom columns', () => {
  const custom = {
    custom1ID: {
      kind: 'status',
      statusOpts: {
        labelById: { 1: 'בעבודה', 0: 'תקוע' },
        colorById: { 1: '#fdab3d', 0: '#df2f4a' },
        orderById: { 1: 0, 0: 1 },
      },
    },
  };

  it('groups by a custom status column, in display order and with its colors', () => {
    const list = [
      { id: 'a', custom1ID: 0 },
      { id: 'b', custom1ID: 1 },
      { id: 'c', custom1ID: null },
    ];
    const groups = groupTabTasks(list, { by: 'custom1ID', order: 'labelAsc', custom });
    expect(groups.map((g) => g.label)).toEqual(['בעבודה', 'תקוע', 'ללא ערך']);
    expect(groups[0].color).toBe('#fdab3d');
    expect(groups[0].items.map((t) => t.id)).toEqual(['b']);
  });

  it('gives every labeled group a color, including the colorless kinds', () => {
    const groups = groupTabTasks(
      [{ id: 'a', custom5ID: 'אדום' }],
      { by: 'custom5ID', custom: { custom5ID: { kind: 'values' } } }
    );
    expect(groups[0].label).toBe('אדום');
    expect(groups[0].color).toBeTruthy(); // ensureGroupColors ran
  });

  it('falls back to the ungrouped bucket for an unknown key', () => {
    const groups = groupTabTasks([{ id: 'a' }], { by: 'custom9ID', custom: {} });
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });

  it('still groups the BASE status column exactly as before', () => {
    const groups = groupTabTasks(
      [{ id: 'a', statusID: 1 }],
      { by: 'status', labelById: { 1: 'בעבודה' }, colorById: { 1: '#fdab3d' }, orderById: { 1: 0 } }
    );
    expect(groups[0].label).toBe('בעבודה');
  });
});

describe('customFilterDims still honours round366\'s controls', () => {
  it('keeps status, dropdown and relation on the shared value-set control', () => {
    const dims = customFilterDims([
      { alias: 'c1', type: 'status', title: 'א' },
      { alias: 'c2', type: 'dropdown', title: 'ב' },
      { alias: 'c3', type: 'board_relation', title: 'ג' },
      { alias: 'c4', type: 'people', title: 'ד' },
      { alias: 'c5', type: 'file', title: 'ה' },
    ]);
    expect(dims.map((d) => d.control)).toEqual(['values', 'values', 'values', 'person']);
  });
});
