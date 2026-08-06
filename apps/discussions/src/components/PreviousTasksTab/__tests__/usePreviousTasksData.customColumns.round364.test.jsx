import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/*
 * round364 — the previous-tasks loaders must fetch owner-added custom mappings
 * (custom<N>ID) exactly like round306 pinned for שותפים: each loader narrows to
 * an explicit column list, and a custom column left out of it renders "—" in
 * the shared TaskTable's custom cells. Both loader shapes are covered:
 *   1. link mode — the relation read carries the custom column ID;
 *   2. by-type (scope=all) — the board read's alias list carries the ALIAS.
 */

const apiMock = vi.fn();
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: (...args) => apiMock(...args),
  cvSelection: () => 'id text value',
  parseValue: (type, cv) => (cv && '__parsed' in cv ? cv.__parsed : null),
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: (board) => (board === 'discussions'
    ? {
      previousDiscussionID: { id: 'rel_prev' },
      tasksBoardLinkID: { id: 'rel_tasks' },
      discussionTypeID: { id: 'dtype', type: 'status' },
      discussionDateID: { id: 'ddate', type: 'date' },
    }
    : {
      responsibilityID: { id: 'people_assignee', type: 'people' },
      deadlineID: { id: 'date1', type: 'date' },
      statusID: { id: 'status1', type: 'status' },
      custom1ID: { id: 'custom_col_p', type: 'board_relation', title: 'פרויקטים', custom: true },
    }),
}));
const boardItemsExecute = vi.fn();
const withColumnsCalls = [];
vi.mock('@api/BoardSDK.js', () => {
  class QueryStub {
    where() { return this; }
    withColumns(cols) { withColumnsCalls.push(cols); return this; }
    withPagination() { return this; }
    orderBy() { return this; }
    execute() { return boardItemsExecute(); }
  }
  return {
    משימות1Board: class { items() { return new QueryStub(); } },
    דיונים1Board: class { items() { return new QueryStub(); } },
  };
});
// STABLE object (hoisted once) — a fresh object per call changes identity on
// every render and spins the hook's effects into an infinite loop (OOM).
const TASK_TYPE_OPTIONS = { options: [{ id: 7, label: 'שבועי' }], loading: false };
vi.mock('@generated/hooks/useDropdownOptions', () => ({
  useDropdownOptions: () => TASK_TYPE_OPTIONS,
}));
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { usePreviousTasksData } from '../usePreviousTasksData.js';

const taskColsOf = (call) => call?.[1]?.taskCols || [];
const relationCall = () => apiMock.mock.calls.find((c) => String(c[0]).includes('linked_items'));

beforeEach(() => {
  apiMock.mockReset();
  boardItemsExecute.mockReset();
  withColumnsCalls.length = 0;
});

describe('round364 — custom columns are fetched by the previous-tasks loaders', () => {
  it('link mode requests the custom column id on the relation read', async () => {
    apiMock.mockImplementation(async (query) => {
      if (query.includes('linked_items')) {
        return { items: [{ column_values: [{ linked_items: [] }] }] };
      }
      return { items: [{ column_values: [{ __parsed: { linkedItems: [{ id: '55', name: 'דיון קודם' }] } }] }] };
    });
    renderHook(() => usePreviousTasksData({ id: '1' }, false, {}));
    await waitFor(() => expect(relationCall()).toBeTruthy());
    const cols = taskColsOf(relationCall());
    expect(cols).toContain('custom_col_p');
    expect(cols).toContain('people_assignee');
  });

  it('by-type mode (scope=all) includes the custom ALIAS in the narrowed board read', async () => {
    boardItemsExecute.mockResolvedValue({ items: [] });
    renderHook(() => usePreviousTasksData({ id: '1', discussionTypeID: 'שבועי' }, true, { scope: 'all' }));
    await waitFor(() => expect(withColumnsCalls.length).toBeGreaterThan(0));
    const tasksRead = withColumnsCalls.find((cols) => cols.includes('responsibilityID'));
    expect(tasksRead).toContain('custom1ID');
  });
});
