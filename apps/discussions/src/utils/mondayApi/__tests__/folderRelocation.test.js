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
    moveFails: new Set(), moveThrows: new Set(), boardsThrow: false, boardMissing: false,
  };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('workspace { id }')) {
        if (state.boardsThrow) throw new Error('boards read failed');
        // monday answers an unknown/inaccessible id with an EMPTY LIST, not an error.
        if (state.boardMissing) return { boards: [] };
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

import { resolveWorkspaceId, readBoardWorkspaceId, moveBoardsIntoFolder, ensureProvisionFolder } from '../provisionBoards.js';

// Flat {role: boardId} — the shape provisioning hands the mover.
const IDS = { discussions: 'B1', topics: 'B2', tasks: 'B3', decisions: 'B4' };

beforeEach(() => {
  state.calls = [];
  state.boardWorkspace = '999';
  state.failFolder = false;
  state.moveFails = new Set();
  state.moveThrows = new Set();
  state.boardsThrow = false;
  state.boardMissing = false;
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

/*
 * round344 (review finding) — the RAW read, which throws. `resolveWorkspaceId` returns null
 * both for "this board has no workspace" (⇒ main) and for a failed read, and that ambiguity
 * is only safe for provisioning: relocation moves boards that already exist, so a swallowed
 * error would pull them out of their workspace into a main-workspace folder with no undo.
 */
describe('readBoardWorkspaceId', () => {
  it('returns the workspace, and null when the board genuinely has none', async () => {
    expect(await readBoardWorkspaceId('B1')).toBe('999');
    state.boardWorkspace = null;
    expect(await readBoardWorkspaceId('B1')).toBeNull();
  });

  // The whole point: it must PROPAGATE, where resolveWorkspaceId swallows.
  it('THROWS when the read fails, unlike resolveWorkspaceId', async () => {
    state.boardsThrow = true;
    await expect(readBoardWorkspaceId('B1')).rejects.toThrow('boards read failed');
    expect(await resolveWorkspaceId('B1', null)).toBeNull();
  });

  /*
   * An EMPTY board list is a failure too (review finding): monday answers a deleted or
   * inaccessible board id with `boards: []` rather than an error — the behaviour
   * `apps/docs-export/src/services/boardMeta.js` documents and throws on. Reading it as
   * null would tell the relocation "main workspace" and move every other board there.
   */
  it('THROWS on an empty board list rather than reading it as the main workspace', async () => {
    state.boardMissing = true;
    await expect(readBoardWorkspaceId('B1')).rejects.toThrow(/לא נמצא/);
    // the fail-soft wrapper still degrades to null, so provisioning is unchanged
    expect(await resolveWorkspaceId('B1', null)).toBeNull();
  });
});

describe('moveBoardsIntoFolder', () => {
  /*
   * round345 — this used to ensure the folder itself and was called from a settings button.
   * The button is gone: provisioning creates the folder FIRST and moves in whatever it could
   * not create inside it, so the mover now takes a folder id it is given and does one job.
   */
  it('moves every board it is given into the folder', async () => {
    const { moved, failed } = await moveBoardsIntoFolder(IDS, 'F1');
    expect(moved.sort()).toEqual(['decisions', 'discussions', 'tasks', 'topics']);
    expect(failed).toEqual([]);
    const moves = state.calls.filter((c) => c.q.includes('update_board_hierarchy'));
    expect(moves).toHaveLength(4);
    // the attributes shape is the probe-verified one
    expect(moves[0].vars.attrs).toEqual({ folder_id: 'F1' });
    // and it does NOT create or look up a folder — that is the caller's job now
    expect(state.calls.filter((c) => c.q.includes('create_folder'))).toHaveLength(0);
    expect(state.calls.filter((c) => c.q.includes('folders('))).toHaveLength(0);
  });

  /*
   * Per-board independence. One board refusing to move must not strand the others, and the
   * caller must learn which — a half-filled folder reported as "done" sends the owner
   * looking for a problem that is already known.
   */
  it('keeps going past a board that refuses to move, and reports it', async () => {
    state.moveFails = new Set(['B3']);
    const { moved, failed } = await moveBoardsIntoFolder(IDS, 'F1');
    expect(failed).toEqual(['tasks']);
    expect(moved.sort()).toEqual(['decisions', 'discussions', 'topics']);
  });

  // A THROWN move (network / permission) is the same contract as a `success: false` one:
  // recorded and skipped past. Driven through state rather than by swapping the mock's
  // implementation — that leaked into the following tests and made them pass for the wrong
  // reason, which is exactly the kind of false green this suite is supposed to prevent.
  it('reports a THROWN move as failed rather than aborting the batch', async () => {
    state.moveThrows = new Set(['B2']);
    const { moved, failed } = await moveBoardsIntoFolder(IDS, 'F1');
    expect(failed).toEqual(['topics']);
    expect(moved).toHaveLength(3);
  });

  // No folder ⇒ nothing moved, everything reported as failed. The caller (provisioning) is
  // fail-soft around this: the boards stay at the workspace root with a warning.
  it('moves nothing when there is no folder', async () => {
    const { moved, failed } = await moveBoardsIntoFolder(IDS, null);
    expect(moved).toEqual([]);
    expect(failed.sort()).toEqual(['decisions', 'discussions', 'tasks', 'topics']);
    expect(state.calls).toHaveLength(0);
  });

  it('skips a role with no mapped board', async () => {
    const { moved } = await moveBoardsIntoFolder({ discussions: 'B1' }, 'F1');
    expect(moved).toEqual(['discussions']);
    expect(state.calls.filter((c) => c.q.includes('update_board_hierarchy'))).toHaveLength(1);
  });
});

/*
 * round345 (owner-reported, second install: "עדיין הלוחות לא נכנסו לתיקייה") — a null
 * workspace must NOT reach the folder API at all. Verified against the live API:
 * `folders(workspace_ids: [null])` is not "the main workspace" — it answers with folders
 * from an unrelated workspace, so the reuse lookup searched the wrong place and
 * `create_folder` with a null workspace dropped "בסיס מידע" somewhere the install never
 * looks. Boards at the workspace root are a cosmetic miss; a folder in a stranger's
 * workspace is noise in someone's account.
 */
describe('ensureProvisionFolder without a workspace', () => {
  it('returns null and touches no folder API when the workspace is unknown', async () => {
    expect(await ensureProvisionFolder(null)).toBeNull();
    expect(await ensureProvisionFolder('')).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('still creates the folder when a workspace IS known', async () => {
    expect(await ensureProvisionFolder('999')).toBe('F1');
    expect(state.calls.filter((c) => c.q.includes('create_folder'))).toHaveLength(1);
  });
});
