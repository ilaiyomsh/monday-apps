/**
 * fetchRangeItems — the ONE query the whole interaction runs.
 *
 * Every guard here exists because the corresponding mistake fails SILENTLY
 * against the live API (probed 2026-07-29, findings §1/§2/§4):
 *   - a one-element or reversed `between` range, or a non-ISO date → zero rows,
 *     no error. Indistinguishable from "the reporter has nothing today".
 *   - a bare numeric user id in a people rule → zero rows, no error. The
 *     `person-<id>` prefix is mandatory.
 *   - a mirror column anywhere in query_params → HTTP 200 with
 *     InvalidColumnTypeException and `data.boards: [null]`, wiping the whole
 *     result set. The committee filter must stay client-side.
 *   - a truncated cursor drain → a report that looks complete and is not.
 *
 * Column-value fixtures are the verbatim responses captured in the probe run
 * (scratch board 18424252636), not hand-built shapes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../../utils/logger';
import {
  fetchRangeItems,
  buildRangeQueryParams,
  PAGE_LIMIT,
  MAX_PAGES,
} from '../itemsQuery';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../monday-client.js', () => ({ api: mocks.api }));

/* --- verbatim probe fixtures (see monday-probe-findings.md → FIXTURES) --- */

const CV_DATE = {
  id: 'wzdate',
  type: 'date',
  text: '2026-07-20',
  value: '{"date":"2026-07-20"}',
  date: '2026-07-20',
  time: '',
  updated_at: null,
};

const CV_MIRROR_MULTI = {
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value: 'Alpha, Beta',
  mirrored_items: [
    {
      linked_board_id: '18424252630',
      linked_item: { id: '12660747977', name: 'WZ-S1' },
      mirrored_value: { id: 'srctext', text: 'Alpha', value: '"Alpha"' },
    },
    {
      linked_board_id: '18424252630',
      linked_item: { id: '12660747980', name: 'WZ-S2' },
      mirrored_value: { id: 'srctext', text: 'Beta', value: '"Beta"' },
    },
  ],
};

const CV_PEOPLE = {
  id: 'wzpeople',
  type: 'people',
  text: 'עילי שלם',
  value: '{"personsAndTeams":[{"id":48274917,"kind":"person"}]}',
  persons_and_teams: [{ id: '48274917', kind: 'person' }],
  updated_at: null,
};

const COLUMNS = [
  { id: 'wzaction', type: 'text' },
  { id: 'wzmirror', type: 'mirror' },
  { id: 'wzreport', type: 'long_text' },
  { id: 'wzdate', type: 'date' },
  { id: 'wzpeople', type: 'people' },
];

const ARGS = {
  boardId: '18424252636',
  dateColumnId: 'wzdate',
  personColumnId: 'wzpeople',
  userId: '48274917',
  from: '2026-07-15',
  to: '2026-07-20',
  columns: COLUMNS,
};

const item = (id, name, column_values) => ({ id, name, column_values });
const firstPage = (items, cursor = null) => ({ boards: [{ items_page: { cursor, items } }] });
const nextPage = (items, cursor = null) => ({ next_items_page: { cursor, items } });

