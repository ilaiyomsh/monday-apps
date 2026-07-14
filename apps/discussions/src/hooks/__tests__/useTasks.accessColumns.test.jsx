import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Item 19 — access columns on task creation: participants → יכולת צפייה
// (taskViewersID), single-person discussion roles → יכולת עריכה (taskEditorsID).
// Mock ONLY api(); the real formatValue serializes the people values, so these
// tests pin the actual column_values shape sent to monday.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useTasks } from '../useTasks.js';

const BASE_COLUMNS = {
  discussions: { tasksBoardLinkID: { id: 'disc_tasks_link', type: 'board_relation' } },
  tasks: {
    statusID: { id: 'status_col', type: 'status' },
    discussionLinkID: { id: 'task_disc_link', type: 'board_relation' },
    taskViewersID: { id: 'viewers_col', type: 'people' },
    taskEditorsID: { id: 'editors_col', type: 'people' },
  },
};

function configure(columns = BASE_COLUMNS) {
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, tasks: { id: 'tasks-board' } },
    columns,
  });
}

// Records every create_item's parsed columnValues for assertions.
function mockServer(createdColumnValues) {
  api.mockImplementation(async (query, vars) => {
    if (query.includes('create_item')) {
      createdColumnValues.push(JSON.parse(vars.cols));
      return { create_item: { id: `real-${createdColumnValues.length}` } };
    }
    if (query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'ok' } };
    if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
    return {};
  });
}

// Extract the people ids a serialized people column carries, tolerant to the
// canonical monday shape ({ personsAndTeams: [{id,kind}] }).
function peopleIds(cv) {
  const list = cv?.personsAndTeams || cv;
  return Array.isArray(list) ? list.map((p) => Number(p?.id ?? p)) : null;
}

beforeEach(() => {
  api.mockReset();
});

describe('useTasks.createTask — access columns (item 19)', () => {
  it('writes viewers→taskViewersID and editors→taskEditorsID on create when mapped', async () => {
    configure();
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', {
        viewers: [{ id: 11 }, { id: 12 }],
        editors: [{ id: 21 }],
      });
    });

    expect(created).toHaveLength(1);
    expect(peopleIds(created[0].viewers_col)).toEqual([11, 12]);
    expect(peopleIds(created[0].editors_col)).toEqual([21]);
  });

  it('omits both columns entirely when they are not mapped in Settings', async () => {
    const { taskViewersID, taskEditorsID, ...tasksRest } = BASE_COLUMNS.tasks;
    configure({ ...BASE_COLUMNS, tasks: tasksRest });
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', {
        viewers: [{ id: 11 }],
        editors: [{ id: 21 }],
      });
    });

    expect(created).toHaveLength(1);
    expect(created[0].viewers_col).toBeUndefined();
    expect(created[0].editors_col).toBeUndefined();
  });

  it('omits both columns when the discussion has no people to inject (empty arrays)', async () => {
    configure();
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', { viewers: [], editors: [] });
    });

    expect(created).toHaveLength(1);
    expect(created[0].viewers_col).toBeUndefined();
    expect(created[0].editors_col).toBeUndefined();
  });
});
