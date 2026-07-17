import { describe, it, expect, vi, beforeEach } from 'vitest';

// round146 — the optimistic updaters moved out of PreviousTasksTab into
// taskUpdaters.js. These tests pin the optimistic-then-revert contract:
// apply locally first, write via BoardSDK, revert (only the failed ids in
// batch mode) when the write rejects.
//
// Note: updateMock only RECORDS calls; the rejection itself is constructed in
// the mock's execute() (via failIds) — a vi.fn that directly returns a rejected
// promise trips vitest's unhandled-rejection tracking even when the caller
// handles it.

const updateMock = vi.fn();
let failIds = new Set();
vi.mock('@api/BoardSDK.js', () => ({
  משימות1Board: class {
    item(id) {
      return {
        update: (patch) => ({
          execute: () => {
            updateMock(id, patch);
            return failIds.has(String(id)) ? Promise.reject(new Error('boom')) : Promise.resolve({});
          },
        }),
      };
    }
  },
}));
vi.mock('@generated/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { createTaskUpdaters } from '../taskUpdaters.js';

// A minimal stand-in for React's setState(fn): applies the reducer to a held
// list so the tests can observe every optimistic apply/revert.
function makeStore(initial) {
  let list = initial;
  const setTasks = (updater) => { list = typeof updater === 'function' ? updater(list) : updater; };
  return { setTasks, get: () => list };
}

beforeEach(() => { updateMock.mockReset(); failIds = new Set(); });

describe('createTaskUpdaters — single-item optimistic updates', () => {
  it('updateStatus applies locally and writes via BoardSDK', async () => {
    const store = makeStore([{ id: '1', statusID: 'a' }, { id: '2', statusID: 'a' }]);
    const { updateStatus } = createTaskUpdaters(store.setTasks);
    await updateStatus('1', 'b');
    expect(store.get()).toEqual([{ id: '1', statusID: 'b' }, { id: '2', statusID: 'a' }]);
    expect(updateMock).toHaveBeenCalledExactlyOnceWith('1', { statusID: 'b' });
  });

  it('updateStatus reverts the whole list when the write rejects', async () => {
    failIds.add('1');
    const store = makeStore([{ id: '1', statusID: 'a' }]);
    const { updateStatus } = createTaskUpdaters(store.setTasks);
    await updateStatus('1', 'b');
    expect(store.get()).toEqual([{ id: '1', statusID: 'a' }]);
  });

  it('updateName ignores an empty/whitespace-only name (no local change, no write)', async () => {
    const store = makeStore([{ id: '1', name: 'ישן' }]);
    const { updateName } = createTaskUpdaters(store.setTasks);
    await updateName('1', '   ');
    expect(store.get()).toEqual([{ id: '1', name: 'ישן' }]);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('createTaskUpdaters — batch partial failure', () => {
  it('updateStatusBatch reverts ONLY the ids whose write failed', async () => {
    failIds.add('2');
    const store = makeStore([
      { id: '1', statusID: 'a' }, { id: '2', statusID: 'a' }, { id: '3', statusID: 'a' },
    ]);
    const { updateStatusBatch } = createTaskUpdaters(store.setTasks);
    await updateStatusBatch(['1', '2', '3'], 'b');
    expect(store.get()).toEqual([
      { id: '1', statusID: 'b' }, { id: '2', statusID: 'a' }, { id: '3', statusID: 'b' },
    ]);
  });

  it('updateDeadlineBatch writes the date formatted as YYYY-MM-DD', async () => {
    const store = makeStore([{ id: '1', deadlineID: null }]);
    const { updateDeadlineBatch } = createTaskUpdaters(store.setTasks);
    await updateDeadlineBatch(['1'], new Date(2026, 6, 17));
    expect(updateMock).toHaveBeenCalledExactlyOnceWith('1', { deadlineID: '2026-07-17' });
  });
});
