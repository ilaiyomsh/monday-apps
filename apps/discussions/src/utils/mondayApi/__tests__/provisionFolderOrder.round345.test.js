import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round345 (owner-reported, after a real install: "עדיין כשהתקנתי את האפליקציה הלוחות לא
 * נכנסו אוטומטית לתיקייה … שנה את זה ככה שהלוחות ייכנסו אוטומטית לתיקייה ברגע יצירתם
 * (כלומר קודם תיווצר תיקייה ואז כל לוח שיווצר ייכנס לתוכה). תוריד את הכפתור.")
 *
 * The folder code existed since round339 and still produced four loose boards. Two reasons,
 * and this file pins the fix for both:
 *
 * 1. NO WORKSPACE ⇒ NO FOLDER, and previously the code went ahead anyway with a null
 *    workspace. Verified against the live API: `folders(workspace_ids: [null])` is NOT "the
 *    main workspace" — it answers with folders from an unrelated workspace, so the reuse
 *    lookup searched the wrong place and `create_folder` with a null workspace dropped
 *    "בסיס מידע" somewhere the install never looks at. In a custom-object install the
 *    context carries no workspaceId and there is no host board, so this was the normal path.
 *    The workspace is now read off a REAL board — created first if that is the only way.
 *
 * 2. A board provisioning did not CREATE never entered the folder. That was left to a
 *    settings button, which the owner reasonably never went looking for (and which could
 *    not work on a freshly remapped draft). Provisioning moves those boards in itself now,
 *    and the button is gone.
 */

const { api, state } = vi.hoisted(() => {
  const state = { calls: [], boardSeq: 0, boardWorkspace: 'WS-FROM-BOARD', existingFolders: [], moveFails: false };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('workspace { id }')) {
        return { boards: [{ id: String(vars.ids[0]), workspace: state.boardWorkspace ? { id: state.boardWorkspace } : null }] };
      }
      if (s.includes('folders(')) return { folders: state.existingFolders };
      if (s.includes('create_folder')) return { create_folder: { id: `FOLDER-${vars.ws}` } };
      if (s.includes('create_board')) {
        state.boardSeq += 1;
        return { create_board: { id: `B${state.boardSeq}` } };
      }
      if (s.includes('update_board_hierarchy')) {
        if (state.moveFails) return { update_board_hierarchy: { success: false, message: 'nope' } };
        return { update_board_hierarchy: { success: true } };
      }
      if (s.includes('create_column')) return { create_column: { id: `col-${state.calls.length}` } };
      if (s.includes('create_dropdown_managed_column')) return { create_dropdown_managed_column: { id: 'mc-1' } };
      if (s.includes('attach_dropdown_managed_column')) return { attach_dropdown_managed_column: { id: 'col-type' } };
      if (s.includes('change_column_title')) return { change_column_title: { id: 'x' } };
      if (s.includes('columns { id title type settings_str }')) {
        return { boards: [{ columns: [{ id: 'subcol', title: 'Subitems', type: 'subtasks', settings_str: '{"boardIds":[777]}' }] }] };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../managedColumns.js', () => ({
  detectManagedDropdownColumnId: vi.fn(async () => 'mc-1'),
  findManagedDropdownColumnByTitle: vi.fn(async () => null),
}));

import { provisionAllBoards } from '../provisionBoards.js';

const idx = (pred) => state.calls.findIndex(pred);
const creates = () => state.calls.filter((c) => c.q.includes('create_board'));
const moves = () => state.calls.filter((c) => c.q.includes('update_board_hierarchy'));

beforeEach(() => {
  state.calls = [];
  state.boardSeq = 0;
  state.boardWorkspace = 'WS-FROM-BOARD';
  state.existingFolders = [];
  state.moveFails = false;
  vi.clearAllMocks();
});

