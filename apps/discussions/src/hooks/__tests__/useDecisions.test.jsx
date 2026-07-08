import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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
