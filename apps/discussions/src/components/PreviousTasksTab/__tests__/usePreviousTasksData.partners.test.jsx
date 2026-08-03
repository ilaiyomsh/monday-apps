import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/*
 * round306 PR review (finding A) — this tab RENDERS and EDITS the שותפים
 * (partnersID) column, so every one of its three loaders must FETCH it. Each
 * loader narrows the read to an explicit column list, and a column left out of
 * that list comes back undefined: the picker would open EMPTY and the next pick
 * would write that empty list over the row's real partners.
 *
 * The three paths, all covered here:
 *   1. link mode           — previous discussion's tasksBoardLinkID relation
 *   2. by-type, scope=all  — server-side taskTypeID filter via BoardSDK
 *   3. by-type, scope=last — latest same-type discussion's relation
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
      partnersID: { id: 'people_partners', type: 'people' },
      deadlineID: { id: 'date1', type: 'date' },
      statusID: { id: 'status1', type: 'status' },
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
const TASK_TYPE_OPTIONS = { options: [{ id: 7, label: 'שבועי' }], loading: false };
vi.mock('@generated/hooks/useDropdownOptions', () => ({
  useDropdownOptions: () => TASK_TYPE_OPTIONS,
}));
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { usePreviousTasksData } from '../usePreviousTasksData.js';

// The relation read passes the fetched task columns as the `taskCols` variable.
const taskColsOf = (call) => call?.[1]?.taskCols || [];
const relationCall = () => apiMock.mock.calls.find((c) => String(c[0]).includes('linked_items'));

beforeEach(() => {
  apiMock.mockReset();
  boardItemsExecute.mockReset();
  withColumnsCalls.length = 0;
});

describe('שותפים is fetched by every previous-tasks loader (round306 review)', () => {
  it('link mode requests the partners column alongside אחראי', async () => {
    apiMock.mockImplementation(async (query) => {
      if (query.includes('linked_items')) {
        return { items: [{ column_values: [{ linked_items: [] }] }] };
      }
      return { items: [{ column_values: [{ __parsed: { linkedItems: [{ id: '55', name: 'דיון קודם' }] } }] }] };
    });

    renderHook(() => usePreviousTasksData({ id: '1' }, false, {}));
    await waitFor(() => expect(relationCall()).toBeTruthy());
    const cols = taskColsOf(relationCall());
    expect(cols).toContain('people_partners');
    expect(cols).toContain('people_assignee'); // the neighbour still rides along
  });

  it('by-type mode (scope=all) narrows the board read to a list that includes partnersID', async () => {
    boardItemsExecute.mockResolvedValue({ items: [] });
    renderHook(() => usePreviousTasksData({ id: '1', discussionTypeID: 'שבועי' }, true, { scope: 'all' }));
    await waitFor(() => expect(withColumnsCalls.length).toBeGreaterThan(0));
    const tasksRead = withColumnsCalls.find((cols) => cols.includes('responsibilityID'));
    expect(tasksRead).toContain('partnersID');
  });

  it('by-type mode (scope=last) requests the partners column on the relation read too', async () => {
    // The discussions read finds one OTHER same-type discussion; then its tasks
    // are read off the relation exactly as in link mode.
    boardItemsExecute.mockResolvedValue({
      items: [
        { id: '1', discussionTypeID: 'שבועי', discussionDateID: new Date('2026-05-01') },
        { id: '55', discussionTypeID: 'שבועי', discussionDateID: new Date('2026-04-01') },
      ],
    });
    apiMock.mockResolvedValue({ items: [{ column_values: [{ linked_items: [] }] }] });

    renderHook(() => usePreviousTasksData({ id: '1', discussionTypeID: 'שבועי' }, true, { scope: 'last' }));
    await waitFor(() => expect(relationCall()).toBeTruthy());
    expect(taskColsOf(relationCall())).toContain('people_partners');
  });
});
