import { describe, it, expect } from 'vitest';
import {
  customColumnKind,
  customFilterControl,
  customSortDims,
  customGroupDims,
  customSortKey,
  customGroupBuckets,
} from '../customColumns.js';

/*
 * round373 — a custom column must behave like a BASE mapped column: filter, sort,
 * group, hide and edit. round366 gave it filter+hide, round372 finished status
 * edit; sort and group were still hardcoded literals that no custom alias could
 * enter. These tests pin the descriptor layer (type → kind) and the two new
 * generic engines that read it.
 */

describe('customColumnKind — one type→behaviour map for every engine', () => {
  it('folds monday\'s alias types onto the same kind', () => {
    expect(customColumnKind('status')).toBe('status');
    expect(customColumnKind('color')).toBe('status'); // legacy name, same column
    expect(customColumnKind('people')).toBe('person');
    expect(customColumnKind('multiple_person')).toBe('person');
    expect(customColumnKind('board_relation')).toBe('relation');
    expect(customColumnKind('connect_boards')).toBe('relation');
    expect(customColumnKind('long_text')).toBe('text');
    expect(customColumnKind('dropdown')).toBe('values');
    expect(customColumnKind('date')).toBe('date');
    expect(customColumnKind('file')).toBe('file');
  });

  it('returns null for a type the app cannot drive (formula/mirror)', () => {
    expect(customColumnKind('formula')).toBeNull();
    expect(customColumnKind('mirror')).toBeNull();
    expect(customColumnKind(undefined)).toBeNull();
  });

  /*
   * The filter CONTROL is coarser than the kind and must stay byte-compatible
   * with round366: status, dropdown and relation all filter as a value set.
   * Collapsing kind and control into one map would silently change how a
   * relation column filters.
   */
  it('maps status/values/relation to ONE filter control', () => {
    expect(customFilterControl('status')).toBe('values');
    expect(customFilterControl('values')).toBe('values');
    expect(customFilterControl('relation')).toBe('values');
    expect(customFilterControl('person')).toBe('person');
    expect(customFilterControl('date')).toBe('date');
    expect(customFilterControl('text')).toBe('text');
    expect(customFilterControl('file')).toBeNull();
  });
});

describe('customSortDims / customGroupDims', () => {
  const cols = [
    { alias: 'custom1ID', type: 'status', title: 'בדיקה' },
    { alias: 'custom2ID', type: 'date', title: 'יעד' },
    { alias: 'custom3ID', type: 'file', title: 'מסמכים' },
  ];

  it('offers label-order directions for a status column and date directions for a date one', () => {
    const dims = customSortDims(cols);
    expect(dims.map((d) => d.key)).toEqual(['custom1ID', 'custom2ID']); // file is out
    expect(dims[0].dirs.map((d) => d.key)).toContain('labelAsc');
    expect(dims[0].dirs.map((d) => d.key)).toContain('azAsc');
    expect(dims[1].dirs.map((d) => d.key)).toEqual(['dateAsc', 'dateDesc']);
  });

  it('excludes file columns from grouping too', () => {
    expect(customGroupDims(cols).map((d) => d.key)).toEqual(['custom1ID', 'custom2ID']);
  });

  it('carries the column title so the builder can name the row in Hebrew', () => {
    expect(customSortDims(cols)[0].title).toBe('בדיקה');
    expect(customGroupDims(cols)[0].title).toBe('בדיקה');
  });
});

