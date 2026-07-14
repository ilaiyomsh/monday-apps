import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- Mocks (mirrors useMyTasks.test.jsx harness) -----------------------------
// Decisions board + BOTH people columns mapped; decisionDateID/decisionCreatorID
// deliberately unmapped so the mount fetch is a SINGLE full query (no staged
// phase-1, no creator-fallback second query).
vi.mock('../../utils/mondayApi/board-config-store.js', () => ({
  getBoardId: vi.fn(() => 'DECBOARD'),
  getColumns: vi.fn(() => ({
    deciderID: { id: 'decider_col', type: 'people' },
    affectedID: { id: 'affected_col', type: 'people' },
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Capture the fluent BoardSDK calls so we can drive results + assert writes.
const sdkState = {
  execute: vi.fn(),
  updatePayloads: [],
  updateExecute: vi.fn(async () => ({ id: 'X' })),
};

vi.mock('@api/BoardSDK.js', () => {
  class FakeBoard {
    items() {
      const b = {
        withColumns: () => b,
        withPagination: () => b,
        where: () => b,
        orderBy: () => b,
        withGroup: () => b,
        execute: (...a) => sdkState.execute(...a),
      };
      return b;
    }
    item(id) {
      return {
        update: (payload) => {
          sdkState.updatePayloads.push({ id, payload });
          return { execute: sdkState.updateExecute };
        },
      };
    }
  }
  return { החלטות1Board: FakeBoard };
});

vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({})),
}));

import { useMyDecisions } from '../useMyDecisions.js';
import logger from '../../utils/logger.js';

const decision = (id, over = {}) => ({
  id: String(id), name: `d${id}`, deciderID: [], affectedID: [], ...over,
});

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* isolate the view cache */ }
  sdkState.execute.mockReset();
  sdkState.updatePayloads.length = 0;
  sdkState.updateExecute = vi.fn(async () => ({ id: 'X' }));
  logger.error.mockClear();
});

const mountLoaded = async (items) => {
  sdkState.execute.mockResolvedValue({ items, cursor: null });
  const hook = renderHook(() => useMyDecisions('decider', { currentUser: { id: '55' } }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.items.length).toBe(items.length));
  return hook;
};

// round 74 — the "ההחלטות שלי" people cells (מחליט / מושפעים) became editable;
// these characterize the hook's optimistic write path (same contract as the
// status/priority/date editors: optimistic row swap, numeric-ids write through
// the alias, snapshot revert on error).
describe('useMyDecisions — inline people edits (מחליט / מושפעים)', () => {
  it('updateDecisionDecider: optimistic row update + NUMERIC user-ids write to the deciderID alias', async () => {
    const { result } = await mountLoaded([decision(1), decision(2)]);
    const people = [{ id: '123', name: 'דנה' }];
    await act(async () => { await result.current.updateDecisionDecider('2', people); });
    // only the edited row swaps, and it keeps the PersonPicker object shape
    expect(result.current.items.find((d) => d.id === '2').deciderID).toEqual(people);
    expect(result.current.items.find((d) => d.id === '1').deciderID).toEqual([]);
    // the write goes to the DECIDER alias with numeric ids (verified people format)
    expect(sdkState.updatePayloads).toEqual([{ id: '2', payload: { deciderID: [123] } }]);
  });

  it('updateDecisionAffected: writes the affectedID alias and REVERTS the optimistic edit on error', async () => {
    const before = [{ id: '9', name: 'קודם' }];
    const { result } = await mountLoaded([decision(1, { affectedID: before })]);
    sdkState.updateExecute = vi.fn(async () => { throw new Error('boom'); });
    await act(async () => {
      await result.current.updateDecisionAffected('1', [{ id: '3' }, { id: '4' }]);
    });
    expect(sdkState.updatePayloads).toEqual([{ id: '1', payload: { affectedID: [3, 4] } }]);
    // failed write → the row is restored to the pre-edit snapshot, and the
    // failure is logged (error-guard: never a silent catch).
    expect(result.current.items[0].affectedID).toEqual(before);
    expect(logger.error).toHaveBeenCalled();
  });

  it('a non-array people value CLEARS the column (empty people write)', async () => {
    const { result } = await mountLoaded([decision(1, { deciderID: [{ id: '9' }] })]);
    await act(async () => { await result.current.updateDecisionDecider('1', null); });
    expect(result.current.items[0].deciderID).toEqual([]);
    expect(sdkState.updatePayloads).toEqual([{ id: '1', payload: { deciderID: [] } }]);
  });
});
