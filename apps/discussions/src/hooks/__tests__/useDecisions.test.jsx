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
