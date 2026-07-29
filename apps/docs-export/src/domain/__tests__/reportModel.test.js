import { describe, expect, it } from 'vitest';
import { buildReportModel } from '../reportModel.js';

// buildReportModel is the seam the .docx builder consumes, so these tests pin the
// OUTPUT CONTRACT (block order, header resolution, title, row shape) and the one
// piece of real logic it owns: applying the client-side committee filter before
// grouping. Ordering and merging themselves belong to rowGrouping's suite.
//
// Column values are the live probe captures of 2026-07-29 (API 2026-04).

const COLUMNS = [
  { id: 'act', title: 'פעולה בלוח', type: 'text' },
  { id: 'wzmirror', title: 'ועדה בלוח', type: 'mirror' },
  { id: 'rep', title: 'דיווח בלוח', type: 'long_text' },
  { id: 'wzdate', title: 'תאריך בלוח', type: 'date' },
  { id: 'wzpeople', title: 'אחראי בלוח', type: 'people' },
];

const SETTINGS = {
  version: 1,
  boardId: '18424252636',
  columns: {
    action: 'act',
    committee: 'wzmirror',
    report: 'rep',
    date: 'wzdate',
    person: 'wzpeople',
  },
  headers: { action: '', committee: '', report: '', date: '' },
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0,
  blocks: [
    { id: 'b1', type: 'text', text: 'דוח פעילות שבועי' },
    { id: 'b2', type: 'table' },
    { id: 'b3', type: 'text', text: 'בכבוד רב' },
  ],
};

const DAILY = { kind: 'daily', from: '2026-07-29', to: '2026-07-29', label: '29.07.2026' };
const WEEKLY = {
  kind: 'weekly',
  from: '2026-07-26',
  to: '2026-08-01',
  label: '26.07.2026 - 01.08.2026',
};

const text = (id, value) => ({ id, type: 'text', text: value, value: JSON.stringify(value) });

const date = (value) => ({
  id: 'wzdate',
  type: 'date',
  text: value,
  value: `{"date":"${value}"}`,
  date: value,
  time: '',
});

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

const ITEMS = [
  item('1', 'ביקור', ['אשקלון'], 'ד1', '2026-07-27'),
  item('2', 'ביקור', ['באר שבע'], 'ד2', '2026-07-28'),
  item('3', 'תיאום', ['אשקלון'], 'ד3', '2026-07-29'),
];

const build = (over = {}) =>
  buildReportModel({
    items: ITEMS,
    settings: SETTINGS,
    columns: COLUMNS,
    range: WEEKLY,
    selectedCommittees: null,
    ...over,
  });

describe('buildReportModel — blocks', () => {
  it('emits the settings blocks in order, stripped to type and text', () => {
    expect(build().blocks).toEqual([
      { type: 'text', text: 'דוח פעילות שבועי' },
      { type: 'table' },
      { type: 'text', text: 'בכבוד רב' },
    ]);
  });

  it('keeps an empty text block, which is a deliberate blank paragraph', () => {
    const settings = {
      ...SETTINGS,
      blocks: [{ id: 'b1', type: 'text', text: '' }, { id: 'b2', type: 'table' }],
    };
    expect(build({ settings }).blocks).toEqual([{ type: 'text', text: '' }, { type: 'table' }]);
    });

  it('still emits exactly one table block when the stored settings hold none', () => {
    // normalizeSettings repairs the blob; the document must never come out
    // table-less just because a write landed half-done.
    const settings = { ...SETTINGS, blocks: [{ id: 'b1', type: 'text', text: 'רק טקסט' }] };
    const { blocks } = build({ settings });
    expect(blocks.filter((b) => b.type === 'table')).toHaveLength(1);
  });

  it('emits a single table block for a missing settings blob rather than throwing', () => {
    const { blocks } = build({ settings: undefined });
    expect(blocks).toEqual([{ type: 'table' }]);
  });
});

