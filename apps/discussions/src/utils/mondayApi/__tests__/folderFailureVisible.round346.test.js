import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round346 (owner, third report: "עדיין כשהתקנתי את האפליקציה וביקשתי ממנה ליצור את הלוחות
 * הם לא נוצרו לתוך תיקייה")
 *
 * Three rounds of folder fixes, three installs with loose boards — because the cause was
 * never only in the code. `create_folder` requires the **`workspaces:write`** OAuth scope
 * (monday docs, confirmed live 2026-08-04); `boards:write` does not cover it. The app's calls
 * run with the app's granted scopes, so without that scope EVERY folder attempt fails at the
 * platform, and because folder placement is deliberately fail-soft the install reported
 * success while quietly skipping the folder.
 *
 * A missing scope cannot be fixed at runtime — it is a Developer Center setting. What the app
 * CAN do, and what this file pins, is stop pretending it worked: one ERROR-level line (the
 * logger funnel turns it into a Hebrew toast and ships it to Axiom) naming the actual reason,
 * including the scope when the platform says "unauthorized". Silence is the bug being fixed.
 */

const { api, state } = vi.hoisted(() => {
  const state = { boardSeq: 0, folderError: null };
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      if (s.includes('workspace { id }')) return { boards: [{ id: String(vars.ids[0]), workspace: { id: 'WS1' } }] };
      if (s.includes('folders(')) {
        if (state.folderError) throw state.folderError;
        return { folders: [] };
      }
      if (s.includes('create_folder')) {
        if (state.folderError) throw state.folderError;
        return { create_folder: { id: 'F1' } };
      }
      if (s.includes('create_board')) { state.boardSeq += 1; return { create_board: { id: `B${state.boardSeq}` } }; }
      if (s.includes('update_board_hierarchy')) return { update_board_hierarchy: { success: true } };
      if (s.includes('create_column')) return { create_column: { id: 'col' } };
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

import logger from '../../logger.js';
import { provisionAllBoards, describeFolderFailure, PROVISION_FOLDER_NAME } from '../provisionBoards.js';

const errorLines = () => logger.error.mock.calls.map((c) => c.join(' '));

beforeEach(() => {
  state.boardSeq = 0;
  state.folderError = null;
  vi.clearAllMocks();
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

describe('round346 — a folder that did not happen is reported, not swallowed', () => {
  /*
   * The scope case, which is the one that actually happened. The message has to name
   * `workspaces:write`: "יצירת התיקייה נכשלה" alone would have sent the owner back to the
   * code for a fourth round, since nothing in the code was wrong.
   */
  it('names workspaces:write when monday refuses the folder as unauthorized', async () => {
    state.folderError = new Error('UNAUTHORIZED: missing scope');
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    const said = errorLines().join('\n');
    expect(said).toContain('workspaces:write');
    expect(said).toContain(PROVISION_FOLDER_NAME);
  });

  // Any OTHER failure still gets reported — with its own message rather than a scope guess,
  // so a real API error is not misdiagnosed as a permissions problem.
  it('reports a non-permission failure with its own message, without blaming the scope', async () => {
    state.folderError = new Error('complexity budget exhausted');
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    const said = errorLines().join('\n');
    expect(said).toContain('complexity budget exhausted');
    expect(said).not.toContain('workspaces:write');
  });

  // The install must still SUCCEED — the mapping is valid, the boards are just not grouped.
  // Aborting an otherwise-good install over folder cosmetics would be the worse failure.
  it('still returns a usable config when the folder failed', async () => {
    state.folderError = new Error('UNAUTHORIZED');
    const cfg = await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    expect(cfg?.boards?.topics?.id).toBeTruthy();
    expect(cfg?.boards?.decisions?.id).toBeTruthy();
  });

  // And when the folder DID happen, nothing is reported — otherwise the toast becomes noise
  // every owner learns to ignore, which is how the next real failure gets missed.
  it('says nothing when the folder worked', async () => {
    await provisionAllBoards({ discussionsBoardId: 'HOST', workspaceId: '77' });
    expect(errorLines()).toEqual([]);
  });

  it('describeFolderFailure recognises the permission wording variants', () => {
    for (const msg of ['UNAUTHORIZED', 'Permission denied', 'FORBIDDEN', 'missing scope', 'not allowed']) {
      expect(describeFolderFailure(new Error(msg))).toContain('workspaces:write');
    }
    expect(describeFolderFailure(new Error('boom'))).toContain('boom');
  });
});
