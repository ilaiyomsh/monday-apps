// Board-picker discriminator + pagination.
//
// PROBE-CAPTURED, 2026-07-27, API version 2026-07, real account (1000+ objects).
// Every shape below comes from `boards(limit: 500, order_by: used_at)` run
// through .claude/skills/mapps/mapps-api.sh — NOT invented. The previous
// version of this file invented `object_type_unique_key: 'board'`, which no
// board in the account actually returns; the tests passed and the feature was
// broken in production (the picker rendered "No options").
//
// What the probe established:
//   type distribution (page 1 of 500):
//     board 330 | sub_items_board 80 | custom_object 56 | document 34
//   object_type_unique_key is UNUSABLE as a discriminator:
//     null for 304 of the 330 real boards, AND null for every document,
//     sub-item board and custom object. When non-null it only ever appears on
//     type='board', as 'work-management::{standalone|project|portfolio-project|portfolio}'.
//   => `type` is the discriminator. otuk is only a reliable NEGATIVE signal,
//      and only when actually present.
//   Pagination: page 1 returned exactly 500 and page 2 returned another 500
//   (262 of them real boards) — a single page silently hid boards.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above module-scope consts, so the mock's fn must be
// created inside vi.hoisted to exist when the factory runs.
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('monday-sdk-js', () => ({
  default: () => ({
    api: apiMock,
    get: vi.fn(async () => ({ data: 'tok' })),
  }),
}));

import { isRealBoard, fetchBoards, REAL_BOARD_TYPE, BOARDS_PAGE_SIZE, BOARDS_MAX_PAGES } from './monday';

/** Build a probe-shaped row. */
const row = (id: string, name: string, type: string, otuk: string | null = null) => ({
  id,
  name,
  type,
  object_type_unique_key: otuk,
});

describe('isRealBoard', () => {
  it('keeps a plain work board whose object_type_unique_key is null (304 of 330 in the probe)', () => {
    // The exact shape that the old otuk-based filter dropped, breaking the picker.
    expect(isRealBoard(row('111', 'משימות status-email', 'board', null))).toBe(true);
    expect(isRealBoard(row('112', 'משימות', 'board', null))).toBe(true);
  });

  it('keeps the namespaced board flavours the probe found on type=board', () => {
    expect(isRealBoard(row('1', 'a', 'board', 'work-management::standalone'))).toBe(true);
    expect(isRealBoard(row('2', 'b', 'board', 'work-management::project'))).toBe(true);
  });

  it('drops sub-item boards, custom objects and documents by type', () => {
    expect(isRealBoard(row('3', 'subs', 'sub_items_board', null))).toBe(false);
    expect(isRealBoard(row('4', 'obj', 'custom_object', null))).toBe(false);
    expect(isRealBoard(row('5', 'doc', 'document', null))).toBe(false);
  });

  it('drops portfolios — otuk is trusted only when present, never to exclude a null', () => {
    expect(isRealBoard(row('6', 'p', 'board', 'work-management::portfolio'))).toBe(false);
    expect(isRealBoard(row('7', 'pp', 'board', 'work-management::portfolio-project'))).toBe(false);
    // bare form, no namespace
    expect(isRealBoard(row('8', 'p2', 'board', 'portfolio'))).toBe(false);
  });

  it('drops a missing / non-string type', () => {
    expect(isRealBoard({ type: null })).toBe(false);
    expect(isRealBoard({ type: undefined })).toBe(false);
    expect(isRealBoard({})).toBe(false);
  });

  it('exposes the board type constant', () => {
    expect(REAL_BOARD_TYPE).toBe('board');
  });
});

describe('fetchBoards', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('queries `type` — the field the filter actually depends on', async () => {
    apiMock.mockResolvedValue({ data: { boards: [row('1', 'a', 'board')] } });
    await fetchBoards();
    expect(apiMock.mock.calls[0][0]).toContain('type');
  });

  it('returns only real boards, mapped to {id,name}', async () => {
    apiMock.mockResolvedValue({
      data: {
        boards: [
          row('111', 'לוח משימות', 'board', null),
          row('222', 'לוח משתמשים', 'board', 'work-management::standalone'),
          row('333', 'תיק פרויקטים', 'board', 'work-management::portfolio'),
          row('444', 'תת-פריטים', 'sub_items_board', null),
          row('555', 'מסמך', 'document', null),
          null,
        ],
      },
    });

    expect(await fetchBoards()).toEqual([
      { id: '111', name: 'לוח משימות' },
      { id: '222', name: 'לוח משתמשים' },
    ]);
  });

  it('follows pagination while a page comes back FULL — a single page hid boards in the probe', async () => {
    const full = Array.from({ length: BOARDS_PAGE_SIZE }, (_, i) => row(`p1-${i}`, `first ${i}`, 'board'));
    apiMock
      .mockResolvedValueOnce({ data: { boards: full } })
      .mockResolvedValueOnce({ data: { boards: [row('p2-0', 'second page board', 'board')] } });

    const boards = await fetchBoards();

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(boards).toHaveLength(BOARDS_PAGE_SIZE + 1);
    expect(boards.at(-1)).toEqual({ id: 'p2-0', name: 'second page board' });
  });

  it('stops after ONE request when the first page is short', async () => {
    apiMock.mockResolvedValue({ data: { boards: [row('1', 'only', 'board')] } });
    await fetchBoards();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('asks for a later page number on the follow-up request', async () => {
    const full = Array.from({ length: BOARDS_PAGE_SIZE }, (_, i) => row(`x${i}`, `n${i}`, 'board'));
    apiMock
      .mockResolvedValueOnce({ data: { boards: full } })
      .mockResolvedValueOnce({ data: { boards: [] } });

    await fetchBoards();

    // seamlessApi passes variables as monday.api(query, { variables })
    expect(apiMock.mock.calls[1][1]).toMatchObject({ variables: { page: 2 } });
    expect(apiMock.mock.calls[0][1]).toMatchObject({ variables: { page: 1 } });
  });

  it('never exceeds the page cap, even if every page stays full', async () => {
    const full = Array.from({ length: BOARDS_PAGE_SIZE }, (_, i) => row(`y${i}`, `m${i}`, 'board'));
    apiMock.mockResolvedValue({ data: { boards: full } });

    const boards = await fetchBoards();

    expect(apiMock).toHaveBeenCalledTimes(BOARDS_MAX_PAGES);
    expect(boards).toHaveLength(BOARDS_PAGE_SIZE * BOARDS_MAX_PAGES);
  });

  it('returns [] when the API yields no boards', async () => {
    apiMock.mockResolvedValue({ data: { boards: [] } });
    expect(await fetchBoards()).toEqual([]);
  });
});
