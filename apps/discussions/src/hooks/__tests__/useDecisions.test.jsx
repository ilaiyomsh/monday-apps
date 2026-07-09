import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock ONLY api(); keep the real parseValue/formatValue/cvSelection so the
// board_relation write shape assertion exercises the real serializer.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useDecisions, fetchDecisionsByDiscussion, linkTaskToPoint } from '../useDecisions.js';

beforeEach(() => {
  api.mockReset();
  // Reset to an UNMAPPED decisions board; individual tests override.
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, tasks: { id: '' }, topics: { id: '' }, decisions: { id: '' } },
    columns: { discussions: {}, tasks: {}, topics: {}, decisions: {} },
  });
});

describe('useDecisions — unmapped decisions board degrades gracefully', () => {
  it('fetchDecisionsByDiscussion returns [] and fires NO query when the board/relation is unmapped', async () => {
    const items = await fetchDecisionsByDiscussion('123');
    expect(items).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });

  it('createDecision returns null and fires NO mutation when the board is unmapped', async () => {
    const { result } = renderHook(() => useDecisions('123'));
    let created;
    await act(async () => {
      created = await result.current.createDecision('החלטה לדוגמה');
    });
    expect(created).toBeNull();
    expect(api).not.toHaveBeenCalled();
    // No optimistic leftover row either.
    expect(result.current.items).toEqual([]);
  });
});

describe('linkTaskToPoint — subitem board_relation write', () => {
  it('APPENDS the new id to the existing linked ids (deduped) on the subitems board', async () => {
    setActiveConfig({
      boards: { topics: { id: 'topics-board' } },
      columns: { topics: { pointTasksLinkID: { id: 'ptl1', type: 'board_relation' } } },
    });
    api.mockImplementation(async (query) => {
      if (query.includes('board { id }')) {
        return { items: [{ id: 'p1', board: { id: 'sub-board-9' } }] };
      }
      return { change_multiple_column_values: { id: 'p1' } };
    });

    await linkTaskToPoint('p1', '55', ['11', '55']);

    const mutCall = api.mock.calls.find(([q]) => q.includes('change_multiple_column_values'));
    expect(mutCall).toBeTruthy();
    const vars = mutCall[1];
    expect(String(vars.boardId)).toBe('sub-board-9'); // SUBITEMS board, not topics
    expect(String(vars.itemId)).toBe('p1');
    const cv = JSON.parse(vars.cv);
    // Real formatValue('board_relation') shape: { item_ids: [Number] } —
    // existing ids kept, new id appended once (55 deduped).
    expect(cv.ptl1.item_ids).toEqual([11, 55]);
  });

  it('no-ops with a warning (no api call) when the point link column is unmapped', async () => {
    await linkTaskToPoint('p1', '55', []);
    expect(api).not.toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// Regression (Round 16): creating a decision and IMMEDIATELY creating a second
// one used to DELETE the second decision. Root cause: the first create's
// fire-and-forget refresh() rebuilt the list and its merge DROPPED any temp row
// (`sid.startsWith('temp-')` was excluded). While two creates overlap, the
// second row is still an optimistic temp row when the first refresh runs, so it
// was removed — and the second create's reconcile (temp→real) then found no row
// to swap, so the freshly-created decision vanished from the UI (though it
// existed on the board). The fix KEEPS in-flight temp rows through refresh.
// ---------------------------------------------------------------------------
describe('useDecisions — two rapid creates both persist (no dropped second row)', () => {
  it('does not drop the still-optimistic second row on the first create refresh, then reconciles both', async () => {
    // Decisions board + the discussion's board_relation link column are mapped so
    // create fires AND refresh()'s relation read hits the (mocked) api; that read
    // returns an EMPTY relation — an eventually-consistent server that has not yet
    // surfaced the just-created decisions (exactly the window that caused the bug).
    setActiveConfig({
      boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
      columns: {
        discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
        decisions: {},
      },
    });

    let createSeq = 0;
    let linkedItemsQueries = 0;
    let releaseSecondCreate;
    const gate = new Promise((res) => { releaseSecondCreate = res; });
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) {
        createSeq += 1;
        if (createSeq === 1) return { create_item: { id: 'real-A' } };
        await gate; // hold the 2nd create until the 1st has fully refreshed
        return { create_item: { id: 'real-B' } };
      }
      if (query.includes('change_multiple_column_values')) {
        return { change_multiple_column_values: { id: 'ok' } };
      }
      if (query.includes('linked_items')) {
        linkedItemsQueries += 1;
        return { items: [{ column_values: [{ linked_items: [] }] }] }; // server hasn't caught up
      }
      return {};
    });

    const { result } = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false)); // initial fetch = 1st relation read

    // Fire both creates back-to-back (rapid entry). The 2nd create_item is gated.
    await act(async () => {
      result.current.createDecision('החלטה ראשונה');
      result.current.createDecision('החלטה שנייה');
    });

    // Wait until the 1st create's refresh has actually run (2nd relation read)
    // WHILE the 2nd create is still gated (its row still a temp row).
    await waitFor(() => expect(linkedItemsQueries).toBeGreaterThanOrEqual(2));

    // The still-temp second row MUST survive the first create's refresh (the bug
    // dropped it here → the list would collapse to just real-A).
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.some((i) => i.id === 'real-A')).toBe(true);
    expect(result.current.items.some((i) => String(i.id).startsWith('temp-'))).toBe(true);

    // Release the 2nd create → it reconciles to its OWN real id; BOTH persist.
    await act(async () => { releaseSecondCreate(); await gate; });
    await waitFor(() => {
      const ids = result.current.items.map((i) => String(i.id)).sort();
      expect(ids).toEqual(['real-A', 'real-B']);
    });
  });
});


