import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// round146 — the data layer moved out of PreviousTasksTab into
// usePreviousTasksData. These tests pin the two resolution paths that moved:
// link mode (previous-discussion relation -> its tasks) and by-type mode
// (discussion type text -> tasks-board label id -> server-side filter).

const apiMock = vi.fn();
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: (...args) => apiMock(...args),
  cvSelection: () => 'id text value',
  parseValue: (type, cv) => (cv && '__parsed' in cv ? cv.__parsed : null),
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: (board) => (board === 'discussions'
    ? { previousDiscussionID: { id: 'rel_prev' }, tasksBoardLinkID: { id: 'rel_tasks' } }
    : {
      responsibilityID: { id: 'people1', type: 'people' },
      deadlineID: { id: 'date1', type: 'date' },
      statusID: { id: 'status1', type: 'status' },
    }),
}));
const boardItemsExecute = vi.fn();
vi.mock('@api/BoardSDK.js', () => {
  class QueryStub {
    where() { return this; }
    withColumns() { return this; }
    withPagination() { return this; }
    orderBy() { return this; }
    execute() { return boardItemsExecute(); }
  }
  return {
    משימות1Board: class { items() { return new QueryStub(); } },
    דיונים1Board: class { items() { return new QueryStub(); } },
  };
});
// Stable reference — the real useDropdownOptions memoizes its options; a fresh
// array per render would re-fire the hook's typeFilter effect forever.
const TASK_TYPE_OPTIONS = { options: [{ id: 7, label: 'שבועי' }], loading: false };
vi.mock('@generated/hooks/useDropdownOptions', () => ({
  useDropdownOptions: () => TASK_TYPE_OPTIONS,
}));
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { usePreviousTasksData } from '../usePreviousTasksData.js';

beforeEach(() => { apiMock.mockReset(); boardItemsExecute.mockReset(); });

describe('usePreviousTasksData — link mode (byType=false)', () => {
  it('resolves the previous discussion off the relation column, then loads its tasks', async () => {
    apiMock.mockImplementation(async (query) => {
      if (query.includes('linked_items')) {
        // the previous discussion's tasksBoardLinkID relation -> its tasks
        return {
          items: [{
            column_values: [{
              linked_items: [{
                id: '9', name: 'משימה קודמת', created_at: '2026-01-01',
                column_values: [{ id: 'status1', __parsed: 'done' }],
              }],
            }],
          }],
        };
      }
      // the current discussion's previousDiscussionID relation
      return { items: [{ column_values: [{ __parsed: { linkedItems: [{ id: '55', name: 'דיון קודם' }] } }] }] };
    });

    const { result } = renderHook(() => usePreviousTasksData({ id: '1' }, false, {}));
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.previousDiscussionId).toBe('55');
    expect(result.current.previousDiscussionLabel).toBe('דיון קודם');
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    expect(result.current.tasks[0]).toMatchObject({ id: '9', name: 'משימה קודמת', statusID: 'done' });
  });
});

describe('usePreviousTasksData — by-type mode (byType=true)', () => {
  it('bridges the type TEXT to the tasks-board label id, loads by type, and resets selection', async () => {
    boardItemsExecute.mockResolvedValue({ items: [{ id: '3', name: 'משימת סוג' }] });
    const onResetSelection = vi.fn();
    const { result } = renderHook(() =>
      usePreviousTasksData({ id: '1', discussionTypeID: 'שבועי' }, true, { onResetSelection }));

    await waitFor(() => expect(result.current.typeFilter).toEqual({ taskTypeId: 7, label: 'שבועי' }));
    await waitFor(() => expect(result.current.tasks).toEqual([{ id: '3', name: 'משימת סוג' }]));
    expect(onResetSelection).toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled(); // link resolution is skipped in by-type mode
  });

  it('yields no tasks when the type text has no matching tasks-board label', async () => {
    const { result } = renderHook(() =>
      usePreviousTasksData({ id: '1', discussionTypeID: 'לא קיים' }, true, {}));
    await waitFor(() => expect(result.current.typeFilter).toEqual({ taskTypeId: null, label: 'לא קיים' }));
    expect(boardItemsExecute).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
  });
});
