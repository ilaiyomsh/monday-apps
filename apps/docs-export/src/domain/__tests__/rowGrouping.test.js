import { describe, expect, it } from 'vitest';
import { groupRows } from '../rowGrouping.js';

// Word's vertical merge (w:vMerge) only spans CONSECUTIVE rows, so the ordering
// this module produces is not a preference — it is what makes the merge legal.
// Every test below is therefore about one of two things: the order rows come out
// in, or exactly which cell carries the rowSpan and which is null.
//
// Column value shapes are the live probe captures of 2026-07-29 (API 2026-04):
// a date column answers { date, time, text }, a mirror answers
// { display_value, mirrored_items } with text/value NULL.

const COL = { action: 'act', committee: 'wzmirror', report: 'rep', date: 'wzdate' };

const TYPES = {
  act: 'text',
  wzmirror: 'mirror',
  rep: 'long_text',
  wzdate: 'date',
  wzpeople: 'people',
};

const SETTINGS = {
  columns: { ...COL, person: 'wzpeople' },
  mergeAction: true,
  mergeCommittee: true,
};

/** Probe-shaped text value. */
const text = (id, value) => ({ id, type: 'text', text: value, value: JSON.stringify(value) });

/** Probe-shaped date value: an unset date answers text '' and value null. */
const date = (value) =>
  value
    ? { id: 'wzdate', type: 'date', text: value, value: `{"date":"${value}"}`, date: value, time: '' }
    : { id: 'wzdate', type: 'date', text: '', value: null, date: null, time: '' };

/**
 * Probe-shaped mirror value. `names` are the individual mirrored values; the
 * display_value monday builds is them joined with ', '.
 */
const mirror = (names) => ({
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: names.join(', '),
  mirrored_items: names.map((n, i) => ({
    linked_board_id: '18424252630',
    linked_item: { id: `900${i}`, name: `src-${n}` },
    mirrored_value: { id: 'srctext', text: n, value: JSON.stringify(n) },
  })),
});

/** An item in services/itemsQuery's output shape. */
const item = (id, action, committees, report, dateStr) => ({
  id,
  name: `item-${id}`,
  cv: {
    act: text('act', action),
    wzmirror: mirror(committees),
    rep: text('rep', report),
    wzdate: date(dateStr),
  },
});

/** The four cell texts of a row, with null for a merged-away cell. */
const texts = (row) => row.cells.map((c) => (c === null ? null : c.text));
const spans = (row) => row.cells.map((c) => (c === null ? null : (c.rowSpan ?? 1)));
const col = (rows, i) => rows.map((r) => (r.cells[i] === null ? null : r.cells[i].text));