// ---------------------------------------------------------------------------
// Round 18: THREE rapid decision creates must ALL persist even though every
// refresh's (eventually-consistent) relation read comes back empty. Exercises
// the shared multi-row merge + protect-before-flush: each create protects its
// real id the instant it's known, so a concurrent create's refresh can never
// evict a just-reconciled row.
// ---------------------------------------------------------------------------
describe('useDecisions — three rapid creates all persist (multi-row safe)', () => {
  it('reconciles all three to their own real ids, none dropped by an overlapping refresh', async () => {
    setActiveConfig({
      boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
      columns: {
        discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
        decisions: {},
      },
    });
    let createSeq = 0;
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) { createSeq += 1; return { create_item: { id: `real-${createSeq}` } }; }
      if (query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'ok' } };
      if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] }; // server lagging
      return {};
    });

    const { result } = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const p1 = result.current.createDecision('החלטה 1');
      const p2 = result.current.createDecision('החלטה 2');
      const p3 = result.current.createDecision('החלטה 3');
      await Promise.all([p1, p2, p3]);
    });

    await waitFor(() => {
      const ids = result.current.items.map((i) => String(i.id)).sort();
      expect(ids).toEqual(['real-1', 'real-2', 'real-3']);
    });
  });
});


// ---------------------------------------------------------------------------
// Round 18: a decision create whose network call REJECTS must keep the row in a
// retryable error state and never surface as an unhandled rejection (the "אירעה
// שגיאה לא צפויה" UNKNOWN_ERROR popup the reporter saw only in Decisions).
// ---------------------------------------------------------------------------
describe('useDecisions — a failed create shows retry, never an unhandled rejection', () => {
  it('resolves to null, flags the temp row _createFailed, raises no unhandledrejection', async () => {
    setActiveConfig({
      boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
      columns: {
        discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
        decisions: {},
      },
    });
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) throw new Error('network boom'); // no monday/graphql text
      if (query.includes('linked_items')) return { items: [{ column_values: [{ linked_items: [] }] }] };
      return {};
    });
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    try {
      const { result } = renderHook(() => useDecisions('disc-1'));
      await waitFor(() => expect(result.current.loading).toBe(false));

      let created;
      await act(async () => { created = await result.current.createDecision('החלטה שנכשלת'); });
      expect(created).toBeNull();

      const row = result.current.items.find((i) => i.name === 'החלטה שנכשלת');
      expect(row).toBeTruthy();
      expect(String(row.id).startsWith('temp-')).toBe(true); // stays temp so retry can re-run it
      expect(row._createFailed).toBe(true);

      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandled);
    }
  });
});



// ---------------------------------------------------------------------------
// Round 19 (BUG): created decisions vanished after leaving + re-entering a
// discussion. Root cause: the create wrote only the DECISION side of the link
// (decisions.discussionLinkID), relying on a reflection into the DISCUSSION side
// (discussions.decisionsBoardLinkID) — the column the reload READS. But the
// decisions board is mapped MANUALLY (not wizard-provisioned with a reflection
// column), so that never populated and the reload found nothing. The fix writes
// discussions.decisionsBoardLinkID explicitly. This test proves the full cycle:
// create writes that column, and a FRESH mount (remount = re-entering) reloads
// the decision from it.
// ---------------------------------------------------------------------------
describe('useDecisions — a created decision persists its discussion link and reloads (remount-safe)', () => {
  it('writes discussions.decisionsBoardLinkID on create so a remount brings the decision back', async () => {
    setActiveConfig({
      boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
      columns: {
        discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
        decisions: {},
      },
    });

    // Tiny stateful fake: the discussion-side link column is the source of truth
    // the fetch reads — exactly what the reload depends on. Only the discussion-
    // side write (disc-board + disc_link) mutates it; the decision-side write
    // (dec-board, empty cv) is a no-op here, mirroring the manual-map reality.
    let serverLinked = [];
    api.mockImplementation(async (query, vars) => {
      if (query.includes('create_item')) return { create_item: { id: '9001' } };
      if (query.includes('change_multiple_column_values')) {
        if (String(vars.boardId) === 'disc-board' && vars.cv?.includes('disc_link')) {
          const ids = JSON.parse(vars.cv).disc_link.item_ids || [];
          serverLinked = ids.map((id) => ({ id: String(id), name: 'החלטה חשובה' }));
        }
        return { change_multiple_column_values: { id: 'ok' } };
      }
      if (query.includes('linked_items')) {
        return { items: [{ column_values: [{ linked_items: serverLinked }] }] };
      }
      return {};
    });

    // 1) First mount — no decisions yet.
    const first = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.items).toHaveLength(0);

    // 2) Create a decision → the DISCUSSION-side link column gets the new id.
    await act(async () => { await first.result.current.createDecision('החלטה חשובה'); });
    const linkWrite = api.mock.calls.find(([q, v]) =>
      q.includes('change_multiple_column_values')
      && String(v.boardId) === 'disc-board'
      && v.cv?.includes('disc_link'));
    expect(linkWrite).toBeTruthy();
    expect(JSON.parse(linkWrite[1].cv).disc_link.item_ids).toContain(9001);

    // 3) LEAVE + RE-ENTER: a brand-new hook instance (fresh mount) must reload
    //    the decision from the server (it would be EMPTY before the fix).
    first.unmount();
    const second = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.items.map((i) => String(i.id))).toContain('9001');
  });
});
