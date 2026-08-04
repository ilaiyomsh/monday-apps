import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round339 (owner request) — every provisioned board lands inside ONE folder
 * named "בסיס מידע", instead of four loose boards at the workspace root.
 *
 * The GraphQL shapes here were validated against the live schema AND probed live
 * in the sandbox workspace (16291824, WZ- scratch objects, deleted after):
 *   create_folder(name: String!, workspace_id: ID): Folder
 *   create_board(..., folder_id: ID): Board
 *   folders(workspace_ids: [ID], limit: Int) { id name children { id name } }
 * The probe confirmed a board created with folder_id really is returned as a
 * CHILD of that folder — the mock below mirrors those exact response shapes.
 *
 * What is pinned:
 *   1. one folder is created and EVERY create_board carries its id;
 *   2. an EXISTING "בסיס מידע" folder is reused, never duplicated (top-up / a
 *      second install in the same workspace);
 *   3. a folder failure is FAIL-SOFT — provisioning finishes with boards at the
 *      workspace root rather than aborting the whole install.
 */

const { api, state } = vi.hoisted(() => {
  const state = { calls: [], boardSeq: 0, existingFolders: [], folderFails: false };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (s.includes('folders(')) {
        if (state.folderFails) throw new Error('folders read failed');
        // Paged like the real API: `page` is 1-based, a short page is the last.
        const size = 100;
        const page = Number(vars?.page || 1);
        return { folders: state.existingFolders.slice((page - 1) * size, page * size) };
      }
      if (s.includes('create_folder')) {
        if (state.folderFails) throw new Error('create_folder failed');
        return { create_folder: { id: '5001' } };
      }
      if (s.includes('create_board')) {
        state.boardSeq += 1;
        return { create_board: { id: `90${state.boardSeq}` } };
      }
      if (s.includes('create_column')) return { create_column: { id: `col-${state.calls.length}` } };
      if (s.includes('create_dropdown_managed_column')) return { create_dropdown_managed_column: { id: 'mc-1' } };
      if (s.includes('attach_dropdown_managed_column')) return { attach_dropdown_managed_column: { id: 'col-type' } };
      if (s.includes('change_column_title')) return { change_column_title: { id: 'x' } };
      if (s.includes('columns { id title type settings_str }')) {
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
vi.mock('../managedColumns.js', () => ({
  detectManagedDropdownColumnId: vi.fn(async () => 'mc-1'),
  findManagedDropdownColumnByTitle: vi.fn(async () => null),
}));

import { provisionAllBoards, ensureProvisionFolder, PROVISION_FOLDER_NAME } from '../provisionBoards.js';

const createBoardCalls = () => state.calls.filter((c) => c.q.includes('create_board'));
const folderCreateCalls = () => state.calls.filter((c) => c.q.includes('create_folder'));

beforeEach(() => {
  state.calls = [];
  state.boardSeq = 0;
  state.existingFolders = [];
  state.folderFails = false;
  vi.clearAllMocks();
});

describe('round339 — provisioned boards land in one "בסיס מידע" folder', () => {
  it('creates the folder once and passes its id to EVERY create_board', async () => {
    await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });
    expect(folderCreateCalls()).toHaveLength(1);
    expect(folderCreateCalls()[0].vars.name).toBe(PROVISION_FOLDER_NAME);
    const boards = createBoardCalls();
    expect(boards.length).toBeGreaterThan(0);
    for (const c of boards) expect(c.vars.folderId).toBe('5001');
  });

  it('carries the folder into the custom-object install too (discussions board created)', async () => {
    await provisionAllBoards({ workspaceId: '77', createDiscussionsBoard: true });
    const boards = createBoardCalls();
    // discussions + topics + tasks + decisions
    expect(boards.length).toBe(4);
    for (const c of boards) expect(c.vars.folderId).toBe('5001');
  });

  it('REUSES an existing "בסיס מידע" folder instead of creating a second one', async () => {
    state.existingFolders = [
      { id: '4242', name: 'משהו אחר' },
      { id: '9999', name: PROVISION_FOLDER_NAME },
    ];
    await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });
    expect(folderCreateCalls()).toHaveLength(0);
    for (const c of createBoardCalls()) expect(c.vars.folderId).toBe('9999');
  });

  /*
   * Added after the PR review, which was right: the lookup read page 1 only, so
   * in a workspace with more folders than fit one page an existing "בסיס מידע"
   * read as ABSENT and create_folder made a duplicate — defeating the very reuse
   * this feature depends on. 100 filler folders push the real one onto page 2.
   */
  it('finds the folder on a LATER page instead of creating a duplicate', async () => {
    state.existingFolders = [
      ...Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, name: `תיקייה ${i}` })),
      { id: '7777', name: PROVISION_FOLDER_NAME },
    ];
    await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });
    expect(folderCreateCalls()).toHaveLength(0);
    for (const c of createBoardCalls()) expect(c.vars.folderId).toBe('7777');
  });

  it('stops paging at a short page (does not loop the API needlessly)', async () => {
    state.existingFolders = [{ id: '1', name: 'לא זה' }];
    await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });
    const folderReads = state.calls.filter((c) => c.q.includes('folders('));
    expect(folderReads).toHaveLength(1);
  });

  it('is fail-soft: a folder failure still provisions the boards, at the workspace root', async () => {
    state.folderFails = true;
    const cfg = await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });
    const boards = createBoardCalls();
    expect(boards.length).toBeGreaterThan(0);
    for (const c of boards) expect(c.vars.folderId).toBeUndefined();
    // and the install still returns a usable config
    expect(cfg?.boards?.topics?.id).toBeTruthy();
  });

  it('ensureProvisionFolder returns null (not a throw) when the API fails', async () => {
    state.folderFails = true;
    await expect(ensureProvisionFolder('77')).resolves.toBeNull();
  });
});