describe('groupRows — the row shape', () => {
  it('emits one row per item with four cells in action, committee, report, date order', () => {
    const rows = groupRows([item('1', 'ביקור', ['אשקלון'], 'נערך ביקור', '2026-07-20')], SETTINGS, TYPES);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(4);
    expect(texts(rows[0])).toEqual(['ביקור', 'אשקלון', 'נערך ביקור', '2026-07-20']);
  });

  it('omits rowSpan entirely for a run of one, rather than emitting rowSpan 1', () => {
    // A w:vMerge of a single row is a malformed merge, so the renderer must not
    // even be told about it.
    const rows = groupRows([item('1', 'א', ['אשקלון'], 'ד', '2026-07-20')], SETTINGS, TYPES);
    for (const cell of rows[0].cells) {
      expect(Object.prototype.hasOwnProperty.call(cell, 'rowSpan')).toBe(false);
    }
  });

  it('renders the committee cell as the mirror display_value, commas and all', () => {
    // The cell shows monday's own joined string; the ", " ambiguity only matters
    // when deriving names (domain/committees.js), never when rendering.
    const rows = groupRows([item('1', 'א', ['גליל, גולן'], 'ד', '2026-07-20')], SETTINGS, TYPES);
    expect(rows[0].cells[1].text).toBe('גליל, גולן');
  });

  it('renders an empty cell rather than null text when a value is missing', () => {
    const bare = { id: '1', name: 'item-1', cv: {} };
    const rows = groupRows([bare], SETTINGS, TYPES);
    expect(texts(rows[0])).toEqual(['', '', '', '']);
  });

  it('renders empty cells for roles that are not mapped at all', () => {
    const settings = { ...SETTINGS, columns: { ...SETTINGS.columns, report: '', date: '' } };
    const rows = groupRows([item('1', 'א', ['אשקלון'], 'ד', '2026-07-20')], settings, TYPES);
    expect(texts(rows[0])).toEqual(['א', 'אשקלון', '', '']);
  });

  it('includes the time in a date cell when the column carries one', () => {
    const withTime = item('1', 'א', ['אשקלון'], 'ד', '2026-07-20');
    withTime.cv.wzdate = { ...withTime.cv.wzdate, time: '09:30:00' };
    expect(groupRows([withTime], SETTINGS, TYPES)[0].cells[3].text).toBe('2026-07-20 09:30');
  });

  it('returns an empty list for no items', () => {
    expect(groupRows([], SETTINGS, TYPES)).toEqual([]);
  });

  it('returns an empty list instead of throwing for a non-array', () => {
    expect(groupRows(undefined, SETTINGS, TYPES)).toEqual([]);
    expect(groupRows(null, SETTINGS, TYPES)).toEqual([]);
  });

  it('accepts columnTypes as an array of { id, type }, the shape boardMeta returns', () => {
    const asArray = Object.entries(TYPES).map(([id, type]) => ({ id, type }));
    const items = [item('1', 'א', ['אשקלון'], 'ד', '2026-07-20')];
    expect(groupRows(items, SETTINGS, asArray)).toEqual(groupRows(items, SETTINGS, TYPES));
  });

  it('does not mutate or reorder the caller’s items array', () => {
    const items = [
      item('1', 'ב', ['אשקלון'], 'ד1', '2026-07-20'),
      item('2', 'א', ['אשקלון'], 'ד2', '2026-07-19'),
    ];
    const snapshot = items.map((i) => i.id);
    groupRows(items, SETTINGS, TYPES);
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });
});

describe('groupRows — ordering', () => {
  it('orders action groups by FIRST APPEARANCE in the board, not alphabetically', () => {
    const items = [
      item('1', 'תיאום', ['אשקלון'], 'ד1', '2026-07-20'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-20'),
      item('3', 'תיאום', ['אשקלון'], 'ד3', '2026-07-21'),
    ];
    // Alphabetically 'ביקור' precedes 'תיאום'; first appearance is the reverse.
    expect(col(groupRows(items, SETTINGS, TYPES), 2)).toEqual(['ד1', 'ד3', 'ד2']);
  });

  it('sorts committees ascending inside an action group', () => {
    const items = [
      item('1', 'ביקור', ['גליל'], 'ד1', '2026-07-20'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-20'),
      item('3', 'ביקור', ['באר שבע'], 'ד3', '2026-07-20'),
    ];
    expect(col(groupRows(items, SETTINGS, TYPES), 2)).toEqual(['ד2', 'ד3', 'ד1']);
  });

  it('sorts committees by locale, so case does not push a name to the end', () => {
    // A code-point comparison would put 'Beta' (B=0x42) before 'alpha' (a=0x61).
    const items = [
      item('1', 'visit', ['Beta'], 'r1', '2026-07-20'),
      item('2', 'visit', ['alpha'], 'r2', '2026-07-20'),
    ];
    expect(col(groupRows(items, SETTINGS, TYPES), 2)).toEqual(['r2', 'r1']);
  });

  it('sorts dates ascending inside a committee run', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-22'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-19'),
      item('3', 'ביקור', ['אשקלון'], 'ד3', '2026-07-20'),
    ];
    expect(col(groupRows(items, SETTINGS, TYPES), 2)).toEqual(['ד2', 'ד3', 'ד1']);
  });

  it('sorts a same-day pair by time when one carries a time', () => {
    const morning = item('1', 'ביקור', ['אשקלון'], 'בוקר', '2026-07-20');
    morning.cv.wzdate = { ...morning.cv.wzdate, time: '08:00:00' };
    const evening = item('2', 'ביקור', ['אשקלון'], 'ערב', '2026-07-20');
    evening.cv.wzdate = { ...evening.cv.wzdate, time: '19:00:00' };
    expect(col(groupRows([evening, morning], SETTINGS, TYPES), 2)).toEqual(['בוקר', 'ערב']);
  });

  it('puts rows with no date LAST inside their committee run', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ללא תאריך', ''),
      item('2', 'ביקור', ['אשקלון'], 'עם תאריך', '2026-07-20'),
    ];
    expect(col(groupRows(items, SETTINGS, TYPES), 2)).toEqual(['עם תאריך', 'ללא תאריך']);
  });

  it('puts a non-ISO date last and keeps the board order among such rows', () => {
    const junk = (id, value, report) => {
      const it = item(id, 'ביקור', ['אשקלון'], report, '2026-07-20');
      it.cv.wzdate = { id: 'wzdate', type: 'date', text: value, value: null, date: value, time: '' };
      return it;
    };
    const items = [
      junk('1', '20/07/2026', 'שבור א'),
      item('2', 'ביקור', ['אשקלון'], 'תקין', '2026-07-25'),
      junk('3', 'בקרוב', 'שבור ב'),
    ];
    expect(col(groupRows(items, SETTINGS, TYPES), 2)).toEqual(['תקין', 'שבור א', 'שבור ב']);
  });

  it('keeps an empty action as its own group in first-appearance position', () => {
    const items = [
      item('1', '', ['אשקלון'], 'ריק א', '2026-07-20'),
      item('2', 'ביקור', ['אשקלון'], 'עם פעולה', '2026-07-20'),
      item('3', '', ['אשקלון'], 'ריק ב', '2026-07-21'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(col(rows, 2)).toEqual(['ריק א', 'ריק ב', 'עם פעולה']);
    // ...and the two empty-action rows merge into one empty cell.
    expect(rows[0].cells[0]).toEqual({ text: '', rowSpan: 2 });
    expect(rows[1].cells[0]).toBeNull();
  });
});

