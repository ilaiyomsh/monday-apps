import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/*
 * round306 — the personal views edit both PEOPLE columns inline:
 *   · שותפים (partnersID) — a plain optimistic write, no membership consequence.
 *   · אחראי (responsibilityID) — reassigning it can move the task OUT of the
 *     ACTIVE SCOPE, because the scopes are defined by that very column:
 *       'mine'   = server-filtered to "responsible = me"
 *       'others' = led tasks I am NOT responsible for
 *       'led'    = every task in discussions I led (independent of אחראי)
 *     (PR-review finding D) Writing the column in place left the row sitting in a
 *     scope it no longer belongs to — visible and editable — until a refetch.
 */

vi.mock('../../utils/mondayApi/board-config-store.js', () => ({
  getBoardId: vi.fn(() => 'BOARD1'),
  getColumns: vi.fn((board) => (board === 'discussions'
    ? {
      discussionLeadID: { id: 'lead_col', type: 'people' },
      tasksBoardLinkID: { id: 'rel_tasks', type: 'board_relation' },
    }
    : {
      responsibilityID: { id: 'people_col', type: 'people' },
      partnersID: { id: 'partners_col', type: 'people' },
      statusID: { id: 'status_col', type: 'status' },
    })),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const sdk = {
  execute: vi.fn(),
  discussionsExecute: vi.fn(),
  updatePayloads: [],
  updateExecute: vi.fn(async () => ({ id: 'X' })),
};
vi.mock('@api/BoardSDK.js', () => {
  const builder = (execute) => {
    const b = {
      withColumns: () => b, withGroup: () => b, withPagination: () => b,
      where: () => b, orderBy: () => b, execute: () => execute(),
    };
    return b;
  };
  return {
    משימות1Board: class {
      items() { return builder(() => sdk.execute()); }
      item(id) {
        return {
          update: (payload) => {
            sdk.updatePayloads.push({ id, payload });
            return { execute: sdk.updateExecute };
          },
        };
      }
    },
    דיונים1Board: class { items() { return builder(() => sdk.discussionsExecute()); } },
  };
});
const apiMock = vi.fn();
vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  api: (...a) => apiMock(...a),
  // people columns come back as the already-parsed list we stash on the value
  parseValue: (type, cv) => (cv && '__parsed' in cv ? cv.__parsed : null),
  cvSelection: vi.fn(() => 'id'),
}));

import { useMyTasks } from '../useMyTasks.js';

const ME = '42';
const OTHER = '99';
const mine = (over = {}) => ({ id: '1', name: 'משימה', statusID: 1, responsibilityID: [{ id: ME }], ...over });

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
  vi.clearAllMocks();
  sdk.updatePayloads = [];
  sdk.updateExecute = vi.fn(async () => ({ id: 'X' }));
  sdk.execute = vi.fn(async () => ({ items: [mine()], cursor: null }));
  sdk.discussionsExecute = vi.fn(async () => ({ items: [] }));
  apiMock.mockResolvedValue({ items: [] });
});

const mounted = async (props = {}) => {
  const hook = renderHook((p) => useMyTasks(p), {
    initialProps: { currentUser: { id: ME }, context: {}, ...props },
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe('שותפים — plain optimistic people write', () => {
  it('writes the partnersID column and shows the new people immediately', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.updateTaskPartners('1', [{ id: OTHER }]); });
    expect(sdk.updatePayloads).toEqual([{ id: '1', payload: { partnersID: [{ id: OTHER }] } }]);
    expect(result.current.items[0].partnersID).toEqual([{ id: OTHER }]);
  });

  it('never drops the row — שותפים does not define any scope', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.updateTaskPartners('1', []); });
    expect(result.current.items.map((t) => t.id)).toEqual(['1']);
  });

  it('reverts the optimistic value when the write fails', async () => {
    sdk.updateExecute = vi.fn(async () => { throw new Error('boom'); });
    const { result } = await mounted();
    await act(async () => { await result.current.updateTaskPartners('1', [{ id: OTHER }]); });
    expect(result.current.items[0].partnersID).toBeUndefined();
    expect(result.current.items.map((t) => t.id)).toEqual(['1']); // still listed
  });
});