describe('round345 — the folder is created BEFORE the boards', () => {
  /*
   * The ORDER is the requirement, not just the end state: "קודם תיווצר תיקייה ואז כל לוח
   * שיווצר ייכנס לתוכה". Asserting call positions is what pins it — a version that created
   * the boards and moved them afterwards would satisfy an end-state assertion and still be
   * the wrong thing.
   */
  it('creates the folder before any create_board, and every board carries its id', async () => {
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    const folderAt = idx((c) => c.q.includes('create_folder'));
    const firstBoardAt = idx((c) => c.q.includes('create_board'));
    expect(folderAt).toBeGreaterThanOrEqual(0);
    expect(folderAt).toBeLessThan(firstBoardAt);
    for (const c of creates()) expect(c.vars.folderId).toBe('FOLDER-77');
  });

  // The board-view host board is not created by provisioning, so the only way it reaches the
  // folder is a move — which is exactly what the removed button used to do by hand.
  it('moves the pre-existing HOST board into the folder', async () => {
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    const moved = moves().map((c) => c.vars.b);
    expect(moved).toEqual(['HOST']);
    expect(moves()[0].vars.attrs).toEqual({ folder_id: 'FOLDER-77' });
  });

  /*
   * The custom-object install with NO workspaceId in context — the case the owner actually
   * hit. There is no host board either, so the discussions board is created first, its
   * workspace is read OFF IT, and the folder is created there. Everything ends up inside:
   * the three later boards by folder_id, the discussions board by a move.
   */
  it('learns the workspace from the board it just created when context has none', async () => {
    await provisionAllBoards({ createDiscussionsBoard: true });

    // the folder went into the workspace read off the created board
    const folderCall = state.calls.find((c) => c.q.includes('create_folder'));
    expect(folderCall.vars.ws).toBe('WS-FROM-BOARD');

    const created = creates();
    expect(created).toHaveLength(4);
    // the first board (דיונים) could not know the folder yet...
    expect(created[0].vars.folderId).toBeUndefined();
    // ...so it is moved in, and the other three are born inside.
    for (const c of created.slice(1)) expect(c.vars.folderId).toBe('FOLDER-WS-FROM-BOARD');
    expect(moves().map((c) => c.vars.b)).toEqual(['B1']);
  });

  /*
   * NO workspace anywhere ⇒ no folder at all, rather than one created in a workspace nobody
   * chose. The install still completes with usable boards — that is the fail-soft contract.
   */
  it('creates NO folder when the workspace cannot be resolved, and still provisions', async () => {
    state.boardWorkspace = null;
    const cfg = await provisionAllBoards({ createDiscussionsBoard: true });
    expect(state.calls.filter((c) => c.q.includes('create_folder'))).toHaveLength(0);
    expect(state.calls.filter((c) => c.q.includes('folders('))).toHaveLength(0);
    expect(moves()).toHaveLength(0);
    for (const c of creates()) expect(c.vars.folderId).toBeUndefined();
    expect(cfg?.boards?.topics?.id).toBeTruthy();
  });

  /*
   * Re-running the wizard on an instance whose boards predate the folder is the ONLY route
   * those boards have into it: provisioning reuses a mapped board and never re-creates one.
   * This is what replaced the button for existing installs.
   */
  it('moves boards REUSED from an existing mapping into the folder', async () => {
    const existingConfig = {
      boards: { discussions: { id: 'OLD-D' }, topics: { id: 'OLD-T' }, tasks: { id: 'OLD-K' }, decisions: { id: 'OLD-C' } },
      columns: {},
    };
    await provisionAllBoards({ discussionsBoardId: 'OLD-D', workspaceId: '77', existingConfig });
    expect(creates()).toHaveLength(0); // nothing re-created
    expect(moves().map((c) => c.vars.b).sort()).toEqual(['OLD-C', 'OLD-D', 'OLD-K', 'OLD-T']);
  });

  // A board that refuses to move must not take the install down with it — folder placement
  // is cosmetic, the mapping it returns is not.
  it('finishes the install even when the move fails', async () => {
    state.moveFails = true;
    const cfg = await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    expect(moves()).toHaveLength(1);
    expect(cfg?.boards?.decisions?.id).toBeTruthy();
    expect(cfg?.boards?.discussions?.id).toBe('HOST');
  });
});