describe('groupRows — action merging', () => {
  it('puts the rowSpan on the first row of a run and null on the rest', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'ביקור', ['באר שבע'], 'ד2', '2026-07-20'),
      item('3', 'תיאום', ['אשקלון'], 'ד3', '2026-07-21'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(rows[0].cells[0]).toEqual({ text: 'ביקור', rowSpan: 2 });
    expect(rows[1].cells[0]).toBeNull();
    expect(rows[2].cells[0]).toEqual({ text: 'תיאום' });
  });

  it('merges every row when all items share one action', () => {
    const items = ['אשקלון', 'באר שבע', 'גליל', 'דימונה'].map((c, i) =>
      item(String(i), 'ביקור', [c], `ד${i}`, '2026-07-20')
    );
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(rows).toHaveLength(4);
    expect(rows[0].cells[0]).toEqual({ text: 'ביקור', rowSpan: 4 });
    expect(col(rows, 0)).toEqual(['ביקור', null, null, null]);
  });

  it('never merges two action groups that happen to be equal after re-sorting', () => {
    // Interleaved input: A, B, A. First-appearance order keeps A's rows together,
    // so there are exactly two runs, not three.
    const items = [
      item('1', 'A', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'B', ['אשקלון'], 'ד2', '2026-07-20'),
      item('3', 'A', ['באר שבע'], 'ד3', '2026-07-21'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(col(rows, 0)).toEqual(['A', null, 'B']);
    expect(spans(rows[0])[0]).toBe(2);
  });

  it('emits a plain action cell for every row when mergeAction is false', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-20'),
    ];
    const rows = groupRows(items, { ...SETTINGS, mergeAction: false }, TYPES);
    expect(rows.map((r) => r.cells[0])).toEqual([{ text: 'ביקור' }, { text: 'ביקור' }]);
  });
});

