import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Mocks -----------------------------------------------------------------
// Mock the board-config-store so the hook believes the tasks board + responsibilityID
// (responsibility) are mapped.
vi.mock('../../utils/mondayApi/board-config-store.js', () => ({
  getBoardId: vi.fn(() => 'BOARD1'),
  getColumns: vi.fn(() => ({
    responsibilityID: { id: 'people_col', type: 'people' },
    statusID: { id: 'status_col', type: 'status' },
    taskNotesID: { id: 'notes_col', type: 'long_text' },
    priorityID: { id: 'priority_col', type: 'status' },
    taskCreatorID: { id: 'creator_col', type: 'people' },
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Capture the fluent BoardSDK calls so we can assert query shape + drive results.
const sdkState = {
  withColumns: vi.fn(),
  withGroup: vi.fn(),
  withPagination: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  execute: vi.fn(),
  updatePayloads: [],
  updateExecute: vi.fn(async () => ({ id: 'X' })),
  createPayloads: [],
  createExecute: vi.fn(async () => ({ id: 'NEW' })),
};

vi.mock('@api/BoardSDK.js', () => {
  class FakeBoard {
    items() {
      const builder = {
        withColumns: (...a) => { sdkState.withColumns(...a); return builder; },
        withGroup: (...a) => { sdkState.withGroup(...a); return builder; },
        withPagination: (...a) => { sdkState.withPagination(...a); return builder; },
        where: (...a) => { sdkState.where(...a); return builder; },
        orderBy: (...a) => { sdkState.orderBy(...a); return builder; },
        execute: (...a) => sdkState.execute(...a),
      };
      return builder;
    }
    item(id) {
      return {
        update: (payload) => {
          sdkState.updatePayloads.push({ id, payload });
          return { execute: sdkState.updateExecute };
        },
        create: (payload, opts) => {
          sdkState.createPayloads.push({ payload, opts });
          return { execute: sdkState.createExecute };
        },
      };
    }
  }
  return { משימות1Board: FakeBoard };
});

// monday-client is only used by fetchTaskCreators (not exercised in the hook
// path here), but importing the hook pulls it in — stub it lightly.
vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ boards: [{ items_page: { items: [] } }] })),
  parseValue: vi.fn(() => []),
  cvSelection: vi.fn(() => 'id'),
}));

import { useMyTasks, buildMyTasksWhere, resolveUserId } from '../useMyTasks.js';

const page = (items, cursor = null) => ({ items, cursor });
const task = (id, over = {}) => ({ id: String(id), name: `t${id}`, statusID: 1, priorityID: null, taskNotesID: '', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sdkState.updatePayloads = [];
  sdkState.updateExecute = vi.fn(async () => ({ id: 'X' }));
  sdkState.createPayloads = [];
  sdkState.createExecute = vi.fn(async () => ({ id: 'NEW' }));
  sdkState.execute = vi.fn(async () => page([task(1), task(2)]));
});