beforeEach(() => {
  mocks.api.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'group').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRangeQueryParams', () => {
  it('produces exactly the two server-side rules verified live, AND-ed together', () => {
    expect(
      buildRangeQueryParams({
        dateColumnId: 'wzdate',
        personColumnId: 'wzpeople',
        userId: '48274917',
        from: '2026-07-15',
        to: '2026-07-20',
      })
    ).toEqual({
      operator: 'and',
      rules: [
        { column_id: 'wzdate', compare_value: ['2026-07-15', '2026-07-20'], operator: 'between' },
        { column_id: 'wzpeople', compare_value: ['person-48274917'], operator: 'any_of' },
      ],
    });
  });

  it('expresses a single day as the SAME date twice (a one-element array returns zero rows)', () => {
    const qp = buildRangeQueryParams({
      dateColumnId: 'wzdate',
      personColumnId: 'wzpeople',
      userId: '48274917',
      from: '2026-07-20',
      to: '2026-07-20',
    });
    expect(qp.rules[0].compare_value).toEqual(['2026-07-20', '2026-07-20']);
  });

  it('prefixes a NUMERIC user id with person- (a bare id silently matches nothing)', () => {
    const qp = buildRangeQueryParams({
      dateColumnId: 'wzdate',
      personColumnId: 'wzpeople',
      userId: 48274917,
      from: '2026-07-20',
      to: '2026-07-20',
    });
    expect(qp.rules[1].compare_value).toEqual(['person-48274917']);
  });

  it('rejects a reversed range instead of shipping a query that returns nothing', () => {
    expect(() =>
      buildRangeQueryParams({
        dateColumnId: 'wzdate',
        personColumnId: 'wzpeople',
        userId: '1',
        from: '2026-07-20',
        to: '2026-07-15',
      })
    ).toThrow(/reversed/i);
  });

  it.each([['20/07/2026'], ['2026-13-01'], ['2026-07-32'], ['2026-7-1'], ['']])(
    'rejects the non-ISO / impossible date %s',
    (bad) => {
      expect(() =>
        buildRangeQueryParams({
          dateColumnId: 'wzdate',
          personColumnId: 'wzpeople',
          userId: '1',
          from: bad,
          to: '2026-07-20',
        })
      ).toThrow(/YYYY-MM-DD/);
    }
  );

  it('rejects a missing userId — the personal scope must never silently widen', () => {
    expect(() =>
      buildRangeQueryParams({
        dateColumnId: 'wzdate',
        personColumnId: 'wzpeople',
        userId: '',
        from: '2026-07-15',
        to: '2026-07-20',
      })
    ).toThrow(/userId/);
  });

  it('rejects an unmapped date or person column', () => {
    expect(() =>
      buildRangeQueryParams({
        dateColumnId: '',
        personColumnId: 'wzpeople',
        userId: '1',
        from: '2026-07-15',
        to: '2026-07-20',
      })
    ).toThrow(/dateColumnId/);
    expect(() =>
      buildRangeQueryParams({
        dateColumnId: 'wzdate',
        personColumnId: '',
        userId: '1',
        from: '2026-07-15',
        to: '2026-07-20',
      })
    ).toThrow(/personColumnId/);
  });
});

