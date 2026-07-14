import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round-75 audit fix D1: fetchTaskCreators filters the responsibility PEOPLE
// column, which requires the "person-<id>" compare_value form — a bare user id
// is silently ignored by monday and matches nothing (empty creators dropdown).
// Mocks ONLY api() and captures the query_params it sends.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { fetchTaskCreators } from '../useMyTasks.js';

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ boards: [{ items_page: { items: [] } }] });
  setActiveConfig({
    boards: { tasks: { id: 'tasks-board' } },
    columns: {
      tasks: {
        taskCreatorID: { id: 'creator_col', type: 'people' },
        responsibilityID: { id: 'resp_col', type: 'people' },
      },
    },
  });
});

describe('useMyTasks.fetchTaskCreators — D1: people filter uses person-<id>', () => {
  it('sends compare_value ["person-<userId>"] on the responsibility column, not a bare id', async () => {
    await fetchTaskCreators({ userId: '4242' });
    expect(api).toHaveBeenCalledTimes(1);
    const vars = api.mock.calls[0][1];
    const rule = vars.qp.rules.find((r) => r.column_id === 'resp_col');
    expect(rule).toBeTruthy();
    expect(rule.compare_value).toEqual(['person-4242']);
    // Guard against a regression back to the bare id that matches nothing.
    expect(rule.compare_value).not.toContain('4242');
  });
});
