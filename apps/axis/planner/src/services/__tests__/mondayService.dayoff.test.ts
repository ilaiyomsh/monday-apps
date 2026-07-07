import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Funnel mock — fetchDayOffsForRange must go through apiQueue (the app's single
// API funnel) via _fetchPaginatedItems; tests drive the responses here.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../apiQueue', () => ({ apiQueue: { execute } }));
vi.mock('monday-sdk-js', () => ({ default: () => ({}) }));

import { mondayService, DAY_OFF_FETCH_WIDENING_DAYS } from '../mondayService';
import { logger } from '../../utils/Logger';

const settings = {
  dayOffBoardId: 'board-9',
  dayOffEmployeeColumnId: 'people_col',
  dayOffStartDateColumnId: 'start_col',
  dayOffEndDateColumnId: 'end_col',
  dayOffKindColumnId: 'kind_col',
  dayOffTypeColumnId: 'type_col',
  dayOffApprovalColumnId: 'approval_col',
};

/** Builds a raw monday item with start/end date column values. */
const makeItem = (id: string, start?: string, end?: string) => ({
  id,
  name: `item-${id}`,
  column_values: [
    ...(start !== undefined ? [{ id: 'start_col', text: start }] : []),
    ...(end !== undefined ? [{ id: 'end_col', text: end }] : []),
  ],
});

const boardsPage = (items: unknown[], cursor: string | null = null) => ({
  data: { boards: [{ items_page: { cursor, items } }] },
});

const nextPage = (items: unknown[], cursor: string | null = null) => ({
  data: { next_items_page: { cursor, items } },
});

const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

beforeEach(() => {
  execute.mockReset();
  // Silence + observe the service logger (default level in tests is DEBUG).
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mondayService.fetchDayOffsForRange', () => {
  it('fails loudly when the start/end date columns are not mapped (no silent empty reads)', async () => {
    await expect(
      mondayService.fetchDayOffsForRange('board-9', '2026-06-01', '2026-06-30', {
        ...settings,
        dayOffStartDateColumnId: '',
      })
    ).rejects.toThrow(/half-configured/);
    await expect(
      mondayService.fetchDayOffsForRange('board-9', '2026-06-01', '2026-06-30', {
        ...settings,
        dayOffEndDateColumnId: undefined,
      })
    ).rejects.toThrow(/half-configured/);
    await expect(
      mondayService.fetchDayOffsForRange('', '2026-06-01', '2026-06-30', settings)
    ).rejects.toThrow(/half-configured/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects window bounds that are not YYYY-MM-DD day-keys', async () => {
    await expect(
      mondayService.fetchDayOffsForRange('board-9', '06/01/2026', '2026-06-30', settings)
    ).rejects.toThrow(/day-keys/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('queries a widened between/OR window over both date columns', async () => {
    execute.mockResolvedValue(boardsPage([]));
    await mondayService.fetchDayOffsForRange('board-9', '2026-06-01', '2026-06-30', settings);

    expect(execute).toHaveBeenCalledTimes(1);
    const [query, opts] = execute.mock.calls[0] as [string, { variables: unknown }];
    expect(opts.variables).toEqual({ boardId: ['board-9'] });
    // ±366 days around the real window (2026 / 2027 contain no Feb 29 in span)
    expect(query).toContain(
      '{ column_id: "start_col", compare_value: ["2025-05-31", "2027-07-01"], operator: between }'
    );
    expect(query).toContain(
      '{ column_id: "end_col", compare_value: ["2025-05-31", "2027-07-01"], operator: between }'
    );
    expect(query).toContain('operator: or');
    expect(DAY_OFF_FETCH_WIDENING_DAYS).toBe(366);
  });

  it('queries only the mapped columns (plus item name for general entries)', async () => {
    execute.mockResolvedValue(boardsPage([]));
    await mondayService.fetchDayOffsForRange('board-9', '2026-06-01', '2026-06-30', settings);
    const [query] = execute.mock.calls[0] as [string];
    expect(query).toContain(
      'column_values (ids: ["people_col", "start_col", "end_col", "kind_col", "type_col", "approval_col"])'
    );
    expect(query).toContain('name');

    execute.mockClear();
    execute.mockResolvedValue(boardsPage([]));
    const minimal = {
      dayOffStartDateColumnId: 'start_col',
      dayOffEndDateColumnId: 'end_col',
    };
    await mondayService.fetchDayOffsForRange('board-9', '2026-06-01', '2026-06-30', minimal);
    const [minimalQuery] = execute.mock.calls[0] as [string];
    expect(minimalQuery).toContain('column_values (ids: ["start_col", "end_col"])');
    expect(minimalQuery).not.toContain('kind_col');
    expect(minimalQuery).not.toContain('people_col');
  });

  it('includes the mandatory checkbox column when mapped, with a CheckboxValue fragment (W3.4)', async () => {
    execute.mockResolvedValue(boardsPage([]));
    await mondayService.fetchDayOffsForRange('board-9', '2026-06-01', '2026-06-30', {
      ...settings,
      dayOffMandatoryColumnId: 'mandatory_col',
    });
    const [query] = execute.mock.calls[0] as [string];
    expect(query).toContain(
      'column_values (ids: ["people_col", "start_col", "end_col", "kind_col", "type_col", "mandatory_col", "approval_col"])'
    );
    // Checkbox `checked` is read via the typed fragment (contract §4 read rule).
    expect(query).toContain('... on CheckboxValue');
    expect(query).toContain('checked');
  });

  it('keeps only items overlapping the real window — including an item spanning the ENTIRE window', async () => {
    execute.mockResolvedValue(
      boardsPage([
        makeItem('inside', '2026-06-10', '2026-06-12'),
        makeItem('spanning-whole-window', '2026-01-01', '2026-12-31'),
        makeItem('touches-start-edge', '2026-05-20', '2026-06-01'),
        makeItem('touches-end-edge', '2026-06-30', '2026-07-15'),
        makeItem('single-day', '2026-06-15', '2026-06-15'),
        makeItem('before-window', '2026-04-01', '2026-05-31'),
        makeItem('after-window', '2026-07-01', '2026-08-01'),
      ])
    );

    const result = await mondayService.fetchDayOffsForRange(
      'board-9',
      '2026-06-01',
      '2026-06-30',
      settings
    );

    expect(ids(result)).toEqual([
      'inside',
      'spanning-whole-window',
      'touches-start-edge',
      'touches-end-edge',
      'single-day',
    ]);
  });

  it('handles cross-year windows (Dec–Jan) correctly', async () => {
    execute.mockResolvedValue(
      boardsPage([
        makeItem('dec-jan', '2026-12-30', '2027-01-05'),
        makeItem('spans-boundary-and-window', '2026-11-01', '2027-03-01'),
        makeItem('ends-on-window-start', '2026-12-01', '2026-12-20'),
        makeItem('ends-day-before-window', '2026-10-01', '2026-12-19'),
        makeItem('starts-after-window', '2027-01-11', '2027-02-01'),
      ])
    );

    const result = await mondayService.fetchDayOffsForRange(
      'board-9',
      '2026-12-20',
      '2027-01-10',
      settings
    );

    expect(ids(result)).toEqual(['dec-jan', 'spans-boundary-and-window', 'ends-on-window-start']);

    // Widened bounds also cross year edges correctly
    const [query] = execute.mock.calls[0] as [string];
    expect(query).toContain('compare_value: ["2025-12-19", "2028-01-11"]');
  });

  it('drops items missing a valid start/end date (CONTRACT.md §2: skip, never guess) and warns', async () => {
    execute.mockResolvedValue(
      boardsPage([
        makeItem('valid', '2026-06-05', '2026-06-08'),
        makeItem('missing-end', '2026-06-05', undefined),
        makeItem('empty-start', '', '2026-06-08'),
        makeItem('garbage-date', 'not-a-date', '2026-06-08'),
      ])
    );

    const result = await mondayService.fetchDayOffsForRange(
      'board-9',
      '2026-06-01',
      '2026-06-30',
      settings
    );

    expect(ids(result)).toEqual(['valid']);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dropped 3 item(s)'));
  });

  it('paginates through cursors via the funnel and filters across all pages', async () => {
    execute
      .mockResolvedValueOnce(boardsPage([makeItem('page1-keep', '2026-06-02', '2026-06-03')], 'cursor-1'))
      .mockResolvedValueOnce(
        nextPage([
          makeItem('page2-keep', '2025-12-01', '2027-12-01'),
          makeItem('page2-drop', '2026-08-01', '2026-08-10'),
        ])
      );

    const result = await mondayService.fetchDayOffsForRange(
      'board-9',
      '2026-06-01',
      '2026-06-30',
      settings
    );

    expect(execute).toHaveBeenCalledTimes(2);
    const [, secondOpts] = execute.mock.calls[1] as [string, { variables: unknown }];
    expect(secondOpts.variables).toEqual({ cursor: 'cursor-1' });
    expect(ids(result)).toEqual(['page1-keep', 'page2-keep']);
  });
});
