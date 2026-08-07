import { describe, it, expect } from 'vitest';
import { statusFilterOptions } from '../statusFilterOptions.js';

/*
 * round372 — a custom STATUS column's filter menu. The scan over loaded rows yields
 * stable label IDs, so without this resolution step the menu would list "2" / "5"
 * instead of the labels, with no colour.
 */
const MAPS = {
  labelById: { 0: 'לא התחיל', 2: 'בתהליך', 5: 'הושלם' },
  colorById: { 0: '#c4c4c4', 2: '#fdab3d', 5: '#00c875' },
  orderById: { 0: 0, 2: 1, 5: 2 },
};

describe('round372 — statusFilterOptions', () => {
  it('resolves ids to label text + colour', () => {
    expect(statusFilterOptions(['2'], MAPS)).toEqual([
      { id: '2', label: 'בתהליך', color: '#fdab3d' },
    ]);
  });

  it('orders by the column DISPLAY order, not by the scan order', () => {
    const opts = statusFilterOptions(['5', '0', '2'], MAPS);
    expect(opts.map((o) => o.label)).toEqual(['לא התחיל', 'בתהליך', 'הושלם']);
  });

  it('keeps label id 0 — it is a real label, not "empty"', () => {
    const opts = statusFilterOptions(['0'], MAPS);
    expect(opts).toHaveLength(1);
    expect(opts[0].label).toBe('לא התחיל');
  });

  it('accepts ids as numbers as well as strings, and always reports id as a string', () => {
    // the row scan stringifies, but callers holding parseValue output may not
    expect(statusFilterOptions([2], MAPS)[0]).toEqual({ id: '2', label: 'בתהליך', color: '#fdab3d' });
  });

  it('DROPS an id with no label instead of showing the raw number', () => {
    // labels not loaded yet, or the label was deleted while a task still carries it
    expect(statusFilterOptions(['99'], MAPS)).toEqual([]);
    expect(statusFilterOptions(['2', '99'], MAPS).map((o) => o.id)).toEqual(['2']);
  });

  it('falls back to Hebrew label collation when the column has no display order', () => {
    const noOrder = { labelById: { 1: 'בתהליך', 2: 'אושר' }, colorById: {} };
    expect(statusFilterOptions(['1', '2'], noOrder).map((o) => o.label)).toEqual(['אושר', 'בתהליך']);
  });

  it('degrades to an empty list on missing input rather than throwing', () => {
    expect(statusFilterOptions(null, MAPS)).toEqual([]);
    expect(statusFilterOptions(['2'], null)).toEqual([]);
    expect(statusFilterOptions(['2'], {})).toEqual([]);
  });

  it('reports a null colour when the map has none for that label', () => {
    const opts = statusFilterOptions(['2'], { labelById: { 2: 'בתהליך' } });
    expect(opts[0].color).toBeNull();
  });
});
