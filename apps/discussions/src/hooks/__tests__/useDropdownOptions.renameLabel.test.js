import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round304 — renaming a discussion TYPE = renaming a label on the "סוג דיון"
 * dropdown column. What must hold:
 *   • the target label KEEPS its id (that is what preserves every discussion's
 *     value — a dropdown item stores label ids, not text),
 *   • the FULL label set is re-sent (a partial set deletes the omitted labels),
 *   • renaming onto an existing type is refused (never merge two types),
 *   • a MANAGED column instance routes to the account-level mutation, including
 *     the self-heal after monday rejects the board-level edit.
 */

const { api, state } = vi.hoisted(() => {
  const BOARD = [
    { id: 1, label: 'סבב', is_deactivated: false },
    { id: 2, label: 'תכנון', is_deactivated: false },
    { id: 9, label: 'ישן', is_deactivated: true },
  ];
  const MANAGED = [
    { id: 1, label: 'סבב', is_deactivated: false },
    { id: 2, label: 'תכנון', is_deactivated: false },
  ];
  const state = { failBoardUpdateAsManaged: false };
  return {
    state,
    api: vi.fn(async (query) => {
      if (query.includes('update_dropdown_managed_column')) {
        return { update_dropdown_managed_column: { id: 'uuid-1', revision: 4 } };
      }
      if (query.includes('update_dropdown_column')) {
        if (state.failBoardUpdateAsManaged) {
          const err = new Error('notices.column.settings.update.error.structure');
          err.errorCode = 'INVALID_ARGUMENT_EXCEPTION';
          throw err;
        }
        return { update_dropdown_column: { id: 'col1' } };
      }
      if (query.includes('managed_column(state: active)')) {
        return { managed_column: [{ id: 'uuid-1', settings_json: { type: 'dropdown', labels: MANAGED } }] };
      }
      if (query.includes('managed_column')) {
        return { managed_column: [{ id: 'uuid-1', revision: 3, settings_json: { labels: MANAGED } }] };
      }
      if (query.includes('revision')) {
        return { boards: [{ columns: [{ id: 'col1', revision: 'rev-7', settings: { labels: BOARD } }] }] };
      }
      // post-write reload (no `revision` in the selection)
      return { boards: [{ columns: [{ id: 'col1', settings: { labels: MANAGED }, settings_str: '' }] }] };
    }),
  };
});
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ api }));

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { renameDropdownLabel, getVersion } from '../useDropdownOptions.js';

const mapColumn = (extra = {}) => setActiveConfig({
  boards: { discussions: { id: 'b1' } },
  columns: { discussions: { discussionTypeID: { id: 'col1', ...extra } } },
});

beforeEach(() => {
  api.mockClear();
  state.failBoardUpdateAsManaged = false;
  mapColumn();
});

describe('renameDropdownLabel — regular board column', () => {
  it('re-sends every label at the fresh revision, with only the target\'s TEXT replaced', async () => {
    const before = getVersion();
    const res = await renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: 'סבב שבועי',
    });

    const call = api.mock.calls.find(([q]) => q.includes('update_dropdown_column'));
    expect(call).toBeTruthy();
    const [, vars] = call;
    expect(vars.revision).toBe('rev-7');
    // The full set survives — including the DEACTIVATED label, whose flag is kept.
    expect(vars.s.labels).toEqual([
      { id: 1, label: 'סבב שבועי', is_deactivated: false },
      { id: 2, label: 'תכנון', is_deactivated: false },
      { id: 9, label: 'ישן', is_deactivated: true },
    ]);
    expect(res).toEqual({ managedColumnId: null, unchanged: false });
    // subscribers re-read after the cache refresh
    expect(getVersion()).toBeGreaterThan(before);
  });

  it('is a no-op when the new name equals the current one', async () => {
    const res = await renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: '  סבב  ',
    });
    expect(res.unchanged).toBe(true);
    expect(api.mock.calls.some(([q]) => q.includes('update_dropdown_column'))).toBe(false);
  });

  it('refuses to rename onto a name another ACTIVE label holds (case-insensitive)', async () => {
    await expect(renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: 'תכנון',
    })).rejects.toMatchObject({ code: 'duplicate' });
    expect(api.mock.calls.some(([q]) => q.includes('update_dropdown_column'))).toBe(false);
  });

  it('throws for an unknown label id, a blank name, or an unmapped column', async () => {
    await expect(renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 404, title: 'חדש',
    })).rejects.toThrow(/label not found/);
    await expect(renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: '   ',
    })).rejects.toThrow(/missing/);
    setActiveConfig({ boards: {}, columns: { discussions: {} } });
    await expect(renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: 'חדש',
    })).rejects.toThrow(/missing/);
  });
});

describe('renameDropdownLabel — managed column', () => {
  it('uses the ACCOUNT-level mutation (integer revision) when the managed id is known, never the board one', async () => {
    mapColumn({ managedColumnId: 'uuid-1' });
    const res = await renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 2, title: 'תכנון רבעוני',
    });
    const call = api.mock.calls.find(([q]) => q.includes('update_dropdown_managed_column'));
    expect(call).toBeTruthy();
    expect(call[1].rev).toBe(3);
    expect(call[1].s.labels).toEqual([
      { id: 1, label: 'סבב', is_deactivated: false },
      { id: 2, label: 'תכנון רבעוני', is_deactivated: false },
    ]);
    expect(api.mock.calls.some(([q]) => q.includes('update_dropdown_column('))).toBe(false);
    expect(res.managedColumnId).toBe('uuid-1');
  });

  it('self-heals: a board-level rejection with the managed-structure error re-runs on the detected managed column', async () => {
    state.failBoardUpdateAsManaged = true;
    const res = await renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: 'סבב שבועי',
    });
    expect(api.mock.calls.some(([q]) => q.includes('update_dropdown_managed_column'))).toBe(true);
    expect(res.managedColumnId).toBe('uuid-1');
  });

  it('rethrows a NON-managed failure instead of guessing (no managed fallback)', async () => {
    api.mockImplementationOnce(async () => ({
      boards: [{ columns: [{ id: 'col1', revision: 'rev-7', settings: { labels: [{ id: 1, label: 'סבב' }] } }] }],
    }));
    api.mockImplementationOnce(async () => { throw new Error('boom'); });
    await expect(renameDropdownLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', labelId: 1, title: 'סבב שבועי',
    })).rejects.toThrow('boom');
    expect(api.mock.calls.some(([q]) => q.includes('update_dropdown_managed_column'))).toBe(false);
  });
});