describe('fetchRangeItems — the request', () => {
  it('sends the board, the page limit, the two rules and the selected column ids as variables', async () => {
    mocks.api.mockResolvedValue(firstPage([]));

    await fetchRangeItems(ARGS);

    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api.mock.calls[0][1]).toEqual({
      boardId: ['18424252636'],
      limit: PAGE_LIMIT,
      qp: {
        operator: 'and',
        rules: [
          { column_id: 'wzdate', compare_value: ['2026-07-15', '2026-07-20'], operator: 'between' },
          { column_id: 'wzpeople', compare_value: ['person-48274917'], operator: 'any_of' },
        ],
      },
      ids: ['wzaction', 'wzmirror', 'wzreport', 'wzdate', 'wzpeople'],
    });
    expect(PAGE_LIMIT).toBe(500);
  });

  it('SELECTS the mirror column but never puts it in query_params', async () => {
    mocks.api.mockResolvedValue(firstPage([]));

    await fetchRangeItems(ARGS);

    const { qp, ids } = mocks.api.mock.calls[0][1];
    expect(ids).toContain('wzmirror');
    expect(qp.rules).toHaveLength(2);
    expect(JSON.stringify(qp)).not.toContain('wzmirror');
  });

  it('asks for the mirror fragment in the query it sends', async () => {
    mocks.api.mockResolvedValue(firstPage([]));

    await fetchRangeItems(ARGS);

    expect(mocks.api.mock.calls[0][0]).toContain('... on MirrorValue');
    expect(mocks.api.mock.calls[0][2]).toBe('fetchRangeItems');
  });

  it('refuses to build a range filter on a MIRROR column (it nulls the whole board node)', async () => {
    await expect(
      fetchRangeItems({ ...ARGS, dateColumnId: 'wzmirror' })
    ).rejects.toThrow(/mirror/i);
    await expect(
      fetchRangeItems({ ...ARGS, personColumnId: 'wzmirror' })
    ).rejects.toThrow(/mirror/i);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('refuses to run without a board id or without mapped columns, and never calls the API', async () => {
    await expect(fetchRangeItems({ ...ARGS, boardId: '' })).rejects.toThrow(/boardId/);
    await expect(fetchRangeItems({ ...ARGS, columns: [] })).rejects.toThrow(/columns/);
    await expect(fetchRangeItems({ ...ARGS, columns: undefined })).rejects.toThrow(/columns/);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('de-duplicates repeated column ids in the selection', async () => {
    mocks.api.mockResolvedValue(firstPage([]));

    await fetchRangeItems({
      ...ARGS,
      columns: [
        { id: 'wzdate', type: 'date' },
        { id: 'wzdate', type: 'date' },
        { id: 'wzpeople', type: 'people' },
      ],
    });

    expect(mocks.api.mock.calls[0][1].ids).toEqual(['wzdate', 'wzpeople']);
  });
});

describe('fetchRangeItems — the result', () => {
  it('returns { id, name, cv } keyed by column id, preserving the raw column value', async () => {
    mocks.api.mockResolvedValue(
      firstPage([item('12660725823', 'WZ-R2', [CV_DATE, CV_MIRROR_MULTI, CV_PEOPLE])])
    );

    const items = await fetchRangeItems(ARGS);

    expect(items).toEqual([
      {
        id: '12660725823',
        name: 'WZ-R2',
        cv: { wzdate: CV_DATE, wzmirror: CV_MIRROR_MULTI, wzpeople: CV_PEOPLE },
      },
    ]);
    // the mirror must survive intact — mirrored_items is the only unambiguous
    // source of the committee names
    expect(items[0].cv.wzmirror.mirrored_items).toHaveLength(2);
    expect(items[0].cv.wzmirror.mirrored_items[1].mirrored_value.text).toBe('Beta');
  });

  it('normalises a numeric item id to a string so downstream === comparisons hold', async () => {
    mocks.api.mockResolvedValue(firstPage([item(12660725823, 'WZ-R2', [CV_DATE])]));

    const items = await fetchRangeItems(ARGS);

    expect(items[0].id).toBe('12660725823');
  });

  it('returns an empty cv map for an item with no column_values at all', async () => {
    mocks.api.mockResolvedValue(firstPage([{ id: '1', name: 'WZ-R3' }]));

    const items = await fetchRangeItems(ARGS);

    expect(items).toEqual([{ id: '1', name: 'WZ-R3', cv: {} }]);
  });

  it('returns [] for a range with no matching items', async () => {
    mocks.api.mockResolvedValue(firstPage([]));
    await expect(fetchRangeItems(ARGS)).resolves.toEqual([]);
  });
});

describe('fetchRangeItems — cursor drain', () => {
  it('follows the cursor through the ROOT next_items_page and concatenates in order', async () => {
    mocks.api
      .mockResolvedValueOnce(firstPage([item('1', 'A', [CV_DATE])], 'CURSOR1'))
      .mockResolvedValueOnce(nextPage([item('2', 'B', [CV_DATE])], null));

    const items = await fetchRangeItems(ARGS);

    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.api.mock.calls[1][0]).toContain('next_items_page');
    expect(mocks.api.mock.calls[1][1]).toEqual({
      cursor: 'CURSOR1',
      limit: PAGE_LIMIT,
      ids: ['wzaction', 'wzmirror', 'wzreport', 'wzdate', 'wzpeople'],
    });
  });

  it('stops at the page cap and WARNS — a truncated report must never read as complete', async () => {
    // every page keeps offering a cursor, first page and continuations alike
    mocks.api.mockImplementation((query) =>
      Promise.resolve(
        String(query).includes('next_items_page')
          ? nextPage([item('x', 'X', [CV_DATE])], 'ALWAYS_MORE')
          : firstPage([item('x', 'X', [CV_DATE])], 'ALWAYS_MORE')
      )
    );
    const warnSpy = vi.spyOn(logger, 'warn');

    const items = await fetchRangeItems(ARGS);

    expect(mocks.api).toHaveBeenCalledTimes(MAX_PAGES);
    expect(items).toHaveLength(MAX_PAGES);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toMatch(/MAX_PAGES|עמודים|truncat/i);
  });

  it('throws when monday nulls the board node instead of returning an empty report', async () => {
    mocks.api.mockResolvedValue({ boards: [null] });

    await expect(fetchRangeItems(ARGS)).rejects.toThrow(/null board/i);
  });

  it('throws when the board is missing from the response entirely', async () => {
    mocks.api.mockResolvedValue({ boards: [] });

    await expect(fetchRangeItems(ARGS)).rejects.toThrow(/null board/i);
  });

  it('throws the diagnosable error — not a TypeError — when the board node has no items_page', async () => {
    // The board resolved but items_page did not (an errored sub-selection inside a
    // 200). Without the second half of the page-1 guard this falls through to
    // `pageData.items` and dies as "Cannot read properties of undefined", which
    // tells the owner nothing about their board or their column mapping.
    mocks.api.mockResolvedValue({ boards: [{ id: '18424252636' }] });

    let caught;
    try {
      await fetchRangeItems(ARGS);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(caught.message).toMatch(/null board/i);
    expect(caught.message).toContain('18424252636');
  });
});
