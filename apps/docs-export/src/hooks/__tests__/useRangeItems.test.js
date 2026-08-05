/**
 * useRangeItems — THE query of this app, and the state around it.
 *
 * Everything asserted here is a failure mode that is otherwise invisible:
 *   - a wrong `columns` selection silently renders empty cells (the fragment for
 *     the mirror is only requested when the mirror's TYPE is in the selection);
 *   - a stale in-flight response overwriting a newer one shows the user YESTERDAY's
 *     rows under today's label — a plausible, wrong report;
 *   - firing the query with a half-mapped settings blob wastes complexity budget and
 *     answers zero rows, which reads as "nothing to report".
 *
 * The mirror/date/people column-value shapes are VERBATIM probe captures
 * (2026-07-29, scratch board 18424252636 — the same fixtures as
 * services/__tests__/itemsQuery.test.js and domain/__tests__/committees.test.js).
 * `services/itemsQuery` itself is faked at the module boundary: it is separately
 * tested, and the point here is WHICH call this hook makes and WHEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import logger from '../../utils/logger';
import { useRangeItems } from '../useRangeItems';

const mocks = vi.hoisted(() => ({ fetchRangeItems: vi.fn() }));
vi.mock('../../services/itemsQuery.js', () => ({ fetchRangeItems: mocks.fetchRangeItems }));

/* ------------------------------ probe fixtures ------------------------------ */

const mirror = (display_value, mirrored_items) => ({
  id: 'wzmirror',
  type: 'mirror',
  text: null,
  value: null,
  display_value,
  mirrored_items,
});

const link = (id, name, text) => ({
  linked_board_id: '18424252630',
  linked_item: { id, name },
  mirrored_value: { id: 'srctext', text, value: JSON.stringify(text) },
});

const CV_DATE = {
  id: 'wzdate',
  type: 'date',
  text: '2026-07-29',
  value: '{"date":"2026-07-29"}',
  date: '2026-07-29',
  time: '',
};

const itemWith = (id, committees) => ({
  id,
  name: `WZ-R${id}`,
  cv: {
    wzaction: { id: 'wzaction', type: 'text', text: 'ביקור', value: '"ביקור"' },
    wzmirror: mirror(
      committees.join(', '),
      committees.map((name, i) => link(`1266074797${i}`, `WZ-S${i}`, name))
    ),
    wzreport: { id: 'wzreport', type: 'long_text', text: 'דיווח', value: null },
    wzdate: CV_DATE,
  },
});

/** Two items, three committees, second-item order proves first-appearance order. */
const DAILY_ITEMS = [itemWith('1', ['בקעת הירדן', 'שומרון']), itemWith('2', ['שומרון', 'גליל'])];
const WEEKLY_ITEMS = [...DAILY_ITEMS, itemWith('3', ['נגב'])];

/** boardMeta shape: id + title + type. `name` is present and must NOT be selected. */
const BOARD_COLUMNS = [
  { id: 'name', title: 'שם', type: 'name' },
  { id: 'wzaction', title: 'פעולה', type: 'text' },
  { id: 'wzmirror', title: 'ועדה אזורית', type: 'mirror' },
  { id: 'wzreport', title: 'דיווח', type: 'long_text' },
  { id: 'wzdate', title: 'תאריך דיווח', type: 'date' },
  { id: 'wzpeople', title: 'אחראי', type: 'people' },
];

/** The selection the query MUST receive: the five mapped roles, in role order. */
const EXPECTED_SELECTION = [
  { id: 'wzaction', type: 'text' },
  { id: 'wzmirror', type: 'mirror' },
  { id: 'wzreport', type: 'long_text' },
  { id: 'wzdate', type: 'date' },
  { id: 'wzpeople', type: 'people' },
];

const SETTINGS = {
  version: 1,
  boardId: '18424252636',
  columns: {
    action: 'wzaction',
    committee: 'wzmirror',
    report: 'wzreport',
    date: 'wzdate',
    person: 'wzpeople',
  },
  headers: { action: '', committee: '', report: '', date: '' },
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0,
  blocks: [{ id: 'table', type: 'table' }],
};

const USER_ID = '48274917';

const props = (over = {}) => ({
  settings: SETTINGS,
  columns: BOARD_COLUMNS,
  userId: USER_ID,
  kind: 'daily',
  ...over,
});