describe('אחראי — the row is reconciled with the active scope (finding D)', () => {
  it("scope 'mine': reassigning to someone else removes the row", async () => {
    const { result } = await mounted({ scope: 'mine' });
    await act(async () => { await result.current.updateTaskAssignee('1', [{ id: OTHER }]); });
    expect(sdk.updatePayloads).toEqual([{ id: '1', payload: { responsibilityID: [{ id: OTHER }] } }]);
    expect(result.current.items).toEqual([]);
  });

  it("scope 'mine': clearing אחראי entirely also removes the row", async () => {
    const { result } = await mounted({ scope: 'mine' });
    await act(async () => { await result.current.updateTaskAssignee('1', []); });
    expect(result.current.items).toEqual([]);
  });

  it("scope 'mine': a reassignment that still includes me KEEPS the row", async () => {
    const { result } = await mounted({ scope: 'mine' });
    await act(async () => { await result.current.updateTaskAssignee('1', [{ id: OTHER }, { id: ME }]); });
    expect(result.current.items.map((t) => t.id)).toEqual(['1']);
    expect(result.current.items[0].responsibilityID).toEqual([{ id: OTHER }, { id: ME }]);
  });

  it("scope 'others': taking the task MYSELF removes it (it became 'משימה שלי')", async () => {
    // The led pipeline: one discussion I lead, linking task 7 — which is
    // assigned to someone else, so it belongs to the 'others' scope.
    sdk.discussionsExecute = vi.fn(async () => ({
      items: [{ id: 'd1', discussionLeadID: [{ id: ME }], tasksBoardLinkID: { ids: ['7'] } }],
    }));
    apiMock.mockResolvedValue({
      items: [{ id: '7', name: 'משימה של אחר', column_values: [{ id: 'people_col', __parsed: [{ id: OTHER }] }] }],
    });
    const { result } = await mounted({ scope: 'others' });
    await waitFor(() => expect(result.current.items.map((t) => t.id)).toEqual(['7']));
    await act(async () => { await result.current.updateTaskAssignee('7', [{ id: ME }]); });
    expect(result.current.items).toEqual([]);
  });

  // round306 PR review — the scope decision must follow the SERVER, not the request.
  it("scope 'mine': a FAILED write keeps the row (the board still has me as אחראי)", async () => {
    sdk.updateExecute = vi.fn(async () => { throw new Error('rejected'); });
    const { result } = await mounted({ scope: 'mine' });
    await act(async () => { await result.current.updateTaskAssignee('1', [{ id: OTHER }]); });
    // reverted AND still listed — dropping it would hide a task that is still mine
    expect(result.current.items.map((t) => t.id)).toEqual(['1']);
    expect(result.current.items[0].responsibilityID).toEqual([{ id: ME }]);
  });

  it("scope 'others': a FAILED write to take the task myself keeps it listed", async () => {
    sdk.discussionsExecute = vi.fn(async () => ({
      items: [{ id: 'd1', discussionLeadID: [{ id: ME }], tasksBoardLinkID: { ids: ['7'] } }],
    }));
    apiMock.mockResolvedValue({
      items: [{ id: '7', name: 'משימה של אחר', column_values: [{ id: 'people_col', __parsed: [{ id: OTHER }] }] }],
    });
    const { result } = await mounted({ scope: 'others' });
    await waitFor(() => expect(result.current.items.map((t) => t.id)).toEqual(['7']));
    sdk.updateExecute = vi.fn(async () => { throw new Error('rejected'); });
    await act(async () => { await result.current.updateTaskAssignee('7', [{ id: ME }]); });
    expect(result.current.items.map((t) => t.id)).toEqual(['7']);
  });

  it("scope 'led': the row stays whoever is responsible (the scope is the discussion, not אחראי)", async () => {
    sdk.discussionsExecute = vi.fn(async () => ({
      items: [{ id: 'd1', discussionLeadID: [{ id: ME }], tasksBoardLinkID: { ids: ['7'] } }],
    }));
    apiMock.mockResolvedValue({
      items: [{ id: '7', name: 'משימה בדיון שהובלתי', column_values: [{ id: 'people_col', __parsed: [{ id: ME }] }] }],
    });
    const { result } = await mounted({ scope: 'led' });
    await waitFor(() => expect(result.current.items.map((t) => t.id)).toEqual(['7']));
    await act(async () => { await result.current.updateTaskAssignee('7', [{ id: OTHER }]); });
    expect(result.current.items.map((t) => t.id)).toEqual(['7']);
  });
});
