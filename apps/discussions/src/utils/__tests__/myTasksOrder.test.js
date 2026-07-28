import { describe, it, expect, vi, beforeEach } from 'vitest';

// round208 — mobile manual ordering for המשימות שלי: key shape, defensive apply.
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
const warn = vi.hoisted(() => vi.fn());
vi.mock('../mondayApi/monday-client.js', () => ({ monday: { storage } }));
vi.mock('../logger.js', () => ({ default: { warn } }));

import { loadMyTasksOrder, saveMyTasksOrder, applyManualOrder } from '../myTasksOrder.js';

beforeEach(() => { storage.getItem.mockReset(); storage.setItem.mockReset(); warn.mockReset(); });

describe('applyManualOrder', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('reorders saved ids to the saved order, unknown ids keep API order at the end', () => {
    const out = applyManualOrder(items, ['c', 'a']);
    expect(out.map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('drops deleted ids and tolerates numeric/string id mismatches', () => {
    const nItems = [{ id: 1 }, { id: 2 }];
    const out = applyManualOrder(nItems, ['2', 'gone', '1']);
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });

  it('returns the list untouched (same reference) when no order is saved', () => {
    expect(applyManualOrder(items, [])).toBe(items);
    expect(applyManualOrder(items, null)).toBe(items);
    expect(applyManualOrder([], ['a'])).toEqual([]);
  });
});

describe('load/save', () => {
  it('loads the per-user order from its key, as strings', async () => {
    storage.getItem.mockResolvedValue({ data: { value: JSON.stringify({ order: [3, '7'] }) } });
    await expect(loadMyTasksOrder('42')).resolves.toEqual(['3', '7']);
    expect(storage.getItem).toHaveBeenCalledWith('discussions_mytasks_order_42');
  });

  it('resolves [] (and warns) on storage failure', async () => {
    storage.getItem.mockRejectedValue(new Error('boom'));
    await expect(loadMyTasksOrder('42')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('saves the order as {order: string[]} under the per-user key, swallowing failures', async () => {
    storage.setItem.mockResolvedValue({});
    await saveMyTasksOrder('42', [5, '6']);
    expect(storage.setItem).toHaveBeenCalledWith(
      'discussions_mytasks_order_42',
      JSON.stringify({ order: ['5', '6'] }),
    );
    storage.setItem.mockRejectedValue(new Error('quota'));
    await expect(saveMyTasksOrder('42', ['1'])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
