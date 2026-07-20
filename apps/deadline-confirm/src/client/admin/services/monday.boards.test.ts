// v4 — board-picker type filter: fetchBoards must return only REAL work
// boards, dropping sub-item boards / portfolios / docs / other objects the
// raw boards() query includes (mirrors the tracker's object_type_unique_key
// filter). isRealBoard is robust to the namespace form ('board' or
// 'work-management::board').

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

import { isRealBoard, fetchBoards, REAL_BOARD_OBJECT_TYPE_KEY } from './monday';

describe('isRealBoard', () => {
  it('keeps a bare "board" and a namespaced "work-management::board"', () => {
    expect(isRealBoard({ object_type_unique_key: 'board' })).toBe(true);
    expect(isRealBoard({ object_type_unique_key: 'work-management::board' })).toBe(true);
  });

  it('drops portfolios, sub-item boards, docs and other object types', () => {
    expect(isRealBoard({ object_type_unique_key: 'work-management::portfolio' })).toBe(false);
    expect(isRealBoard({ object_type_unique_key: 'work-management::subitems' })).toBe(false);
    expect(isRealBoard({ object_type_unique_key: 'doc' })).toBe(false);
    expect(isRealBoard({ object_type_unique_key: 'work-management::custom_object' })).toBe(false);
  });

  it('drops boards with a missing / non-string object_type_unique_key', () => {
    expect(isRealBoard({ object_type_unique_key: null })).toBe(false);
    expect(isRealBoard({ object_type_unique_key: undefined })).toBe(false);
    expect(isRealBoard({})).toBe(false);
  });

  it('exposes the bare board key constant', () => {
    expect(REAL_BOARD_OBJECT_TYPE_KEY).toBe('board');
  });
});

describe('fetchBoards', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('queries object_type_unique_key and returns ONLY real boards, mapped to {id,name}', async () => {
    apiMock.mockResolvedValue({
      data: {
        boards: [
          { id: '111', name: 'לוח משימות', object_type_unique_key: 'board' },
          { id: '222', name: 'לוח משתמשים', object_type_unique_key: 'work-management::board' },
          { id: '333', name: 'תיק פרויקטים', object_type_unique_key: 'work-management::portfolio' },
          { id: '444', name: 'תת-פריטים', object_type_unique_key: 'work-management::subitems' },
          null,
        ],
      },
    });

    const boards = await fetchBoards();

    expect(boards).toEqual([
      { id: '111', name: 'לוח משימות' },
      { id: '222', name: 'לוח משתמשים' },
    ]);
    // the query must actually request the discriminator field
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toContain('object_type_unique_key');
  });

  it('returns [] when the API yields no boards', async () => {
    apiMock.mockResolvedValue({ data: { boards: [] } });
    expect(await fetchBoards()).toEqual([]);
  });
});
