import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round342 (owner-reported: "הלוחות לא נוצרו בתוך תיקייה") — two distinct defects behind
 * one symptom, both found by live probe in the sandbox (16291824, WZ- objects, deleted).
 *
 * 1. THE WORKSPACE WAS NEVER RESOLVED. The wizard passed `context.workspaceId` straight
 *    through, and a monday BOARD VIEW context does not reliably carry one — so it was
 *    `undefined`. Probed consequences:
 *      · `create_folder` with NO workspace_id lands the folder in the MAIN workspace;
 *      · `create_board` with a `folder_id` INHERITS that folder's workspace.
 *    So an account whose discussions board lives elsewhere would get the folder AND all
 *    four boards in the main workspace — in a folder, just the wrong one. Nothing looked
 *    broken, which is why it took an install to notice.
 *
 * 2. AN EXISTING BOARD IS NEVER RELOCATED. Provisioning reuses an already-mapped board
 *    instead of re-creating it, so an instance whose boards predate the folder can never
 *    reach it by re-running the wizard. `moveBoardsIntoProvisionFolder` is the explicit
 *    route — `update_board_hierarchy` with `UpdateBoardHierarchyAttributesInput` (the
 *    type name is probe-verified; `UpdateBoardHierarchyAttributes` does not exist).
 */

const { api, state } = vi.hoisted(() => {
  const state = {
    calls: [], boardWorkspace: '999', failFolder: false,
    moveFails: new Set(), moveThrows: new Set(), boardsThrow: false,
  };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('workspace { id }')) {
        if (state.boardsThrow) throw new Error('boards read failed');
        return { boards: [{ id: String(vars.ids[0]), workspace: { id: state.boardWorkspace } }] };
      }
      if (s.includes('folders(')) return { folders: [] };
      if (s.includes('create_folder')) {
        if (state.failFolder) throw new Error('create_folder failed');
        return { create_folder: { id: 'F1' } };
      }
      if (s.includes('update_board_hierarchy')) {
        const id = String(vars.b);
        if (state.moveThrows.has(id)) throw new Error('move blew up');
        if (state.moveFails.has(id)) return { update_board_hierarchy: { success: false, message: 'nope' } };
        return { update_board_hierarchy: { success: true, message: 'ok' } };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../managedColumns.js', () => ({
  detectManagedDropdownColumnId: vi.fn(async () => null),
  findManagedDropdownColumnByTitle: vi.fn(async () => null),
}));

import { resolveWorkspaceId, moveBoardsIntoProvisionFolder } from '../provisionBoards.js';

const BOARDS = {
  discussions: { id: 'B1' }, topics: { id: 'B2' }, tasks: { id: 'B3' }, decisions: { id: 'B4' },
};

beforeEach(() => {
  state.calls = [];
  state.boardWorkspace = '999';
  state.failFolder = false;
  state.moveFails = new Set();
  state.moveThrows = new Set();
  state.boardsThrow = false;
  vi.clearAllMocks();
});

describe('resolveWorkspaceId', () => {
  it('reads the workspace off the HOST BOARD when the caller has none', async () => {
    expect(await resolveWorkspaceId('B1', null)).toBe('999');
  });

  /*
   * A caller-supplied workspace WINS and skips the read. That keeps the custom-object
   * install (where the wizard does know the workspace) at zero extra API calls, and means
   * this function can be dropped in front of every call site without a cost.
   */
  it('prefers an explicit workspace and does not query at all', async () => {
    expect(await resolveWorkspaceId('B1', '42')).toBe('42');
    expect(state.calls).toHaveLength(0);
  });

  // Fail-soft in both directions: null means "main workspace", which is exactly the
  // pre-round342 behaviour — so a failure degrades rather than aborting an install.
  it('returns null when there is no board, and when the read throws', async () => {
    expect(await resolveWorkspaceId(null, null)).toBeNull();
    state.boardsThrow = true;
    expect(await resolveWorkspaceId('B1', null)).toBeNull();
  });
});

describe('moveBoardsIntoProvisionFolder', () => {
  it('moves every mapped board into the folder', async () => {
    const { folderId, moved, failed } = await moveBoardsIntoProvisionFolder(BOARDS, '999');
    expect(folderId).toBe('F1');
    expect(moved.sort()).toEqual(['decisions', 'discussions', 'tasks', 'topics']);
    expect(failed).toEqual([]);
    const moves = state.calls.filter((c) => c.q.includes('update_board_hierarchy'));
    expect(moves).toHaveLength(4);
    // the attributes shape is the probe-verified one
    expect(moves[0].vars.attrs).toEqual({ folder_id: 'F1' });
  });

  // The folder is resolved ONCE for the whole batch — four boards must not mint four folders.
  it('creates the folder only once for the whole batch', async () => {
    await moveBoardsIntoProvisionFolder(BOARDS, '999');
    expect(state.calls.filter((c) => c.q.includes('create_folder'))).toHaveLength(1);
  });

  /*
   * Per-board independence. One board refusing to move must not strand the other three,
   * and the caller must learn which — reporting "done" for a half-filled folder sends the
   * owner looking for a problem that is already known.
   */
  it('keeps going past a board that refuses to move, and reports it', async () => {
    state.moveFails = new Set(['B3']);
    const { moved, failed } = await moveBoardsIntoProvisionFolder(BOARDS, '999');
    expect(failed).toEqual(['tasks']);
    expect(moved.sort()).toEqual(['decisions', 'discussions', 'topics']);
  });

  // A THROWN move (network / permission) is the same contract as a `success: false` one:
  // recorded and skipped past. Driven through state rather than by swapping the mock's
  // implementation — that leaked into the following tests and made them pass for the wrong
  // reason, which is exactly the kind of false green this suite is supposed to prevent.
  it('reports a THROWN move as failed rather than aborting the batch', async () => {
    state.moveThrows = new Set(['B2']);
    const { moved, failed } = await moveBoardsIntoProvisionFolder(BOARDS, '999');
    expect(failed).toEqual(['topics']);
    expect(moved).toHaveLength(3);
  });

  // A folder that cannot be created means nothing can move — report all four as failed
  // rather than silently doing nothing and letting the UI claim success.
  it('reports every board as failed when the folder cannot be created', async () => {
    state.failFolder = true;
    const { folderId, moved, failed } = await moveBoardsIntoProvisionFolder(BOARDS, '999');
    expect(folderId).toBeNull();
    expect(moved).toEqual([]);
    expect(failed).toHaveLength(4);
  });

  it('skips a role with no mapped board', async () => {
    const { moved } = await moveBoardsIntoProvisionFolder({ discussions: { id: 'B1' } }, '999');
    expect(moved).toEqual(['discussions']);
    expect(state.calls.filter((c) => c.q.includes('update_board_hierarchy'))).toHaveLength(1);
  });
});
