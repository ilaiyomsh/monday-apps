/*
 * Characterization tests for src/utils/topicOrder.js (test-guard retrofit).
 *
 * Fixtures mirror the real stored shape (key `discussions_topic_order_${discussionId}`):
 *   { topics: string[], points: { [topicId]: string[] } }
 * and the real fetched-topic shape ({ id, name, _subitems: [{ id, name }] }) with
 * monday-style numeric-string item ids and Hebrew names, matching what useTopics passes in.
 * monday.storage is faked with an in-memory Map (storage responses use the SDK's
 * { data: { success, value } } envelope).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map() }));

vi.mock('../mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: vi.fn(async (key) => ({
        data: { success: true, value: store.has(key) ? store.get(key) : null },
      })),
      setItem: vi.fn(async (key, value) => {
        store.set(key, value);
        return { data: { success: true } };
      }),
    },
  },
}));
vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadOrder, saveTopicOrder, savePointOrder, applyOrder } from '../topicOrder.js';
import { monday } from '../mondayApi/monday-client.js';
import logger from '../logger.js';

const DISCUSSION_ID = '8123456789';
const KEY = `discussions_topic_order_${DISCUSSION_ID}`;

// Topics as fetched from the topics board (API order), each with _subitems (points).
const apiTopics = () => [
  {
    id: '2001',
    name: 'תקציב הפרויקט',
    _subitems: [
      { id: '3001', name: 'אישור ספקים' },
      { id: '3002', name: 'עדכון תחזית' },
    ],
  },
  { id: '2002', name: 'לוח זמנים', _subitems: [{ id: '3003', name: 'אבן דרך ביניים' }] },
  { id: '2003', name: 'סטטוס גיוס', _subitems: [] },
];

const topicIds = (topics) => topics.map((t) => t.id);
const pointIds = (topic) => topic._subitems.map((p) => p.id);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('applyOrder', () => {
  it('returns the input array untouched when no order map is given', () => {
    const topics = apiTopics();
    expect(applyOrder(topics, null)).toBe(topics);
    expect(applyOrder(topics, undefined)).toBe(topics);
  });

  it('reorders topics to match the saved topic order exactly', () => {
    const out = applyOrder(apiTopics(), { topics: ['2003', '2001', '2002'], points: {} });
    expect(topicIds(out)).toEqual(['2003', '2001', '2002']);
  });

  it('does not mutate the input array when reordering', () => {
    const topics = apiTopics();
    applyOrder(topics, { topics: ['2003', '2001', '2002'], points: {} });
    expect(topicIds(topics)).toEqual(['2001', '2002', '2003']);
  });

  it('keeps topics missing from the saved order in API order AFTER the ordered ones', () => {
    const out = applyOrder(apiTopics(), { topics: ['2002'], points: {} });
    expect(topicIds(out)).toEqual(['2002', '2001', '2003']);
  });

  it('ignores stale saved ids (deleted topics) without breaking the order', () => {
    const out = applyOrder(apiTopics(), { topics: ['9999', '2003'], points: {} });
    expect(topicIds(out)).toEqual(['2003', '2001', '2002']);
    expect(out).toHaveLength(3);
  });

  it('matches numeric saved ids against string item ids (cross-type coercion)', () => {
    const out = applyOrder(apiTopics(), { topics: [2003, 2001], points: {} });
    expect(topicIds(out)).toEqual(['2003', '2001', '2002']);
  });

  it('reorders each topic points by its saved point order, leaving other topics alone', () => {
    const out = applyOrder(apiTopics(), {
      topics: [],
      points: { 2001: ['3002', '3001'] },
    });
    expect(pointIds(out[0])).toEqual(['3002', '3001']);
    expect(pointIds(out[1])).toEqual(['3003']); // untouched topic keeps API order
  });

  it('keeps API point order for topics that have no saved point order', () => {
    const out = applyOrder(apiTopics(), { topics: ['2001'], points: {} });
    expect(pointIds(out[0])).toEqual(['3001', '3002']);
  });

  it('defaults _subitems to [] for a topic fetched without them', () => {
    const out = applyOrder([{ id: '2005', name: 'ללא נקודות' }], { topics: [], points: {} });
    expect(out[0]._subitems).toEqual([]);
  });
});

describe('loadOrder', () => {
  it('returns the empty order map without touching storage when discussionId is missing', async () => {
    await expect(loadOrder(null)).resolves.toEqual({ topics: [], points: {} });
    expect(monday.storage.getItem).not.toHaveBeenCalled();
  });

  it('reads from the per-discussion storage key', async () => {
    await loadOrder(DISCUSSION_ID);
    expect(monday.storage.getItem).toHaveBeenCalledWith(KEY);
  });

  it('returns the empty order map when nothing is stored', async () => {
    await expect(loadOrder(DISCUSSION_ID)).resolves.toEqual({ topics: [], points: {} });
  });

  it('parses a stored order map back into { topics, points }', async () => {
    store.set(
      KEY,
      JSON.stringify({ topics: ['2002', '2001'], points: { 2001: ['3002', '3001'] } })
    );
    await expect(loadOrder(DISCUSSION_ID)).resolves.toEqual({
      topics: ['2002', '2001'],
      points: { 2001: ['3002', '3001'] },
    });
  });

  it('coerces numerically-stored topic ids to strings', async () => {
    store.set(KEY, JSON.stringify({ topics: [2002, 2001], points: {} }));
    const order = await loadOrder(DISCUSSION_ID);
    expect(order.topics).toEqual(['2002', '2001']);
  });

  it('falls back to the empty order map on malformed stored JSON', async () => {
    store.set(KEY, '{not json');
    await expect(loadOrder(DISCUSSION_ID)).resolves.toEqual({ topics: [], points: {} });
  });

  it('sanitizes a corrupt stored shape (topics not an array, points null)', async () => {
    store.set(KEY, JSON.stringify({ topics: 'oops', points: null }));
    await expect(loadOrder(DISCUSSION_ID)).resolves.toEqual({ topics: [], points: {} });
  });
});

describe('saveTopicOrder', () => {
  it('persists the new topic order (stringified ids) while PRESERVING saved point orders', async () => {
    store.set(
      KEY,
      JSON.stringify({ topics: ['2001'], points: { 2001: ['3002', '3001'] } })
    );
    await saveTopicOrder(DISCUSSION_ID, [2003, 2002, 2001]);
    expect(JSON.parse(store.get(KEY))).toEqual({
      topics: ['2003', '2002', '2001'],
      points: { 2001: ['3002', '3001'] },
    });
  });

  it('does nothing when discussionId is missing', async () => {
    await saveTopicOrder('', ['2001']);
    expect(monday.storage.setItem).not.toHaveBeenCalled();
  });

  it('resolves without throwing AND logs a warning when storage persistence fails', async () => {
    const storageError = new Error('storage unavailable');
    monday.storage.setItem.mockRejectedValueOnce(storageError);
    await expect(saveTopicOrder(DISCUSSION_ID, ['2001'])).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'topicOrder',
      expect.stringContaining('שמירת סדר'),
      storageError
    );
  });
});

describe('savePointOrder', () => {
  it('replaces one topic point order while PRESERVING other topics and the topic order', async () => {
    store.set(
      KEY,
      JSON.stringify({ topics: ['2002', '2001'], points: { 2001: ['3001', '3002'] } })
    );
    await savePointOrder(DISCUSSION_ID, 2002, [3010, 3003]);
    expect(JSON.parse(store.get(KEY))).toEqual({
      topics: ['2002', '2001'],
      points: { 2001: ['3001', '3002'], 2002: ['3010', '3003'] },
    });
  });

  it('does nothing when topicId is missing', async () => {
    await savePointOrder(DISCUSSION_ID, null, ['3001']);
    expect(monday.storage.setItem).not.toHaveBeenCalled();
  });
});
