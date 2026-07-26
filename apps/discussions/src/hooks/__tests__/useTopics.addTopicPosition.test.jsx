import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// round201 — addTopic position: the bottom "נושא חדש" button passes
// { position: 'bottom' } and the new topic must (a) land BELOW the last group
// optimistically and (b) be PERSISTED last in the saved topic order. The
// default (toolbar) path keeps prepending. This pins the fix for the owner-
// reported bug where the bottom button's topic jumped above the first group.
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

// Two existing topics so top/bottom insertion is observable.
const topicsResponse = () => ({
  items: [{ column_values: [{ linked_items: [
    { id: 't1', name: 'topic-1', column_values: [], subitems: [] },
    { id: 't2', name: 'topic-2', column_values: [], subitems: [] },
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
  api.mockImplementation(async (query) => {
    if (query.includes('linked_items')) return topicsResponse();
    if (query.includes('create_item')) return { create_item: { id: 'real-new' } };
    return {};
  });
});

describe('useTopics — addTopic position (round201)', () => {
  it("position:'bottom' appends the optimistic row below the last group and persists it LAST", async () => {
    const { result } = renderHook(() => useTopics('D'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.addTopic('חדש בתחתית', { position: 'bottom' }); });
    // Optimistic: the new row is LAST, under the existing groups.
    expect(result.current.items.map((t) => t.name)).toEqual(['topic-1', 'topic-2', 'חדש בתחתית']);

    // Persisted order: the new real id is LAST, after the existing topics.
    await waitFor(() => expect(result.current.items.some((t) => t._realId === 'real-new')).toBe(true));
    const savedOrder = saveTopicOrder.mock.calls.at(-1)[1];
    expect(savedOrder).toEqual(['t1', 't2', 'real-new']);
  });

  it('the default (toolbar) path still PREPENDS — row first, persisted first', async () => {
    const { result } = renderHook(() => useTopics('D'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.addTopic('חדש למעלה'); });
    expect(result.current.items.map((t) => t.name)).toEqual(['חדש למעלה', 'topic-1', 'topic-2']);

    await waitFor(() => expect(result.current.items.some((t) => t._realId === 'real-new')).toBe(true));
    const savedOrder = saveTopicOrder.mock.calls.at(-1)[1];
    expect(savedOrder).toEqual(['real-new', 't1', 't2']);
  });
});
