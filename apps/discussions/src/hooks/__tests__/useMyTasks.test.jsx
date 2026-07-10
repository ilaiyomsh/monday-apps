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
import { writeViewCache, makeViewCacheKey } from '../../utils/viewCache.js';

const page = (items, cursor = null) => ({ items, cursor });
const task = (id, over = {}) => ({ id: String(id), name: `t${id}`, statusID: 1, priorityID: null, taskNotesID: '', ...over });

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ } // isolate the view cache between tests
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


describe('useMyTasks — instant cache seed (stale-while-revalidate)', () => {
  const KEY = makeViewCacheKey('myTasks', { userId: '42', boardId: 'BOARD1' });

  it('seeds the first paint from cache (no spinner), then revalidates + reconciles', async () => {
    writeViewCache(KEY, [task(1), task(2)], 'SEEDCUR');
    // Hold the background revalidate open so we can observe the seeded paint.
    let resolveExec;
    sdkState.execute = vi.fn(() => new Promise((r) => { resolveExec = r; }));

    const { result } = renderHook(() => useMyTasks({ currentUser: { id: '42' }, context: {} }));

    // Instant paint from the seed — loading is already false.
    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((t) => t.id)).toEqual(['1', '2']);

    // Fresh page: 2 deleted remotely, 3 added, 1 edited remotely.
    await act(async () => { resolveExec(page([task(1, { statusID: 9 }), task(3)], 'FRESHCUR')); });
    await waitFor(() => expect(result.current.items.map((t) => t.id)).toEqual(['1', '3']));
    expect(result.current.items.find((t) => t.id === '1').statusID).toBe(9); // remote edit applied
    expect(result.current.cursor).toBe('FRESHCUR');
    expect(result.current.loading).toBe(false); // never flipped a spinner during the silent revalidate
  });

  it('keeps an optimistic create made during the revalidate window (no drop)', async () => {
    writeViewCache(KEY, [task(1)], null);
    let resolveExec;
    sdkState.execute = vi.fn(() => new Promise((r) => { resolveExec = r; }));

    const { result } = renderHook(() => useMyTasks({ currentUser: { id: '42' }, context: {} }));
    expect(result.current.items.map((t) => t.id)).toEqual(['1']); // seeded paint

    // Create a row while the background revalidate is still in flight (temp → NEW).
    await act(async () => { await result.current.createTask({ name: 'X', prepend: true }); });
    expect(result.current.items.map((t) => t.id)).toEqual(['NEW', '1']);

    // Fresh page carries 1 + a remote 2, but NOT the just-created row.
    await act(async () => { resolveExec(page([task(1), task(2)], null)); });
    await waitFor(() => expect(result.current.items.map((t) => t.id)).toContain('2'));
    // Fresh [1,2] is authoritative AND the optimistic create is preserved.
    expect(result.current.items.map((t) => t.id).sort()).toEqual(['1', '2', 'NEW']);
  });

  it('a cache MISS behaves exactly as before (staged fetch fills the list)', async () => {
    sdkState.execute = vi.fn(async () => page([task(1), task(2)], 'CUR')); // no seed written this test
    const { result } = await mounted();
    expect(result.current.items.map((t) => t.id)).toEqual(['1', '2']);
    expect(result.current.hasMore).toBe(true);
  });
});

// REGRESSION (round 39): a fresh row's deadlineID is a real Date; the round-37
// JSON cache round-trip turned it into a STRING, so the SEEDED row threw
// "E.toLocaleDateString is not a function" the moment MyTasksRow rendered it.
// The round-37 tests missed this because they seeded PLAIN fakes (no real Date).
// Here we seed a REAL Date and assert the seeded row exposes a real Date.
describe('useMyTasks — cache seed preserves Date fields (regression)', () => {
  const KEY = makeViewCacheKey('myTasks', { userId: '42', boardId: 'BOARD1' });

  it('seeds a Date-bearing row from cache as a REAL Date (not a string)', async () => {
    const deadline = new Date(2026, 6, 10);
    writeViewCache(KEY, [task(1, { deadlineID: deadline })], 'SEEDCUR');
    // Hold the background revalidate open so we observe the SEEDED row itself.
    let resolveExec;
    sdkState.execute = vi.fn(() => new Promise((r) => { resolveExec = r; }));
    const { result } = renderHook(() => useMyTasks({ currentUser: { id: '42' }, context: {} }));

    const seeded = result.current.items[0];
    expect(seeded.id).toBe('1');
    expect(seeded.deadlineID).toBeInstanceOf(Date);
    expect(() => seeded.deadlineID.toLocaleDateString('en-GB')).not.toThrow(); // the crash, now safe
    expect(seeded.deadlineID.getTime()).toBe(deadline.getTime());

    // Let the silent revalidate settle so nothing leaks past the test.
    await act(async () => { resolveExec(page([task(1, { deadlineID: deadline })], null)); });
  });
});
