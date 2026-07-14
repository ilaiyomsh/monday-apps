import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round-75 audit fixes for useTopics:
//   R1 — fetchTopics has a request-supersede guard, so a slow response for a
//        previous discussion can't render its topics under a newer discussion.
//   R2 — a topic create whose order-save fails must NOT re-run create_item on
//        retry (that duplicates the topic); it resumes from the order save.
// Mocks api() + the storage utils so the real hook logic runs.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../utils/mondayApi/monday-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api };
});
const { loadOrder, saveTopicOrder } = vi.hoisted(() => ({
  loadOrder: vi.fn(async () => ({ topics: [], points: {} })),
  saveTopicOrder: vi.fn(async () => {}),
}));
vi.mock('../../utils/topicOrder.js', () => ({
  loadOrder,
  saveTopicOrder,
  savePointOrder: vi.fn(async () => {}),
  applyOrder: (items) => items, // identity — keep API order for the assertions
}));
vi.mock('../../utils/discussedStore.js', () => ({
  loadDiscussedPointIds: vi.fn(async () => new Set()),
  saveDiscussedPointIds: vi.fn(async () => {}),
}));
vi.mock('../../contexts/MondayContext.jsx', () => ({
  useMondayContext: () => ({ currentUser: { id: '7' } }),
}));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { useTopics } from '../useTopics.js';

// One linked topic named by discussion, so we can tell whose response rendered.
const topicsResponse = (label) => ({
  items: [{ column_values: [{ linked_items: [
    { id: `${label}-t1`, name: `topic-${label}`, column_values: [], subitems: [] },
  ] }] }],
});

function configure() {
  setActiveConfig({
    boards: { discussions: { id: 'disc-board' }, topics: { id: 'topics-board' } },
    columns: {
      discussions: { topicsBoardLinkID: { id: 'disc_topics_link', type: 'board_relation' } },
      topics: { discussionLinkID: { id: 'topic_disc_link', type: 'board_relation' } },
    },
  });
}

beforeEach(() => {
  api.mockReset();
  loadOrder.mockClear();
  saveTopicOrder.mockReset();
  saveTopicOrder.mockResolvedValue();
  configure();
});

describe('useTopics — R1: request-supersede guard', () => {
  it('a slow previous-discussion response does NOT overwrite the current one', async () => {
    // Defer discussion A's read; resolve B immediately. A resolves LAST (stale).
    let resolveA;
    api.mockImplementation((query, vars) => {
      if (!query.includes('linked_items')) return Promise.resolve({});
      if (vars.discussionId === 'A') return new Promise((res) => { resolveA = () => res(topicsResponse('A')); });
      return Promise.resolve(topicsResponse('B'));
    });

    const { result, rerender } = renderHook(({ id }) => useTopics(id), { initialProps: { id: 'A' } });
    // Switch to B before A resolves; B resolves and renders.
    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.items.map((t) => t.name)).toEqual(['topic-B']));

    // Now let the STALE A response land — it must be ignored (still B).
    await act(async () => { resolveA(); await Promise.resolve(); });
    expect(result.current.items.map((t) => t.name)).toEqual(['topic-B']);
  });
});

describe('useTopics — R2: retry after a failed order-save does not duplicate the topic', () => {
  it('create_item runs ONCE across create + retry when saveTopicOrder fails first', async () => {
    let createCount = 0;
    api.mockImplementation(async (query) => {
      if (query.includes('linked_items')) return topicsResponse('X');
      if (query.includes('create_item')) { createCount += 1; return { create_item: { id: `real-${createCount}` } }; }
      return {};
    });
    // First order-save throws → the create is flagged failed AFTER the item exists.
    saveTopicOrder.mockRejectedValueOnce(new Error('order save failed'));

    const { result } = renderHook(() => useTopics('X'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.addTopic('נושא'); });
    await waitFor(() => expect(result.current.items.some((t) => t._createFailed)).toBe(true));
    expect(createCount).toBe(1);

    const failed = result.current.items.find((t) => t._createFailed);
    await act(async () => { result.current.retryCreate(failed.id); });
    await waitFor(() => expect(result.current.items.some((t) => t._realId === 'real-1')).toBe(true));
    expect(createCount).toBe(1); // no duplicate topic on the board
  });
});
