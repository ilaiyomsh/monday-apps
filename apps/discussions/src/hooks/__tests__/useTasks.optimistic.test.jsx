import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock ONLY api(); keep the real parseValue/formatValue/cvSelection so the
// create + relation write shapes exercise the real serializers (BoardSDK calls
// the SAME mocked api()).
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useTasks } from '../useTasks.js';

// Tasks board + the discussion's tasks board_relation link column are mapped so
// create fires AND refresh()'s relation read hits the mocked api.
beforeEach(() => {
  api.mockReset();
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, tasks: { id: 'tasks-board' } },
    columns: {
      discussions: { tasksBoardLinkID: { id: 'disc_tasks_link', type: 'board_relation' } },
      tasks: {
        statusID: { id: 'status_col', type: 'status' },
        discussionLinkID: { id: 'task_disc_link', type: 'board_relation' },
      },
    },
  });
});

// A server whose eventually-consistent relation read has NOT yet surfaced the
// just-created tasks (returns an empty relation) — exactly the window in which
// the old refresh()=setItems(server) REPLACE dropped in-flight / just-created
// rows. Create/update mutations succeed.
function mockLaggingServer() {
  let createSeq = 0;
  api.mockImplementation(async (query) => {
    if (query.includes('create_item')) { createSeq += 1; return { create_item: { id: `real-${createSeq}` } }; }
    if (query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'ok' } };
    if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
    return {};
  });
}

// ---------------------------------------------------------------------------
// (a) THREE rapid creates then an immediate status edit on each. The reported
// bug: creating ~3 tasks fast and then setting their status made the first two
// disappear (and sometimes one reappear). Root cause: useTasks.refresh() did
// setItems(fetchedItems) — a REPLACE — so an early create's fire-and-forget
// refresh overwrote the list with a server snapshot that still lacked the other
// in-flight rows; their later reconciles found no temp row to swap. The fix
// MERGES (mergeServerList), preserving every in-flight temp row and every
// just-created protected row. All three must persist, in order, no vanish.
// ---------------------------------------------------------------------------
describe('useTasks — 3 rapid creates + status edits all persist (no vanish/reappear)', () => {
  it('keeps all three rows through the overlapping refreshes and the status edits', async () => {
    mockLaggingServer();
    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const p1 = result.current.createTask('t1');
      const p2 = result.current.createTask('t2');
      const p3 = result.current.createTask('t3');
      await Promise.all([p1, p2, p3]);
    });

    // All three reconciled to their OWN real ids, in creation order — even though
    // every refresh's relation read came back empty.
    await waitFor(() => {
      expect(result.current.items.map((i) => String(i.id))).toEqual(['real-1', 'real-2', 'real-3']);
    });
    expect(result.current.items.map((i) => i.name)).toEqual(['t1', 't2', 't3']);

    // Now set a status on each real row (the second half of the reported repro).
    await act(async () => {
      await result.current.updateTaskStatus('real-1', 1);
      await result.current.updateTaskStatus('real-2', 2);
      await result.current.updateTaskStatus('real-3', 1);
    });

    // Nothing vanished; the statuses stuck.
    await waitFor(() => {
      expect(result.current.items.map((i) => String(i.id))).toEqual(['real-1', 'real-2', 'real-3']);
    });
    expect(result.current.items.find((i) => i.id === 'real-1').statusID).toBe(1);
    expect(result.current.items.find((i) => i.id === 'real-2').statusID).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (b) A create whose network call REJECTS must keep the row in a retryable
// error state and NEVER surface as an unhandled rejection (which the global
// error handler would show as the "unexpected error" UNKNOWN_ERROR popup).
// ---------------------------------------------------------------------------
describe('useTasks — a failed create shows retry, never an unhandled rejection', () => {
  it('resolves to null, flags the temp row _createFailed, and raises no unhandledrejection', async () => {
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) throw new Error('network boom'); // no monday/graphql text
      if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
      return {};
    });
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    try {
      const { result } = renderHook(() => useTasks('disc-1'));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Fire it FLOATING (as the inline add-row commit() does — no await) then
      // also capture the returned promise to assert it resolves (never rejects).
      let created;
      await act(async () => {
        const p = result.current.createTask('bad');
        created = await p; // must resolve, not throw
      });
      expect(created).toBeNull();

      const row = result.current.items.find((i) => i.name === 'bad');
      expect(row).toBeTruthy();
      expect(String(row.id).startsWith('temp-')).toBe(true); // stays temp so retry can re-run it
      expect(row._createFailed).toBe(true);

      // Let any microtasks settle; no unhandled rejection should have fired.
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandled);
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Overlapping create + refresh: a refresh that runs WHILE a create is still
// in flight (its row still a temp row) must NOT drop that row. This is the exact
// shape the REPLACE bug got wrong.
// ---------------------------------------------------------------------------
describe('useTasks — a refresh during an in-flight create keeps the temp row', () => {
  it('preserves the still-optimistic row through a concurrent refresh, then reconciles it', async () => {
    let releaseCreate;
    const gate = new Promise((res) => { releaseCreate = res; });
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) { await gate; return { create_item: { id: 'real-1' } }; }
      if (query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'ok' } };
      if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
      return {};
    });

    const { result } = renderHook(() => useTasks('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let createP;
    act(() => { createP = result.current.createTask('t1'); }); // temp row appears; create_item gated
    expect(result.current.items.some((i) => String(i.id).startsWith('temp-'))).toBe(true);

    // A concurrent refresh whose relation read is still empty. The old REPLACE
    // would set items to [] here and the row would be lost.
    await act(async () => { await result.current.refresh(); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items.some((i) => String(i.id).startsWith('temp-'))).toBe(true);

    // Release the create → it reconciles to its real id; the row persists.
    await act(async () => { releaseCreate(); await createP; });
    await waitFor(() => expect(result.current.items.map((i) => String(i.id))).toEqual(['real-1']));
  });
});
