import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round366 — the generic custom-column updater: optimistic patch under the
 * alias key, ONE change_multiple_column_values write with the value formatted
 * by the column's stored type, rollback on failure.
 */

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { setActiveConfig } from '../../../utils/mondayApi/board-config-store.js';
import { createTaskUpdaters } from '../taskUpdaters.js';

beforeEach(() => {
  api.mockReset();
  setActiveConfig({
    boards: { tasks: { id: 'tasks-board' } },
    columns: {
      tasks: {
        statusID: { id: 'status_col', type: 'status' },
        custom1ID: { id: 'people_x', type: 'people', title: 'רפרנט', custom: true },
        custom2ID: { id: 'dd_y', type: 'dropdown', title: 'תחום', custom: true },
      },
    },
  });
});

function harness(initial) {
  let state = initial;
  const setTasks = (fn) => { state = typeof fn === 'function' ? fn(state) : fn; };
  const updaters = createTaskUpdaters(setTasks);
  return { updaters, tasks: () => state };
}

describe('round366 — taskUpdaters.updateColumn', () => {
  it('optimistically patches ONLY the edited row and writes the type-formatted value to the REAL column id', async () => {
    api.mockResolvedValue({ change_multiple_column_values: { id: '5' } });
    const { updaters, tasks } = harness([
      { id: '5', custom1ID: [] },
      { id: '6', custom1ID: [{ id: '99', name: 'יוסי' }] },
    ]);
    await updaters.updateColumn('5', 'custom1ID', [{ id: '77', name: 'דנה' }]);
    expect(tasks()[0].custom1ID).toEqual([{ id: '77', name: 'דנה' }]);
    // the OTHER row is untouched — the patch targets one id, not the column
    expect(tasks()[1].custom1ID).toEqual([{ id: '99', name: 'יוסי' }]);
    const call = api.mock.calls.find((c) => String(c[0]).includes('change_multiple_column_values'));
    expect(call).toBeTruthy();
    const cols = JSON.parse(call[1].cols);
    expect(cols.people_x).toEqual({ personsAndTeams: [{ id: 77, kind: 'person' }] });
  });

  it('dropdown value writes by LABEL TEXT', async () => {
    api.mockResolvedValue({ change_multiple_column_values: { id: '5' } });
    const { updaters } = harness([{ id: '5', custom2ID: null }]);
    await updaters.updateColumn('5', 'custom2ID', 'כספים');
    const cols = JSON.parse(api.mock.calls.at(-1)[1].cols);
    expect(cols.dd_y).toEqual({ labels: ['כספים'] });
  });

  it('rolls back the optimistic patch when the write fails', async () => {
    api.mockRejectedValue(new Error('boom'));
    const { updaters, tasks } = harness([{ id: '5', custom2ID: 'תפעול' }]);
    await updaters.updateColumn('5', 'custom2ID', 'כספים');
    expect(tasks()[0].custom2ID).toBe('תפעול');
  });
});
