import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock ONLY api(); keep the real parseValue/formatValue/cvSelection so the
// board_relation write shape assertion exercises the real serializer AND the
// BoardSDK item read (mapItem/parseValue) runs for real over the mocked responses.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useDecisions, fetchDecisionsByDiscussion, linkTaskToPoint, _resetDecisionsScanCache } from '../useDecisions.js';

beforeEach(() => {
  api.mockReset();
  // round135 — the hook now carries a module-level session cache of the
  // per-discussion scan (a re-open within 60s serves cached rows instead of
  // re-scanning the board). Reset it per test so every mount here exercises
  // the real fetch path, as these tests assert.
  _resetDecisionsScanCache();
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
// The decisions board is mapped MANUALLY in Settings, so decisions are linked to
// a discussion ONLY on the DECISION side (decisions.discussionLinkID). The
// reload therefore READS the decisions board (items_page) and filters by that
// link — NOT the (empty) discussions.decisionsBoardLinkID relation. Shared,
// mapped config for the create/reload tests below:
// ---------------------------------------------------------------------------
const MAPPED_CFG = {
  boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
  columns: {
    // Discussion-side relation is mapped but stays EMPTY — kept only for the
    // create's best-effort mirror write; the reload does NOT read it.
    discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
    decisions: { discussionLinkID: { id: 'dec_disc_link', type: 'board_relation' } },
  },
};
// An empty decisions board page — models an eventually-consistent server that
// has not yet surfaced a just-created decision (the window the create tests hit).
const EMPTY_DECISIONS_PAGE = { boards: [{ items_page: { cursor: null, items: [] } }] };

// ---------------------------------------------------------------------------
// Regression (Round 16): creating a decision and IMMEDIATELY creating a second
// one used to DELETE the second decision. Root cause: the first create's
// fire-and-forget refresh() rebuilt the list and its merge DROPPED any temp row.
// While two creates overlap, the second row is still an optimistic temp row when
// the first refresh runs, so it was removed — and the second create's reconcile
// then found no row to swap, so the freshly-created decision vanished. The fix
// KEEPS in-flight temp rows through refresh. The reload now reads the DECISIONS
// board (items_page); an EMPTY page models the eventually-consistent window that
// must NOT drop the still-optimistic row.
// ---------------------------------------------------------------------------
describe('useDecisions — two rapid creates both persist (no dropped second row)', () => {
  it('does not drop the still-optimistic second row on the first create refresh, then reconciles both', async () => {
    setActiveConfig(MAPPED_CFG);

    let createSeq = 0;
    let fetchQueries = 0;
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
      if (query.includes('items_page')) {
        fetchQueries += 1;
        return EMPTY_DECISIONS_PAGE; // decisions board hasn't surfaced them yet
      }
      return {};
    });

    const { result } = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false)); // initial fetch = 1st board read

    // Fire both creates back-to-back (rapid entry). The 2nd create_item is gated.
    await act(async () => {
      result.current.createDecision('החלטה ראשונה');
      result.current.createDecision('החלטה שנייה');
    });

    // Wait until the 1st create's refresh has actually run (2nd board read)
    // WHILE the 2nd create is still gated (its row still a temp row).
    await waitFor(() => expect(fetchQueries).toBeGreaterThanOrEqual(2));

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
// refresh's (eventually-consistent) decisions-board read comes back empty.
// Exercises the shared multi-row merge + protect-before-flush: each create
// protects its real id the instant it's known, so a concurrent create's refresh
// can never evict a just-reconciled row.
// ---------------------------------------------------------------------------
describe('useDecisions — three rapid creates all persist (multi-row safe)', () => {
  it('reconciles all three to their own real ids, none dropped by an overlapping refresh', async () => {
    setActiveConfig(MAPPED_CFG);
    let createSeq = 0;
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) { createSeq += 1; return { create_item: { id: `real-${createSeq}` } }; }
      if (query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'ok' } };
      if (query.includes('items_page')) return EMPTY_DECISIONS_PAGE; // server lagging
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
    setActiveConfig(MAPPED_CFG);
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) throw new Error('network boom'); // no monday/graphql text
      if (query.includes('items_page')) return EMPTY_DECISIONS_PAGE;
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
// Round 20 (REAL FIX): decisions are linked to their discussion ONLY on the
// DECISION side (decisions.discussionLinkID); the discussion side
// (discussions.decisionsBoardLinkID) stays EMPTY because the decisions board is
// mapped MANUALLY (no bidirectional reflection). So the reload READS the
// decisions board and filters by the decision-side link. These prove the load
// returns the decisions linked (decision-side) to the discussion, EXCLUDES
// decisions linked to a DIFFERENT discussion, and reloads on a fresh mount.
// ---------------------------------------------------------------------------
describe('useDecisions — loads decisions by the DECISION-side link (Round 20 fix)', () => {
  const cfg = {
    boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
    columns: {
      discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
      decisions: {
        discussionLinkID: { id: 'dec_disc_link', type: 'board_relation' },
        decisionStatusID: { id: 'dec_status', type: 'status' },
      },
    },
  };

  // A decisions board with three decisions: 501 & 502 linked (decision-side) to
  // disc-1, and 777 linked to a DIFFERENT discussion (disc-2). The discussion
  // side is never consulted.
  function mockDecisionsBoard() {
    const rel = (discId) => ({ id: 'dec_disc_link', linked_item_ids: [discId], linked_items: [{ id: discId, name: 'דיון' }] });
    api.mockImplementation(async (query) => {
      if (query.includes('items_page')) {
        return { boards: [{ items_page: { cursor: null, items: [
          { id: '501', name: 'החלטה א', created_at: '2026-07-01T00:00:00Z', column_values: [rel('disc-1'), { id: 'dec_status', text: 'פתוח', index: 0 }] },
          { id: '502', name: 'החלטה ב', created_at: '2026-07-02T00:00:00Z', column_values: [rel('disc-1'), { id: 'dec_status', text: 'סגור', index: 2 }] },
          { id: '777', name: 'החלטה של דיון אחר', created_at: '2026-07-03T00:00:00Z', column_values: [rel('disc-2')] },
        ] } }] };
      }
      return {};
    });
  }

  it('fetchDecisionsByDiscussion returns only decisions linked (decision-side) to the discussion, excluding others', async () => {
    setActiveConfig(cfg);
    mockDecisionsBoard();
    const items = await fetchDecisionsByDiscussion('disc-1');
    expect(items.map((i) => String(i.id)).sort()).toEqual(['501', '502']); // 777 (disc-2) excluded
    // Reads the DECISIONS board (items_page), not the discussion-side relation.
    expect(api.mock.calls.some(([q]) => q.includes('items_page'))).toBe(true);
    // Deserialized shape unchanged: name + alias fields present.
    const a = items.find((i) => String(i.id) === '501');
    expect(a.name).toBe('החלטה א');
    expect(a.decisionStatusID).toBe(0);
    expect(a.discussionLinkID.ids).toContain('disc-1');
  });

  it('a fresh mount (re-entering the discussion) reloads those decisions', async () => {
    setActiveConfig(cfg);
    mockDecisionsBoard();
    const { result } = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => String(i.id)).sort()).toEqual(['501', '502']);
  });

  it('round135 — a re-mount within the freshness window serves the session cache with NO re-scan', async () => {
    setActiveConfig(cfg);
    mockDecisionsBoard();
    const first = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const scansAfterFirst = api.mock.calls.filter(([q]) => q.includes('items_page')).length;
    first.unmount();
    const second = renderHook(() => useDecisions('disc-1'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.items.map((i) => String(i.id)).sort()).toEqual(['501', '502']);
    expect(api.mock.calls.filter(([q]) => q.includes('items_page')).length).toBe(scansAfterFirst);
  });

  it('round135 — enabled:false stays DORMANT (no board scan) until armed', async () => {
    setActiveConfig(cfg);
    mockDecisionsBoard();
    const { result, rerender } = renderHook(
      ({ en }) => useDecisions('disc-1', { enabled: en }),
      { initialProps: { en: false } }
    );
    expect(api).not.toHaveBeenCalled();
    rerender({ en: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => String(i.id)).sort()).toEqual(['501', '502']);
  });

  it('returns [] and fires NO query when the decision-side link column is unmapped', async () => {
    setActiveConfig({
      boards: { decisions: { id: 'dec-board' } },
      columns: { decisions: {} }, // discussionLinkID NOT mapped
    });
    const items = await fetchDecisionsByDiscussion('disc-1');
    expect(items).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Round 20 (full cycle): a created decision must reload after leaving +
// re-entering, driven by the DECISION-side link. create writes
// decisions.discussionLinkID (the reload's source of truth); a FRESH mount
// re-reads the decisions board and brings the decision back. The DISCUSSION-side
// write is accepted but IGNORED by the fake — mirroring the manual-map reality —
// proving the reload no longer depends on it. (Supersedes the Round 19 test that
// relied on the discussion-side column.)
// ---------------------------------------------------------------------------
describe('useDecisions — a created decision reloads via the DECISION-side link (remount-safe)', () => {
  it('create writes decisions.discussionLinkID; a remount reloads it from the decisions board', async () => {
    setActiveConfig({
      boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
      columns: {
        discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
        decisions: { discussionLinkID: { id: 'dec_disc_link', type: 'board_relation' } },
      },
    });

    // Stateful fake decisions board. create_item adds a decision with NO link;
    // the DECISION-side write (change_multiple_column_values on dec-board, the
    // dec_disc_link column) records which discussion it links to. The reload
    // reads this board via items_page and filters by dec_disc_link. BoardSDK.update
    // sends the JSON under `cols`; the discussion-side write (linkDecisionsToDiscussion)
    // uses `cv` on disc-board and is deliberately IGNORED here.
    const board = new Map(); // decision id -> { id, name, linkedDiscussionIds }
    api.mockImplementation(async (query, vars) => {
      if (query.includes('create_item')) {
        board.set('9001', { id: '9001', name: 'החלטה חשובה', linkedDiscussionIds: [] });
        return { create_item: { id: '9001' } };
      }
      if (query.includes('change_multiple_column_values')) {
        if (String(vars.boardId) === 'dec-board' && vars.cols?.includes('dec_disc_link')) {
          const ids = JSON.parse(vars.cols).dec_disc_link.item_ids || [];
          const row = board.get('9001');
          if (row) row.linkedDiscussionIds = ids.map(String);
        }
        return { change_multiple_column_values: { id: 'ok' } };
      }
      if (query.includes('items_page')) {
        const items = [...board.values()].map((r) => ({
          id: r.id, name: r.name, created_at: '2026-07-08T00:00:00Z',
          column_values: [{
            id: 'dec_disc_link',
            linked_item_ids: r.linkedDiscussionIds,
            linked_items: r.linkedDiscussionIds.map((id) => ({ id, name: 'דיון' })),
          }],
        }));
        return { boards: [{ items_page: { cursor: null, items } }] };
      }
      return {};
    });

    // 1) First mount — no decisions yet.
    const first = renderHook(() => useDecisions('4001'));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.items).toHaveLength(0);

    // 2) Create a decision → the DECISION-side link column records disc 4001.
    await act(async () => { await first.result.current.createDecision('החלטה חשובה'); });
    const decWrite = api.mock.calls.find(([q, v]) =>
      q.includes('change_multiple_column_values')
      && String(v.boardId) === 'dec-board'
      && v.cols?.includes('dec_disc_link'));
    expect(decWrite).toBeTruthy();
    expect(JSON.parse(decWrite[1].cols).dec_disc_link.item_ids).toContain(4001);

    // 3) LEAVE + RE-ENTER: a brand-new hook instance (fresh mount) must reload
    //    the decision from the DECISIONS board (it would be EMPTY before the fix).
    first.unmount();
    const second = renderHook(() => useDecisions('4001'));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.items.map((i) => String(i.id))).toContain('9001');
  });

  it('createDecision fires NO write against the DISCUSSIONS board (the reflection mirror was removed — 2026-07-14 incident)', async () => {
    // discussions.decisionsBoardLinkID is monday's REFLECTION of the decision-side
    // link: it auto-fills and REJECTS direct writes ("Graphql validation errors"
    // toast on every create). Even with the column mapped, the hook must not
    // touch the discussions board on create.
    setActiveConfig({
      boards: { discussions: { id: 'disc-board' }, decisions: { id: 'dec-board' } },
      columns: {
        discussions: { decisionsBoardLinkID: { id: 'disc_link', type: 'board_relation' } },
        decisions: { discussionLinkID: { id: 'dec_disc_link', type: 'board_relation' } },
      },
    });
    api.mockImplementation(async (query) => {
      if (query.includes('create_item')) return { create_item: { id: '9002' } };
      if (query.includes('change_multiple_column_values')) return { change_multiple_column_values: { id: 'ok' } };
      if (query.includes('items_page')) return { boards: [{ items_page: { cursor: null, items: [] } }] };
      return {};
    });

    const { result } = renderHook(() => useDecisions('4001'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.createDecision('החלטה'); });

    // The decision-side link write DID run...
    expect(api.mock.calls.some(([q, v]) =>
      q.includes('change_multiple_column_values') && String(v.boardId) === 'dec-board')).toBe(true);
    // ...and NOTHING was written to the discussions board.
    const discussionSideWrite = api.mock.calls.find(([q, v]) =>
      q.includes('change_multiple_column_values') && String(v.boardId) === 'disc-board');
    expect(discussionSideWrite).toBeUndefined();
  });
});