async function mounted(props = {}) {
  const hook = renderHook((p) => useMyTasks(p), {
    initialProps: { currentUser: { id: '42' }, context: {}, ...props },
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('resolveUserId', () => {
  it('prefers currentUser.id, falls back through context', () => {
    expect(resolveUserId({ id: 7 }, {})).toBe('7');
    expect(resolveUserId(null, { user: { id: 9 } })).toBe('9');
    expect(resolveUserId(null, { userId: 11 })).toBe('11');
    expect(resolveUserId(null, null)).toBeNull();
  });
});

describe('buildMyTasksWhere', () => {
  it('maps responsibility (responsibilityID) to the current user via where alias', () => {
    expect(buildMyTasksWhere({ userId: '42' })).toEqual({ responsibilityID: '42' });
  });
  it('adds the optional creator + search filters', () => {
    expect(buildMyTasksWhere({ userId: '42', taskCreatorId: '7', search: '  hi ' }))
      .toEqual({ responsibilityID: '42', taskCreatorID: '7', name: 'hi' });
  });
  it('omits empty search', () => {
    expect(buildMyTasksWhere({ userId: '42', search: '   ' })).toEqual({ responsibilityID: '42' });
  });
});

describe('useMyTasks — fetch', () => {
  it('queries the assigned-to-me page and exposes items + cursor', async () => {
    sdkState.execute = vi.fn(async () => page([task(1), task(2)], 'CUR'));
    const { result } = await mounted();
    expect(result.current.items.map((t) => t.id)).toEqual(['1', '2']);
    expect(result.current.hasMore).toBe(true);
    // filtered to the current user on responsibilityID, and asked for the item group.
    expect(sdkState.where).toHaveBeenCalledWith({ responsibilityID: '42' });
    expect(sdkState.withGroup).toHaveBeenCalled();
  });

  it('stays empty (no query) when no user resolves', async () => {
    const { result } = await mounted({ currentUser: null, context: {} });
    expect(result.current.items).toEqual([]);
    expect(sdkState.execute).not.toHaveBeenCalled();
  });

  it('passes a sort through to orderBy', async () => {
    await mounted({ sort: { column: 'deadlineID', direction: 'asc' } });
    expect(sdkState.orderBy).toHaveBeenCalledWith({ column: 'deadlineID', direction: 'asc' });
  });

  it('applies the optional taskCreatorID filter', async () => {
    await mounted({ taskCreatorId: '7' });
    expect(sdkState.where).toHaveBeenCalledWith({ responsibilityID: '42', taskCreatorID: '7' });
  });
});

describe('useMyTasks — loadMore', () => {
  it('appends the next page and de-dupes by id', async () => {
    sdkState.execute = vi.fn(async () => page([task(1), task(2)], 'CUR'));
    const { result } = await mounted();
    sdkState.execute = vi.fn(async () => page([task(2), task(3)], null));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(result.current.hasMore).toBe(false);
  });
});

describe('useMyTasks — optimistic inline edits', () => {
  it('updateTaskStatus optimistically and writes through BoardSDK', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.updateTaskStatus('1', 2); });
    expect(result.current.items.find((t) => t.id === '1').statusID).toBe(2);
    expect(sdkState.updatePayloads).toContainEqual({ id: '1', payload: { statusID: 2 } });
  });

  it('reverts status on write error', async () => {
    const { result } = await mounted();
    sdkState.updateExecute = vi.fn(async () => { throw new Error('boom'); });
    await act(async () => { await result.current.updateTaskStatus('1', 2); });
    expect(result.current.items.find((t) => t.id === '1').statusID).toBe(1); // reverted
  });

  it('updateTaskPriority optimistically and writes through BoardSDK', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.updateTaskPriority('1', 3); });
    expect(result.current.items.find((t) => t.id === '1').priorityID).toBe(3);
    expect(sdkState.updatePayloads).toContainEqual({ id: '1', payload: { priorityID: 3 } });
  });

  it('reverts priorityID on write error', async () => {
    sdkState.execute = vi.fn(async () => page([task(1, { priorityID: 5 })]));
    const { result } = await mounted();
    sdkState.updateExecute = vi.fn(async () => { throw new Error('boom'); });
    await act(async () => { await result.current.updateTaskPriority('1', 9); });
    expect(result.current.items.find((t) => t.id === '1').priorityID).toBe(5); // reverted
  });

  it('updateTaskNotes optimistically and writes through BoardSDK', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.updateTaskNotes('2', 'הערה'); });
    expect(result.current.items.find((t) => t.id === '2').taskNotesID).toBe('הערה');
    expect(sdkState.updatePayloads).toContainEqual({ id: '2', payload: { taskNotesID: 'הערה' } });
  });

  it('reverts notes on write error', async () => {
    sdkState.execute = vi.fn(async () => page([task(1, { taskNotesID: 'orig' })]));
    const { result } = await mounted();
    sdkState.updateExecute = vi.fn(async () => { throw new Error('boom'); });
    await act(async () => { await result.current.updateTaskNotes('1', 'changed'); });
    expect(result.current.items.find((t) => t.id === '1').taskNotesID).toBe('orig');
  });
});

describe('useMyTasks — createTask (prepend + reconcile)', () => {
  it('prepends the optimistic row to the FRONT with prepend:true, then swaps temp→real', async () => {
    const { result } = await mounted(); // items ['1','2']
    await act(async () => { await result.current.createTask({ name: 'חדשה', prepend: true }); });
    expect(result.current.items[0].name).toBe('חדשה');
    expect(result.current.items.map((t) => t.id)).toEqual(['NEW', '1', '2']);
  });

  it('appends to the BOTTOM by default (no prepend)', async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.createTask({ name: 'אחרונה' }); });
    const last = result.current.items[result.current.items.length - 1];
    expect(last.name).toBe('אחרונה');
    expect(last.id).toBe('NEW');
  });

  it('fires onOptimistic(tempId) then onReconcile(tempId, realId)', async () => {
    const { result } = await mounted();
    const onOptimistic = vi.fn();
    const onReconcile = vi.fn();
    await act(async () => {
      await result.current.createTask({ name: 'x', prepend: true, onOptimistic, onReconcile });
    });
    expect(onOptimistic).toHaveBeenCalledTimes(1);
    const tempId = onOptimistic.mock.calls[0][0];
    expect(String(tempId)).toMatch(/^temp-/);
    expect(onReconcile).toHaveBeenCalledWith(tempId, 'NEW');
  });
});