/** A promise whose settlement the test controls. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.fetchRangeItems.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Wednesday 2026-07-29, local noon (never near a TZ boundary).
  vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRangeItems — the one query', () => {
  it('queries the mapped board once for today with the person-scoped user and the five mapped columns', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);

    const { result } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRangeItems).toHaveBeenCalledWith({
      boardId: '18424252636',
      dateColumnId: 'wzdate',
      personColumnId: 'wzpeople',
      userId: USER_ID,
      from: '2026-07-29',
      to: '2026-07-29',
      columns: EXPECTED_SELECTION,
    });
  });

  it('reports the daily label and window for kind="daily"', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);
    const { result } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    expect(result.current.range).toEqual({
      kind: 'daily',
      from: '2026-07-29',
      to: '2026-07-29',
      label: '29.07.2026',
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('queries the whole Sunday..Saturday week for kind="weekly"', async () => {
    mocks.fetchRangeItems.mockResolvedValue(WEEKLY_ITEMS);
    const { result } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ kind: 'weekly' }),
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(mocks.fetchRangeItems.mock.calls[0][0]).toMatchObject({
      from: '2026-07-26',
      to: '2026-08-01',
    });
    expect(result.current.range.label).toBe('26.07.2026 - 01.08.2026');
  });

  it('honours settings.weekStartsOn=1 by starting the week on Monday', async () => {
    mocks.fetchRangeItems.mockResolvedValue(WEEKLY_ITEMS);
    const { result } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ kind: 'weekly', settings: { ...SETTINGS, weekStartsOn: 1 } }),
    });

    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1));
    expect(mocks.fetchRangeItems.mock.calls[0][0]).toMatchObject({
      from: '2026-07-27',
      to: '2026-08-02',
    });
    expect(result.current.range.label).toBe('27.07.2026 - 02.08.2026');
  });

  it('derives the committee options from the mirror column in first-appearance order', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);
    const { result } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    await waitFor(() => expect(result.current.committees).toHaveLength(3));
    expect(result.current.committees).toEqual(['בקעת הירדן', 'שומרון', 'גליל']);
  });

  it('is loading while the query is in flight and settled once the rows arrive', async () => {
    const d = deferred();
    mocks.fetchRangeItems.mockReturnValue(d.promise);

    const { result } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.items).toEqual([]);

    await act(async () => {
      d.resolve(DAILY_ITEMS);
      await d.promise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual(DAILY_ITEMS);
    expect(result.current.error).toBeNull();
  });

  it('keeps the newest range rows when the older in-flight response resolves last', async () => {
    const daily = deferred();
    const weekly = deferred();
    mocks.fetchRangeItems.mockImplementation(({ from, to }) =>
      from === to ? daily.promise : weekly.promise
    );

    const { result, rerender } = renderHook((p) => useRangeItems(p), { initialProps: props() });
    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1));

    // The user flips to weekly while the daily query is still in flight.
    rerender(props({ kind: 'weekly' }));
    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(2));

    // The NEW query answers first, the stale one afterwards.
    await act(async () => {
      weekly.resolve(WEEKLY_ITEMS);
      await weekly.promise;
    });
    await act(async () => {
      daily.resolve(DAILY_ITEMS);
      await daily.promise;
    });

    expect(result.current.items).toEqual(WEEKLY_ITEMS);
    expect(result.current.items).toHaveLength(3);
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces the failure, logs it once and leaves no rows when the query rejects', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const boom = new Error('InvalidColumnTypeException');
    mocks.fetchRangeItems.mockRejectedValue(boom);

    const { result } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    await waitFor(() => expect(result.current.error).toBe(boom));
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe('useRangeItems');
    expect(errorSpy.mock.calls[0][2]).toBe(boom);
  });

  it('never queries while a role is left unmapped', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);
    const half = { ...SETTINGS, columns: { ...SETTINGS.columns, person: '' } };

    const { result } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ settings: half }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetchRangeItems).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.committees).toEqual([]);
  });

  it('never queries before the board columns have loaded', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);

    const { result, rerender } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ columns: [] }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetchRangeItems).not.toHaveBeenCalled();

    // …and fires as soon as they do.
    rerender(props());
    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1));
  });

  it('never queries without a current user id (the personal scope would widen to the whole board)', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);

    const { result } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ userId: undefined }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetchRangeItems).not.toHaveBeenCalled();
  });

  it('does not re-query when the caller re-renders with an equal settings object', async () => {
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);
    const { rerender } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1));
    // A fresh object with identical contents — what a context re-render delivers.
    rerender(props({ settings: { ...SETTINGS, columns: { ...SETTINGS.columns } } }));
    rerender(props({ columns: [...BOARD_COLUMNS] }));

    await waitFor(() => expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(1));
  });

  it('stays quiet about "missing" columns while the board columns are still loading', async () => {
    // Regression: `columns: []` is what useReportBoardMeta holds until its read lands,
    // i.e. the state of EVERY boot. Treating it as "the mapped ids are absent from the
    // board" warned a perfectly configured instance that its settings were broken, on
    // every session, and shipped that false alarm to Axiom.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);

    const { result } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ columns: [] }),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.fetchRangeItems).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once the columns HAVE loaded and a mapped role is absent from the board', async () => {
    // The other side of the same coin: a column the owner mapped and then deleted is a
    // real misconfiguration, and silence there looks exactly like "nothing to report".
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mocks.fetchRangeItems.mockResolvedValue(DAILY_ITEMS);
    const withoutDate = BOARD_COLUMNS.filter((column) => column.id !== 'wzdate');

    const { result } = renderHook((p) => useRangeItems(p), {
      initialProps: props({ columns: withoutDate }),
    });

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));
    expect(warnSpy.mock.calls[0][0]).toBe('useRangeItems');
    expect(warnSpy.mock.calls[0][2]).toMatchObject({ missing: 'wzdate' });
    // …and it still refuses to fire a query it cannot build correctly.
    expect(mocks.fetchRangeItems).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('re-runs the same query on reload() and replaces the rows', async () => {
    mocks.fetchRangeItems.mockResolvedValueOnce(DAILY_ITEMS).mockResolvedValueOnce(WEEKLY_ITEMS);
    const { result } = renderHook((p) => useRangeItems(p), { initialProps: props() });

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(mocks.fetchRangeItems).toHaveBeenCalledTimes(2);
    expect(mocks.fetchRangeItems.mock.calls[1][0]).toMatchObject({
      from: '2026-07-29',
      to: '2026-07-29',
    });
  });
});
