import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round-75 audit fixes for useTasks:
//   D2 — fetchTasksByDiscussion must FETCH the permission role-source people
//        columns (taskCreatorID / taskViewersID / taskEditorsID), else resolveCan
//        scans falsely-empty arrays and the matrix denies edits inconsistently.
//   R2 — a create whose relation-link write fails must NOT re-run create_item on
//        retry (that duplicates the task on the board); it resumes from the link.
// Mocks ONLY api() so the real BoardSDK builds the queries/mutations.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useTasks } from '../useTasks.js';

const COLUMNS = {
  discussions: { tasksBoardLinkID: { id: 'disc_tasks_link', type: 'board_relation' } },
  tasks: {
    responsibilityID: { id: 'resp_col', type: 'people' },
    deadlineID: { id: 'deadline_col', type: 'date' },
    statusID: { id: 'status_col', type: 'status' },
    priorityID: { id: 'priority_col', type: 'status' },
    discussionLinkID: { id: 'task_disc_link', type: 'board_relation' },
    taskCreatorID: { id: 'creator_col', type: 'people' },
    taskViewersID: { id: 'viewers_col', type: 'people' },
    taskEditorsID: { id: 'editors_col', type: 'people' },
  },
};

function configure() {
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, tasks: { id: 'tasks-board' } },
    columns: COLUMNS,
  });
}

beforeEach(() => {
  api.mockReset();
});

describe('useTasks — D2: permission role-source columns are fetched', () => {
  it('the discussion tasks query requests creator + viewers + editors column ids', async () => {
    configure();
    let fetchVars = null;
    api.mockImplementation(async (query, vars) => {
      if (query.includes('linked_items')) { fetchVars = vars; return { items: [{ column_values: [{ linked_items: [] }] }] }; }
      return {};
    });
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // responsibilityID was always fetched; the fix ADDS the three role columns.
    expect(fetchVars.taskCols).toEqual(expect.arrayContaining([
      'resp_col', 'creator_col', 'viewers_col', 'editors_col',
    ]));
  });
});

describe('useTasks — R2: retry after a failed link write does not duplicate the item', () => {
  it('create_item runs ONCE across create + retry when the relation write fails first', async () => {
    configure();
    let createCount = 0;
    let failRelationOnce = true;
    api.mockImplementation(async (query) => {
      if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
      if (query.includes('create_item')) { createCount += 1; return { create_item: { id: `real-${createCount}` } }; }
      if (query.includes('change_multiple_column_values')) {
        // The relation-link write is the first change_multiple after create.
        if (failRelationOnce) { failRelationOnce = false; throw new Error('relation write failed'); }
        return { change_multiple_column_values: { id: 'ok' } };
      }
      return {};
    });

    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First create: create_item succeeds, relation write throws → row flagged.
    await act(async () => { await result.current.createTask('משימה'); });
    const failedRow = result.current.items.find((i) => i._createFailed);
    expect(failedRow).toBeTruthy();
    expect(createCount).toBe(1);

    // Retry: MUST resume from the link write, NOT create a second item.
    await act(async () => { await result.current.retryCreate(failedRow.id); });
    expect(createCount).toBe(1); // still one — no duplicate on the board
    // And the row is now committed to its real id (relation write succeeded).
    expect(result.current.items.some((i) => String(i.id) === 'real-1')).toBe(true);
  });
});
