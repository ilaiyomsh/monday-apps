/*
 * Tests for src/utils/pointItems.js — the per-discussion POINT → decisions/tasks
 * store (monday.storage). Fixtures mirror the real stored shape
 * (key `discussions_point_items_${discussionId}`):
 *   { [pointId]: { decisions: string[], tasks: string[] } }
 * with monday-style numeric-string ids. monday.storage is faked with an
 * in-memory Map (SDK envelope { data: { success, value } }), matching topicOrder.
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

import {
  loadPointItems, getPointItemIds, mergePointItemIn, addPointItem, prunePointItems,
} from '../pointItems.js';
import { monday } from '../mondayApi/monday-client.js';
import logger from '../logger.js';

const DISCUSSION_ID = '8123456789';
const KEY = `discussions_point_items_${DISCUSSION_ID}`;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('getPointItemIds (pure)', () => {
  const map = { p1: { decisions: ['d1', 'd2'], tasks: ['t1'] } };

  it('returns [] for a point that is absent from the map', () => {
    expect(getPointItemIds(map, 'nope', 'decision')).toEqual([]);
    expect(getPointItemIds(undefined, 'p1', 'task')).toEqual([]);
  });

  it('returns the decision ids for a decision kind and task ids for a task kind', () => {
    expect(getPointItemIds(map, 'p1', 'decision')).toEqual(['d1', 'd2']);
    expect(getPointItemIds(map, 'p1', 'task')).toEqual(['t1']);
  });

  it('coerces the point id and stored ids to strings', () => {
    const numMap = { 55: { decisions: [101, 102], tasks: [] } };
    expect(getPointItemIds(numMap, 55, 'decision')).toEqual(['101', '102']);
  });
});

describe('mergePointItemIn (pure)', () => {
  it('appends an id under the right bucket, returning a NEW map', () => {
    const base = {};
    const out = mergePointItemIn(base, 'p1', 'decision', 'd1');
    expect(out).not.toBe(base);
    expect(out).toEqual({ p1: { decisions: ['d1'], tasks: [] } });
  });

  it('appends a task id while leaving existing decisions intact', () => {
    const base = { p1: { decisions: ['d1'], tasks: [] } };
    const out = mergePointItemIn(base, 'p1', 'task', 't9');
    expect(out.p1).toEqual({ decisions: ['d1'], tasks: ['t9'] });
  });

  it('returns the SAME reference (no-op) when the id is already present', () => {
    const base = { p1: { decisions: ['d1'], tasks: [] } };
    expect(mergePointItemIn(base, 'p1', 'decision', 'd1')).toBe(base);
    expect(mergePointItemIn(base, 'p1', 'decision', 1 /* '1' !== 'd1' */)).not.toBe(base);
  });

  it('does not mutate the input map', () => {
    const base = { p1: { decisions: ['d1'], tasks: [] } };
    mergePointItemIn(base, 'p1', 'decision', 'd2');
    expect(base.p1.decisions).toEqual(['d1']);
  });

  it('coerces ids to strings so a numeric create id matches a stored string id', () => {
    const out = mergePointItemIn({}, 7, 'task', 42);
    expect(out).toEqual({ 7: { decisions: [], tasks: ['42'] } });
  });
});

describe('loadPointItems', () => {
  it('returns {} without touching storage when discussionId is missing', async () => {
    await expect(loadPointItems(null)).resolves.toEqual({});
    expect(monday.storage.getItem).not.toHaveBeenCalled();
  });

  it('reads from the per-discussion storage key', async () => {
    await loadPointItems(DISCUSSION_ID);
    expect(monday.storage.getItem).toHaveBeenCalledWith(KEY);
  });

  it('returns {} when nothing is stored', async () => {
    await expect(loadPointItems(DISCUSSION_ID)).resolves.toEqual({});
  });

  it('parses a stored map, coercing every id to a string', async () => {
    store.set(KEY, JSON.stringify({ 100: { decisions: [1, 2], tasks: [3] } }));
    await expect(loadPointItems(DISCUSSION_ID)).resolves.toEqual({
      100: { decisions: ['1', '2'], tasks: ['3'] },
    });
  });

  it('falls back to {} on malformed stored JSON', async () => {
    store.set(KEY, '{not json');
    await expect(loadPointItems(DISCUSSION_ID)).resolves.toEqual({});
  });

  it('sanitizes a corrupt entry (buckets not arrays -> [])', async () => {
    store.set(KEY, JSON.stringify({ p1: { decisions: 'oops', tasks: null } }));
    await expect(loadPointItems(DISCUSSION_ID)).resolves.toEqual({
      p1: { decisions: [], tasks: [] },
    });
  });

  it('falls back to {} when the stored value is an array, not an object map', async () => {
    store.set(KEY, JSON.stringify(['nope']));
    await expect(loadPointItems(DISCUSSION_ID)).resolves.toEqual({});
  });
});

