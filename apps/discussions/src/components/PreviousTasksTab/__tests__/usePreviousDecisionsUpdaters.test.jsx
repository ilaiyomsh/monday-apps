import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
 * round279 — the inline-edit updaters usePreviousDecisions exposes so the
 * previous-discussions decisions table (MyDecisionsTable) is editable. Each
 * updater must: (1) optimistically patch the local decision, (2) write to the
 * decisions board with the right column payload, and (3) roll the local state
 * back when the write fails. These three are exactly what the table relies on.
 */

const state = vi.hoisted(() => ({
  lastUpdate: null,        // { id, payload } of the most recent board write
  updateShouldThrow: false,
  fetchItems: [],
  subscribed: [],
}));

vi.mock('@api/BoardSDK.js', () => {
  class החלטות1Board {
    items() { return this; }
    withPagination() { return this; }
    withColumns() { return this; }
    async execute() { return { items: state.fetchItems, cursor: null }; }
    item(id) {
      return {
        update: (payload) => {
          state.lastUpdate = { id, payload };
          return { execute: async () => { if (state.updateShouldThrow) throw new Error('boom'); return {}; } };
        },
      };
    }
  }
  class דיונים1Board {
    items() { return this; }
    withColumns() { return this; }
    withPagination() { return this; }
    async execute() { return { items: [], cursor: null }; }
  }
  return { החלטות1Board, דיונים1Board };
});

// resolveSourceIds (linked mode) reads the current discussion's previous link.
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ items: [{ column_values: [{ type: 'board_relation' }] }] })),
  parseValue: vi.fn(() => ({ linkedItems: [{ id: '99' }], ids: ['99'] })),
  cvSelection: () => '',
}));

vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: (board) => (board === 'discussions' ? { previousDiscussionID: { id: 'prev_col' } } : {}),
  getBoardId: () => 555,
}));

vi.mock('../../../utils/mondayApi/subscribers.js', () => ({
  ensureSubscribers: vi.fn(async (_boardId, ids) => { state.subscribed = ids; }),
}));

vi.mock('@generated/utils/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));

import { usePreviousDecisions } from '../usePreviousDecisions.js';

const DISCUSSION = { id: '1', discussionTypeID: null };

async function renderLoaded() {
  const hook = renderHook(() => usePreviousDecisions(DISCUSSION, { byType: false, scope: 'last', enabled: true }));
  await waitFor(() => expect(hook.result.current.decisions.length).toBe(1));
  return hook;
}

beforeEach(() => {
  state.lastUpdate = null;
  state.updateShouldThrow = false;
  state.subscribed = [];
  state.fetchItems = [{
    id: '10', name: 'החלטה א', discussionLinkID: { ids: ['99'] },
    decisionStatusID: null, decisionPriorityID: null, decisionTrackingID: null,
    decisionDateID: null, deciderID: [], affectedID: [],
  }];
});

describe('usePreviousDecisions updaters (round279)', () => {
  it('updateDecisionStatus optimistically patches state and writes the status payload', async () => {
    const { result } = await renderLoaded();
    await act(async () => { await result.current.updateDecisionStatus('10', 'st-3'); });
    expect(result.current.decisions[0].decisionStatusID).toBe('st-3');
    expect(state.lastUpdate).toEqual({ id: '10', payload: { decisionStatusID: 'st-3' } });
  });

  it('updateDecisionDate writes yyyy-mm-dd, and null clears the column', async () => {
    const { result } = await renderLoaded();
    await act(async () => { await result.current.updateDecisionDate('10', new Date(2026, 6, 24)); });
    expect(state.lastUpdate.payload).toEqual({ decisionDateID: '2026-07-24' });
    await act(async () => { await result.current.updateDecisionDate('10', null); });
    expect(state.lastUpdate.payload).toEqual({ decisionDateID: null });
  });

  it('updateDecisionDecider pre-subscribes the people and writes numeric ids', async () => {
    const { result } = await renderLoaded();
    await act(async () => { await result.current.updateDecisionDecider('10', [{ id: '42', name: 'דנה' }]); });
    expect(state.subscribed).toEqual([42]);
    expect(state.lastUpdate).toEqual({ id: '10', payload: { deciderID: [42] } });
    expect(result.current.decisions[0].deciderID).toEqual([{ id: '42', name: 'דנה' }]);
  });

  it('reverts the optimistic patch when the board write throws', async () => {
    const { result } = await renderLoaded();
    state.updateShouldThrow = true;
    await act(async () => { await result.current.updateDecisionTracking('10', 'tr-9'); });
    // optimistic value rolled back to the original (null)
    expect(result.current.decisions[0].decisionTrackingID).toBe(null);
  });
});
