import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round141b — custom-object install (owner report): when the app runs as a
 * standalone custom object there is no meaningful "current board", so
 * provisionAllBoards must CREATE a real discussions board (named "דיונים")
 * instead of extending a host board. Board-view installs keep the existing
 * behavior (current board = discussions, never created).
 */
const { api, state } = vi.hoisted(() => {
  const state = { calls: [], boardSeq: 0 };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('create_board')) {
        state.boardSeq += 1;
        return { create_board: { id: `90${state.boardSeq}` } };
      }
      if (s.includes('create_column')) return { create_column: { id: `col-${state.calls.length}` } };
      if (s.includes('create_dropdown_managed_column')) return { create_dropdown_managed_column: { id: 'mc-1' } };
      if (s.includes('attach_dropdown_managed_column')) return { attach_dropdown_managed_column: { id: 'col-type' } };
      if (s.includes('change_column_title')) return { change_column_title: { id: 'x' } };
      if (s.includes('columns { id title type settings_str }')) {
        // Every board "already has": enabled subitems (so no throwaway item is
        // needed) and a reflection relation pointing at board 901 (the first
        // created board) so mapReflection always finds something to map.
        return {
          boards: [{
            columns: [
              { id: 'subcol', title: 'Subitems', type: 'subtasks', settings_str: '{"boardIds":[777]}' },
              { id: 'refl-1', title: 'קישור', type: 'board_relation', settings_str: '{"boardIds":[901]}' },
            ],
          }],
        };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { provisionAllBoards } from '../provisionBoards.js';

const createBoardCalls = () => state.calls.filter((c) => c.q.includes('create_board'));

beforeEach(() => {
  api.mockClear();
  state.calls = [];
  state.boardSeq = 0;
});

describe('provisionAllBoards — createDiscussionsBoard (custom-object install)', () => {
  it('creates a real "דיונים" board FIRST and maps it as boards.discussions', async () => {
    // While unimplemented this rejects ("לא זוהה הלוח הנוכחי") — surface that
    // as an ASSERTION failure so the red gate reads it as behavioral.
    const config = await provisionAllBoards({
      createDiscussionsBoard: true,
      workspaceId: '55',
      tasks: { mode: 'create' },
    }).catch((err) => ({ __err: String(err?.message || err) }));
    expect(config.__err).toBeUndefined();
    const boards = createBoardCalls();
    // 4 boards: דיונים + נושאים לדיון + משימות + החלטות
    expect(boards.map((c) => c.vars.name)).toEqual(['דיונים', 'נושאים לדיון', 'משימות', 'החלטות']);
    // the discussions board is the FIRST created board, not a host board id
    expect(config.boards.discussions.id).toBe('901');
    expect(config.boards.topics.id).toBe('902');
  });

  it('without the flag the current board stays required (board-view behavior unchanged)', async () => {
    await expect(provisionAllBoards({ tasks: { mode: 'create' } })).rejects.toThrow(/הלוח הנוכחי/);
    const config = await provisionAllBoards({ discussionsBoardId: '123', tasks: { mode: 'create' } });
    expect(config.boards.discussions.id).toBe('123');
    expect(createBoardCalls().map((c) => c.vars.name)).toEqual(['נושאים לדיון', 'משימות', 'החלטות']);
  });
});
