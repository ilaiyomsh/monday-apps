import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Item 19 — the access column on task creation: the discussion's single-person roles
// (lead / coordinator / creator) → יכולת עריכה (taskEditorsID). round340 retired the
// participants → יכולת צפייה half along with its column, so `viewers` is no longer a
// createTask option at all and must reach no column.
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
  it('writes editors→taskEditorsID on create when mapped', async () => {
    configure();
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', { editors: [{ id: 21 }] });
    });

    expect(created).toHaveLength(1);
    expect(peopleIds(created[0].editors_col)).toEqual([21]);
  });

  /*
   * round340 — a stale `viewers` option must reach NO column. This is the guard that
   * makes the retirement real rather than cosmetic: DiscussionCard no longer builds
   * the key, but a caller (or an old cached bundle) that still passes it must not have
   * it silently land somewhere, and dropping the destructure without this test would
   * leave that failure mode untested.
   */
  it('ignores a stale `viewers` option — it reaches no column at all', async () => {
    configure();
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', { viewers: [{ id: 11 }], editors: [{ id: 21 }] });
    });

    expect(created).toHaveLength(1);
    expect(created[0].viewers_col).toBeUndefined();
    // and the editors write is unaffected by the stray key
    expect(peopleIds(created[0].editors_col)).toEqual([21]);
  });

  it('omits the column entirely when it is not mapped in Settings', async () => {
    const { taskEditorsID, ...tasksRest } = BASE_COLUMNS.tasks;
    configure({ ...BASE_COLUMNS, tasks: tasksRest });
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', { editors: [{ id: 21 }] });
    });

    expect(created).toHaveLength(1);
    expect(created[0].editors_col).toBeUndefined();
  });

  it('omits the column when the discussion has no people to inject (empty array)', async () => {
    configure();
    const created = [];
    mockServer(created);
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createTask('משימה', { editors: [] });
    });

    expect(created).toHaveLength(1);
    expect(created[0].editors_col).toBeUndefined();
  });
});