describe('groupRows — committee merging', () => {
  it('merges consecutive equal committees inside one action group', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-20'),
      item('3', 'ביקור', ['באר שבע'], 'ד3', '2026-07-21'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(rows[0].cells[1]).toEqual({ text: 'אשקלון', rowSpan: 2 });
    expect(rows[1].cells[1]).toBeNull();
    expect(rows[2].cells[1]).toEqual({ text: 'באר שבע' });
  });

  it('does NOT merge the same committee across an action boundary', () => {
    // THE bug this app is most likely to grow: 'אשקלון' is adjacent across the
    // A→B boundary, and one w:vMerge over it would swallow B's action row.
    const items = [
      item('1', 'A', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'B', ['אשקלון'], 'ד2', '2026-07-20'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(rows[0].cells[1]).toEqual({ text: 'אשקלון' });
    expect(rows[1].cells[1]).toEqual({ text: 'אשקלון' });
    expect(col(rows, 1)).toEqual(['אשקלון', 'אשקלון']); // no nulls at all
  });

  it('restarts the committee run at every action boundary in a longer table', () => {
    const items = [
      item('1', 'A', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'A', ['אשקלון'], 'ד2', '2026-07-20'),
      item('3', 'B', ['אשקלון'], 'ד3', '2026-07-21'),
      item('4', 'B', ['אשקלון'], 'ד4', '2026-07-22'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(col(rows, 0)).toEqual(['A', null, 'B', null]);
    expect(col(rows, 1)).toEqual(['אשקלון', null, 'אשקלון', null]);
    expect(rows.map((r) => spans(r)[1])).toEqual([2, null, 2, null]);
  });

  it('still confines committee merging to an action group when mergeAction is false', () => {
    // The action cells are unmerged, but a committee merge spanning the boundary
    // would still pair rows from two different actions.
    const items = [
      item('1', 'A', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'B', ['אשקלון'], 'ד2', '2026-07-20'),
    ];
    const rows = groupRows(items, { ...SETTINGS, mergeAction: false }, TYPES);
    expect(col(rows, 1)).toEqual(['אשקלון', 'אשקלון']);
  });

  it('emits a plain committee cell for every row when mergeCommittee is false', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-20'),
    ];
    const rows = groupRows(items, { ...SETTINGS, mergeCommittee: false }, TYPES);
    expect(col(rows, 1)).toEqual(['אשקלון', 'אשקלון']);
    // ...while the action column is still merged: the two flags are independent.
    expect(rows[0].cells[0]).toEqual({ text: 'ביקור', rowSpan: 2 });
  });

  it('emits no merged-away cell anywhere when both merge flags are false', () => {
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-19'),
      item('2', 'ביקור', ['אשקלון'], 'ד2', '2026-07-20'),
    ];
    const settings = { ...SETTINGS, mergeAction: false, mergeCommittee: false };
    const rows = groupRows(items, settings, TYPES);
    for (const row of rows) {
      expect(row.cells.every((c) => c !== null && c.rowSpan === undefined)).toBe(true);
    }
  });

  it('merges two identical multi-valued committee cells but not a single value that only looks like one', () => {
    // display_value 'גליל, גולן' can be ONE committee or TWO; the CELL text is
    // what merges, so identical text merges and different text does not.
    const items = [
      item('1', 'ביקור', ['גליל, גולן'], 'ד1', '2026-07-19'),
      item('2', 'ביקור', ['גליל', 'גולן'], 'ד2', '2026-07-20'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(rows[0].cells[1].text).toBe('גליל, גולן');
    expect(rows[1].cells[1]).toBeNull(); // same TEXT, so one merged cell
    expect(rows[0].cells[1].rowSpan).toBe(2);
  });

  it('never merges the report or date column', () => {
    // Two rows that agree on everything: only action and committee may merge.
    const items = [
      item('1', 'ביקור', ['אשקלון'], 'זהה', '2026-07-20'),
      item('2', 'ביקור', ['אשקלון'], 'זהה', '2026-07-20'),
    ];
    const rows = groupRows(items, SETTINGS, TYPES);
    expect(rows.map((r) => r.cells[2])).toEqual([{ text: 'זהה' }, { text: 'זהה' }]);
    expect(rows.map((r) => r.cells[3])).toEqual([
      { text: '2026-07-20' },
      { text: '2026-07-20' },
    ]);
  });
});