describe('addPointItem', () => {
  it('persists a new id under the point/kind', async () => {
    await addPointItem(DISCUSSION_ID, 'p1', 'decision', 'd1');
    expect(JSON.parse(store.get(KEY))).toEqual({ p1: { decisions: ['d1'], tasks: [] } });
  });

  it('APPENDS to a point that already has ids (never clobbers siblings)', async () => {
    store.set(KEY, JSON.stringify({ p1: { decisions: ['d1'], tasks: ['t1'] } }));
    await addPointItem(DISCUSSION_ID, 'p1', 'task', 't2');
    expect(JSON.parse(store.get(KEY))).toEqual({ p1: { decisions: ['d1'], tasks: ['t1', 't2'] } });
  });

  it('does not write when the id is already recorded (dedupe)', async () => {
    store.set(KEY, JSON.stringify({ p1: { decisions: ['d1'], tasks: [] } }));
    await addPointItem(DISCUSSION_ID, 'p1', 'decision', 'd1');
    expect(monday.storage.setItem).not.toHaveBeenCalled();
  });

  it('does nothing when ids are missing', async () => {
    await addPointItem(DISCUSSION_ID, null, 'decision', 'd1');
    await addPointItem(DISCUSSION_ID, 'p1', 'decision', null);
    expect(monday.storage.setItem).not.toHaveBeenCalled();
  });

  it('resolves without throwing AND warns when persistence fails', async () => {
    const err = new Error('storage unavailable');
    monday.storage.setItem.mockRejectedValueOnce(err);
    await expect(addPointItem(DISCUSSION_ID, 'p1', 'task', 't1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('pointItems', expect.stringContaining('שמירת קישור'), err);
  });
});

describe('prunePointItems', () => {
  it('drops ids that no longer exist among the loaded items and persists the result', async () => {
    store.set(KEY, JSON.stringify({
      p1: { decisions: ['d1', 'dGone'], tasks: ['t1'] },
      p2: { decisions: [], tasks: ['tGone'] },
    }));
    const out = await prunePointItems(DISCUSSION_ID, { decisions: ['d1'], tasks: ['t1'] });
    expect(out).toEqual({ p1: { decisions: ['d1'], tasks: ['t1'] } }); // p2 emptied → dropped
    expect(JSON.parse(store.get(KEY))).toEqual({ p1: { decisions: ['d1'], tasks: ['t1'] } });
  });

  it('does NOT prune a kind whose valid list is empty (guards a failed/empty load)', async () => {
    store.set(KEY, JSON.stringify({ p1: { decisions: ['d1'], tasks: ['t1'] } }));
    const out = await prunePointItems(DISCUSSION_ID, { decisions: [], tasks: ['t1'] });
    // decisions kept (empty valid list = "not authoritative"); tasks confirmed valid.
    expect(out).toEqual({ p1: { decisions: ['d1'], tasks: ['t1'] } });
    expect(monday.storage.setItem).not.toHaveBeenCalled();
  });

  it('does not write when nothing changed', async () => {
    store.set(KEY, JSON.stringify({ p1: { decisions: ['d1'], tasks: [] } }));
    await prunePointItems(DISCUSSION_ID, { decisions: ['d1', 'd2'], tasks: ['t1'] });
    expect(monday.storage.setItem).not.toHaveBeenCalled();
  });

  it('returns {} without touching storage when discussionId is missing', async () => {
    await expect(prunePointItems(null, { decisions: ['d1'], tasks: [] })).resolves.toEqual({});
    expect(monday.storage.getItem).not.toHaveBeenCalled();
  });
});
