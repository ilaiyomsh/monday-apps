import { describe, it, expect } from 'vitest';
import {
  customFilterDims, pristineFilterCol, emptyFilter, filterTasks, filterCount,
  serializeFilter, deserializeFilter, customComparableValues, OP_LABEL,
} from '../controls/controls.js';

/*
 * round366 — owner-added custom columns join the filter engine as TYPED dims:
 * person (people array), values (dropdown label text / board_relation linked
 * names), date, and free-text contains. `file` customs are not filterable.
 */

const CUSTOM_COLS = [
  { alias: 'custom1ID', type: 'people', title: 'רפרנט' },
  { alias: 'custom2ID', type: 'dropdown', title: 'תחום' },
  { alias: 'custom3ID', type: 'date', title: 'תאריך יעד' },
  { alias: 'custom4ID', type: 'text', title: 'הערה' },
  { alias: 'custom5ID', type: 'board_relation', title: 'פרויקטים' },
  { alias: 'custom6ID', type: 'file', title: 'קבצים' },
];

const TASKS = [
  { id: '1', statusID: 1, custom1ID: [{ id: '7', name: 'דנה' }], custom2ID: 'כספים', custom3ID: new Date(2026, 7, 6), custom4ID: 'דחוף מאוד', custom5ID: { linkedItems: [{ id: '9', name: 'פרויקט חורף' }], ids: ['9'], text: null } },
  { id: '2', statusID: 2, custom1ID: [], custom2ID: 'תפעול, כספים', custom3ID: null, custom4ID: '', custom5ID: { linkedItems: [], ids: [], text: null } },
  { id: '3', statusID: 1, custom1ID: [{ id: '8', name: 'יוסי' }], custom2ID: null, custom3ID: new Date(2026, 0, 1), custom4ID: 'רגיל', custom5ID: null },
];

describe('round366 — customFilterDims', () => {
  it('maps monday types to controls and drops non-filterable file columns', () => {
    expect(customFilterDims(CUSTOM_COLS)).toEqual([
      { key: 'custom1ID', control: 'person', title: 'רפרנט' },
      { key: 'custom2ID', control: 'values', title: 'תחום' },
      { key: 'custom3ID', control: 'date', title: 'תאריך יעד' },
      { key: 'custom4ID', control: 'text', title: 'הערה' },
      { key: 'custom5ID', control: 'values', title: 'פרויקטים' },
    ]);
  });

  it('OP_LABEL carries the new contains label', () => {
    expect(OP_LABEL.contains).toBe('מכיל');
  });
});

describe('round366 — seeding + comparable values', () => {
  const dims = customFilterDims(CUSTOM_COLS);

  it('emptyFilter seeds each dim by control shape beside the fixed four', () => {
    const f = emptyFilter(dims);
    expect(f.status.values.size).toBe(0);
    expect(f.custom1ID).toEqual({ op: 'is', values: new Set() });
    expect(f.custom3ID).toEqual({ op: 'within', range: null, date: null });
    expect(f.custom4ID).toEqual({ op: 'contains', text: '' });
    expect(pristineFilterCol('text')).toEqual({ op: 'contains', text: '' });
  });

  it('customComparableValues: relation → linked names; dropdown multi-label text splits on commas', () => {
    expect(customComparableValues({ linkedItems: [{ id: '9', name: 'פרויקט חורף' }] })).toEqual(['פרויקט חורף']);
    expect(customComparableValues('תפעול, כספים')).toEqual(['תפעול', 'כספים']);
    expect(customComparableValues(null)).toEqual([]);
  });
});

describe('round366 — filterTasks over custom dims', () => {
  const dims = customFilterDims(CUSTOM_COLS);
  const base = () => emptyFilter(dims);

  it('person dim: is / isnot over the people array', () => {
    const f = base();
    f.custom1ID.values = new Set(['7']);
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['1']);
    f.custom1ID.op = 'isnot';
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['2', '3']);
  });

  it('values dim: dropdown label text matches EACH label of a multi-label value', () => {
    const f = base();
    f.custom2ID.values = new Set(['כספים']);
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['1', '2']);
  });

  it('values dim: board_relation matches by linked item name', () => {
    const f = base();
    f.custom5ID.values = new Set(['פרויקט חורף']);
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['1']);
  });

  it('text dim: trimmed case-insensitive contains; blank text is inactive', () => {
    const f = base();
    f.custom4ID.text = 'דחוף';
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['1']);
    f.custom4ID.text = '   ';
    expect(filterTasks(TASKS, f, { custom: dims })).toHaveLength(3);
  });

  it('date dim: before/after against the parsed Date value', () => {
    const f = base();
    f.custom3ID = { op: 'before', range: null, date: new Date(2026, 5, 1) };
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['3']);
  });

  it('custom dims AND with the fixed columns, and filterCount counts them', () => {
    const f = base();
    f.status.values = new Set(['1']);
    f.custom2ID.values = new Set(['כספים']);
    expect(filterTasks(TASKS, f, { custom: dims }).map((t) => t.id)).toEqual(['1']);
    expect(filterCount(f, dims)).toBe(2);
    f.custom4ID.text = 'x';
    expect(filterCount(f, dims)).toBe(3);
  });
});

describe('round366 — saved-view round-trip with custom dims', () => {
  const dims = customFilterDims(CUSTOM_COLS);

  it('serialize → deserialize preserves every custom dim (Sets/Date restored)', () => {
    const f = emptyFilter(dims);
    f.custom1ID = { op: 'isnot', values: new Set(['7']) };
    f.custom2ID.values = new Set(['כספים', 'תפעול']);
    f.custom3ID = { op: 'after', range: null, date: new Date('2026-08-06T00:00:00Z') };
    f.custom4ID.text = 'דחוף';
    const back = deserializeFilter(JSON.parse(JSON.stringify(serializeFilter(f, dims))), dims);
    expect(back.custom1ID.op).toBe('isnot');
    expect([...back.custom1ID.values]).toEqual(['7']);
    expect([...back.custom2ID.values].sort()).toEqual(['כספים', 'תפעול']);
    expect(back.custom3ID.op).toBe('after');
    expect(back.custom3ID.date instanceof Date).toBe(true);
    expect(back.custom4ID.text).toBe('דחוף');
  });

  it('a saved filter WITHOUT the dims (older view) deserializes to pristine keys — no crash, no undefined', () => {
    const back = deserializeFilter({ status: { op: 'is', values: ['1'] } }, dims);
    expect(back.custom1ID).toEqual({ op: 'is', values: new Set() });
    expect(back.custom4ID).toEqual({ op: 'contains', text: '' });
    // and the legacy fixed-key path is untouched by the dims param
    expect([...back.status.values]).toEqual(['1']);
  });
});
