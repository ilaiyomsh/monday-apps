import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round363 — provisionAllBoards runs the blueprint layer (boardBlueprint.js)
 * at the end of an install. What is pinned here is the WIRING, not the
 * blueprint's internals (those live in boardBlueprint.round363.test.js):
 *
 *   1. a full run creates the blueprint artifacts — rollup columns, views,
 *      group restyling — and the group/name restyling touches ONLY boards the
 *      run CREATED (never the host discussions board);
 *   2. the progress TOTAL includes the blueprint budget (countSteps +
 *      countBlueprintSteps agree), so the wizard's bar does not overflow;
 *   3. the blueprint is fail-soft: every blueprint call blowing up still
 *      leaves provisionAllBoards resolving with a valid mapping.
 */

const { api, state } = vi.hoisted(() => {
  const state = { calls: [], boardSeq: 0, colSeq: 0, blueprintFails: false };
  const isBlueprintCall = (s) =>
    s.includes('create_view_table') || s.includes('update_group')
    || s.includes('views {') || s.includes('groups {');
  return {
    state,
    api: vi.fn(async (q, vars) => {
      const s = String(q);
      state.calls.push({ q: s, vars });
      if (state.blueprintFails && (isBlueprintCall(s) || vars?.type === 'formula' || vars?.type === 'mirror')) {
        throw new Error('blueprint call failed');
      }
      if (s.includes('create_board')) {
        state.boardSeq += 1;
        return { create_board: { id: `90${state.boardSeq}` } };
      }
      if (s.includes('create_column')) {
        state.colSeq += 1;
        return { create_column: { id: `col-${state.colSeq}`, settings_str: vars?.defaults || '{"x":1}' } };
      }
      if (s.includes('create_dropdown_managed_column')) return { create_dropdown_managed_column: { id: 'mc-1' } };
      if (s.includes('attach_dropdown_managed_column')) return { attach_dropdown_managed_column: { id: 'col-type' } };
      if (s.includes('change_column_title')) return { change_column_title: { id: 'name' } };
      if (s.includes('create_view_table')) return { create_view_table: { id: `view-${state.calls.length}` } };
      if (s.includes('update_group')) return { update_group: { id: 'g' } };
      if (s.includes('views {')) return { boards: [{ views: [] }] };
      if (s.includes('groups {')) return { boards: [{ groups: [{ id: 'topics', title: 'Group Title' }] }] };
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
      if (s.includes('workspace { id }')) return { boards: [{ id: '1', workspace: { id: '77' } }] };
      if (s.includes('folders(')) return { folders: [] };
      if (s.includes('create_folder')) return { create_folder: { id: '5001' } };
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
import { countBlueprintSteps } from '../boardBlueprint.js';

beforeEach(() => {
  state.calls = [];
  state.boardSeq = 0;
  state.colSeq = 0;
  state.blueprintFails = false;
  vi.clearAllMocks();
});

describe('round363 — provisioning applies the live-board blueprint', () => {
  it('a full install creates the rollup columns, the views, and restyles ONLY created boards', async () => {
    const config = await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });

    // the effectiveness pipeline landed in the returned mapping, read-only
    for (const alias of ['totalTasksID', 'totalTopicsID', 'completedTasksID', 'delayedTasksID', 'completionPctID', 'delayedPctID', 'effectivenessID']) {
      expect(config.columns.discussions[alias]?.id, alias).toBeTruthy();
      expect(config.columns.discussions[alias]?.verified, alias).toBe(false);
    }
    expect(config.columns.tasks.taskDelayedFlagID?.id).toBeTruthy();
    expect(config.columns.tasks.taskDoneFlagID?.id).toBeTruthy();

    // views were created
    const viewCalls = state.calls.filter((c) => c.q.includes('create_view_table'));
    expect(viewCalls.length).toBeGreaterThan(0);

    // group restyle touched created boards only — never the HOST board ('1')
    const groupCalls = state.calls.filter((c) => c.q.includes('update_group'));
    expect(groupCalls.length).toBeGreaterThan(0);
    expect(groupCalls.some((c) => String(c.vars.b) === '1')).toBe(false);
    // name-column terminology renames skip the host board too
    const nameRenames = state.calls.filter((c) => c.q.includes('change_column_title') && c.vars.c === 'name');
    expect(nameRenames.length).toBeGreaterThan(0);
    expect(nameRenames.some((c) => String(c.vars.b) === '1')).toBe(false);
  });

  it('the progress TOTAL includes the blueprint budget and ticks never exceed it', async () => {
    const totals = new Set();
    let maxStep = 0;
    await provisionAllBoards({
      discussionsBoardId: '1',
      workspaceId: '77',
      onProgress: (step, total) => {
        totals.add(total);
        maxStep = Math.max(maxStep, step);
      },
    });
    expect(totals.size).toBe(1);
    const total = [...totals][0];
    expect(maxStep).toBeLessThanOrEqual(total);
    // the budget genuinely grew by the blueprint's share (9 columns + 3×2 restyles + 6 views)
    expect(countBlueprintSteps({ mode: 'create' }, false)).toBe(21);
    expect(total).toBeGreaterThanOrEqual(21);
  });

  it('every blueprint call failing still resolves the install with a valid mapping (fail-soft)', async () => {
    state.blueprintFails = true;
    const config = await provisionAllBoards({ discussionsBoardId: '1', workspaceId: '77' });
    expect(config.boards.discussions.id).toBe('1');
    expect(config.boards.topics.id).toBeTruthy();
    // the plain column set still mapped; the blueprint aliases simply absent
    expect(config.columns.tasks.statusID?.id).toBeTruthy();
    expect(config.columns.discussions.effectivenessID).toBeUndefined();
  });
});
