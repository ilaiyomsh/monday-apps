import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the monday client so we can assert the item-card helper ALWAYS opens.
// monday's client SDK exposes no programmatic close (see utils/itemCard.js), so
// the helper is intentionally OPEN-ONLY: no toggle, no close attempt, no tracked
// open/closed state to desync.
const execute = vi.fn(() => Promise.resolve());
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: { execute: (...a) => execute(...a) },
}));

import { openOrToggleItemCard } from '../itemCard.js';

beforeEach(() => {
  execute.mockClear();
});

describe('itemCard — reliable open-only (monday has no close API)', () => {
  it('opens the item card on the Updates pane', () => {
    openOrToggleItemCard(123);
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 123, kind: 'updates' });
  });

  it('re-OPENS (never closes) on a second click of the SAME item', () => {
    openOrToggleItemCard(123);
    execute.mockClear();
    openOrToggleItemCard(123);
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 123, kind: 'updates' });
    expect(execute).not.toHaveBeenCalledWith('closeItemCard');
  });

  it('opens a DIFFERENT item when switching rows — still never closes', () => {
    openOrToggleItemCard(1);
    execute.mockClear();
    openOrToggleItemCard(2);
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 2, kind: 'updates' });
    expect(execute).not.toHaveBeenCalledWith('closeItemCard');
  });

  it('honors an explicit kind argument', () => {
    openOrToggleItemCard(5, 'updates');
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 5, kind: 'updates' });
  });

  it('coerces the id to a number for monday.execute', () => {
    openOrToggleItemCard('42');
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 42, kind: 'updates' });
  });

  it('ignores a null / undefined item id', () => {
    openOrToggleItemCard(null);
    openOrToggleItemCard(undefined);
    expect(execute).not.toHaveBeenCalled();
  });

  it('never throws if monday.execute is unavailable', () => {
    execute.mockImplementationOnce(() => { throw new Error('no iframe'); });
    expect(() => openOrToggleItemCard(9)).not.toThrow();
  });
});