describe('customSortKey — the comparable behind every kind', () => {
  const maps = {
    orderById: { 0: 2, 1: 0, 5: 1 },
    labelById: { 0: 'תקוע', 1: 'בעבודה', 5: 'טרם החל' },
  };

  it('ranks a status by DISPLAY order, not by label id', () => {
    // id 1 is displayed first, id 0 last — sorting must follow the column's order.
    expect(customSortKey('status', 1, maps).rank).toBe(0);
    expect(customSortKey('status', 0, maps).rank).toBe(2);
  });

  /*
   * Label id 0 is a REAL label. Testing truthiness instead of the type would
   * make the first label read as "no value" and sort to the bottom.
   */
  it('treats label id 0 as a value, and only null/undefined as empty', () => {
    expect(customSortKey('status', 0, maps).rank).not.toBeNull();
    expect(customSortKey('status', 0, maps).text).toBe('תקוע');
    expect(customSortKey('status', null, maps).rank).toBeNull();
    expect(customSortKey('status', undefined, maps).rank).toBeNull();
  });

  it('ranks a date by time and reports an empty date as no value', () => {
    const d = new Date('2026-03-04T00:00:00Z');
    expect(customSortKey('date', d).rank).toBe(d.getTime());
    expect(customSortKey('date', null).rank).toBeNull();
    expect(customSortKey('date', new Date('nope')).rank).toBeNull();
  });

  it('reads people and linked items as their joined NAMES', () => {
    expect(customSortKey('person', [{ id: '1', name: 'דנה' }, { id: '2', name: 'אבי' }]).text)
      .toBe('אבי, דנה'); // name-sorted, so assignment order never changes the sort
    expect(customSortKey('relation', { linkedItems: [{ id: '9', name: 'פרויקט א' }] }).text)
      .toBe('פרויקט א');
    expect(customSortKey('person', []).text).toBe('');
  });

  it('reads dropdown and text columns as their own text', () => {
    expect(customSortKey('values', 'אדום').text).toBe('אדום');
    expect(customSortKey('text', '  הערה  ').text).toBe('הערה');
    expect(customSortKey('text', null).text).toBe('');
  });
});

describe('customGroupBuckets', () => {
  const statusOpts = {
    labelById: { 0: 'תקוע', 1: 'בעבודה' },
    colorById: { 0: '#df2f4a', 1: '#fdab3d' },
    orderById: { 1: 0, 0: 1 },
  };

  it('buckets a status column by label, in DISPLAY order, colored by the column', () => {
    const list = [
      { id: 'a', custom1ID: 0 },
      { id: 'b', custom1ID: 1 },
      { id: 'c', custom1ID: 1 },
      { id: 'd', custom1ID: null },
    ];
    const groups = customGroupBuckets(list, 'custom1ID', 'status', { statusOpts, order: 'labelAsc' });
    expect(groups.map((g) => g.label)).toEqual(['בעבודה', 'תקוע', 'ללא ערך']);
    expect(groups[0].items.map((t) => t.id)).toEqual(['b', 'c']);
    expect(groups[0].color).toBe('#fdab3d');
    expect(groups[2].items.map((t) => t.id)).toEqual(['d']); // empty bucket last
  });

  it('keeps label id 0 out of the "no value" bucket', () => {
    const groups = customGroupBuckets([{ id: 'a', custom1ID: 0 }], 'custom1ID', 'status', { statusOpts });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('תקוע');
  });

  it('buckets people by their COMBINATION, like the existing discussion grouping', () => {
    const list = [
      { id: 'a', custom2ID: [{ id: '1', name: 'דנה' }] },
      { id: 'b', custom2ID: [{ id: '1', name: 'דנה' }, { id: '2', name: 'אבי' }] },
      { id: 'c', custom2ID: [{ id: '2', name: 'אבי' }, { id: '1', name: 'דנה' }] },
      { id: 'd', custom2ID: [] },
    ];
    const groups = customGroupBuckets(list, 'custom2ID', 'person', {});
    // b and c hold the same two people in a different order — ONE bucket.
    const combo = groups.find((g) => g.items.length === 2);
    expect(combo.items.map((t) => t.id)).toEqual(['b', 'c']);
    expect(groups.at(-1).label).toBe('ללא ערך');
  });

  it('buckets a date column by calendar DAY, ignoring the time of day', () => {
    const list = [
      { id: 'a', custom3ID: new Date(2026, 2, 4, 9, 0) },
      { id: 'b', custom3ID: new Date(2026, 2, 4, 17, 30) },
      { id: 'c', custom3ID: new Date(2026, 2, 5, 8, 0) },
    ];
    const groups = customGroupBuckets(list, 'custom3ID', 'date', { order: 'dateAsc' });
    expect(groups.map((g) => g.label)).toEqual(['04/03/2026', '05/03/2026']);
    expect(groups[0].items).toHaveLength(2);
  });

  it('buckets a text column by its value and puts blanks last', () => {
    const list = [
      { id: 'a', custom4ID: 'ראשון' },
      { id: 'b', custom4ID: '' },
      { id: 'c', custom4ID: 'ראשון' },
    ];
    const groups = customGroupBuckets(list, 'custom4ID', 'text', {});
    expect(groups[0].label).toBe('ראשון');
    expect(groups[0].items).toHaveLength(2);
    expect(groups.at(-1).label).toBe('ללא ערך');
  });
});