describe('buildReportModel — headers', () => {
  it('falls back to the board column titles when no override is set', () => {
    expect(build().table.headers).toEqual([
      'פעולה בלוח',
      'ועדה בלוח',
      'דיווח בלוח',
      'תאריך בלוח',
    ]);
  });

  it('prefers a per-role override over the board column title', () => {
    const settings = {
      ...SETTINGS,
      headers: { action: 'הפעולה', committee: '', report: 'מה נעשה', date: '' },
    };
    expect(build({ settings }).table.headers).toEqual([
      'הפעולה',
      'ועדה בלוח',
      'מה נעשה',
      'תאריך בלוח',
    ]);
  });

  it('treats a whitespace-only override as no override', () => {
    const settings = { ...SETTINGS, headers: { ...SETTINGS.headers, action: '   ' } };
    expect(build({ settings }).table.headers[0]).toBe('פעולה בלוח');
  });

  it('falls back to the built-in Hebrew labels when the board columns are unknown', () => {
    // The report can be generated from cached settings before boardMeta answers.
    expect(build({ columns: [] }).table.headers).toEqual([
      'פעולה',
      'שם הועדה האזורית',
      'דיווח',
      'תאריך דיווח',
    ]);
  });

  it('uses the built-in label for a role whose mapped column is missing from the board', () => {
    const columns = COLUMNS.filter((c) => c.id !== 'rep');
    expect(build({ columns }).table.headers[2]).toBe('דיווח');
  });

  it('emits exactly four headers — the person role is never a table column', () => {
    const { headers } = build().table;
    expect(headers).toHaveLength(4);
    expect(headers).not.toContain('אחראי בלוח');
  });

  it('accepts columns as a { [id]: {title, type} } map as well as an array', () => {
    const asMap = Object.fromEntries(COLUMNS.map((c) => [c.id, { title: c.title, type: c.type }]));
    expect(build({ columns: asMap }).table.headers).toEqual(build().table.headers);
  });
});

describe('buildReportModel — the table rows', () => {
  it('emits one row per item when nothing is filtered out', () => {
    const { rows } = build().table;
    expect(rows).toHaveLength(3);
    expect(rows[0].cells).toHaveLength(4);
  });

  it('applies the merge that rowGrouping computes', () => {
    // 'ביקור' covers the first two rows, so its cell carries the span.
    const { rows } = build().table;
    expect(rows[0].cells[0]).toEqual({ text: 'ביקור', rowSpan: 2 });
    expect(rows[1].cells[0]).toBeNull();
  });

  it('honours the committee selection, dropping every other committee', () => {
    const { rows } = build({ selectedCommittees: ['באר שבע'] }).table;
    expect(rows).toHaveLength(1);
    expect(rows[0].cells[2].text).toBe('ד2');
  });

  it('keeps every item when the selection is null (nothing chosen yet)', () => {
    expect(build({ selectedCommittees: null }).table.rows).toHaveLength(3);
  });

  it('emits no rows for an EMPTY selection instead of silently reporting everything', () => {
    expect(build({ selectedCommittees: [] }).table.rows).toEqual([]);
  });

  it('matches an item that carries the selected committee among several', () => {
    const items = [item('1', 'ביקור', ['אשקלון', 'באר שבע'], 'ד1', '2026-07-27')];
    expect(build({ items, selectedCommittees: ['באר שבע'] }).table.rows).toHaveLength(1);
  });

  it('does NOT match a committee that is merely a comma-separated part of one value', () => {
    // display_value 'גליל, גולן' from ONE source value is the committee named
    // "גליל, גולן" — selecting 'גליל' must not pull it in (probe finding 3).
    const items = [item('1', 'ביקור', ['גליל, גולן'], 'ד1', '2026-07-27')];
    expect(build({ items, selectedCommittees: ['גליל'] }).table.rows).toEqual([]);
    expect(build({ items, selectedCommittees: ['גליל, גולן'] }).table.rows).toHaveLength(1);
  });

  it('emits no rows for no items', () => {
    expect(build({ items: [] }).table.rows).toEqual([]);
  });

  it('emits no rows instead of throwing when items is not an array', () => {
    expect(build({ items: undefined }).table.rows).toEqual([]);
  });

  it('renders the committee cell from the mirror display_value', () => {
    const items = [item('1', 'ביקור', ['אשקלון', 'באר שבע'], 'ד1', '2026-07-27')];
    expect(build({ items }).table.rows[0].cells[1].text).toBe('אשקלון, באר שבע');
  });
});

describe('buildReportModel — title', () => {
  it('names a weekly report with the range label', () => {
    expect(build({ range: WEEKLY }).title).toBe('דוח שבועי 26.07.2026 - 01.08.2026');
  });

  it('names a daily report with the single-day label', () => {
    expect(build({ range: DAILY }).title).toBe('דוח יומי 29.07.2026');
  });

  it('falls back to a bare title when the range is missing', () => {
    expect(build({ range: undefined }).title).toBe('דוח');
  });

  it('falls back to the label alone for an unknown range kind', () => {
    const range = { ...DAILY, kind: 'monthly' };
    expect(build({ range }).title).toBe('דוח 29.07.2026');
  });
});
