import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/*
 * round364 — owner-added custom mappings (custom<N>ID on the tasks board) are
 * rendered read-only in the task tables, so the in-discussion tasks read MUST
 * fetch them: an unfetched alias deserializes to its empty shape and every
 * custom cell silently shows "—" forever.
 */

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
    statusID: { id: 'status_col', type: 'status' },
    taskCreatorID: { id: 'creator_col', type: 'people' },
    custom1ID: { id: 'custom_col_x', type: 'text', title: 'שלב בפרויקט', custom: true },
    // Custom alias whose column was removed from the mapping — must NOT be fetched.
    custom2ID: { id: '', type: 'people', custom: true },
  },
};

beforeEach(() => {
  api.mockReset();
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, tasks: { id: 'tasks-board' } },
    columns: COLUMNS,
  });
});

describe('round364 — useTasks fetches mapped custom columns', () => {
  it('the relation read includes the custom column id (and still the permission columns)', async () => {
    api.mockImplementation(async (query) => {
      if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
      return {};
    });
    renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(api).toHaveBeenCalled());
    const call = api.mock.calls.find((c) => String(c[0]).includes('linked_items'));
    expect(call).toBeTruthy();
    const taskCols = call[1]?.taskCols || [];
    expect(taskCols).toContain('custom_col_x');
    expect(taskCols).toContain('creator_col'); // the permission columns still ride along
    // an UNMAPPED custom alias contributes nothing (no '' entries in the id list)
    expect(taskCols.every((id) => String(id).trim().length > 0)).toBe(true);
  });
});
