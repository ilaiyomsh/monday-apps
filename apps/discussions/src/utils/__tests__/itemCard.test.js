import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the monday client so we can assert exactly which execute() commands the
// shared item-card helper issues — open vs the best-effort close. (The SDK has
// no guaranteed closeItemCard; see utils/itemCard.js — we still attempt it.)
const execute = vi.fn(() => Promise.resolve());
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: { execute: (...a) => execute(...a) },
}));

import {
  openOrToggleItemCard,
  closeOpenItemCard,
  getOpenItemCardId,
} from '../itemCard.js';

beforeEach(() => {
  // Reset the module singleton between tests, then clear the call history.
  closeOpenItemCard();
  execute.mockClear();
});

describe('itemCard — open / toggle / close tracking', () => {
  it('opens the item card on the Updates pane and tracks the open id', () => {
    openOrToggleItemCard(123);
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 123, kind: 'updates' });
    expect(getOpenItemCardId()).toBe('123');
  });

  it('TOGGLES closed on a second click of the SAME item (best-effort closeItemCard)', () => {
    openOrToggleItemCard(123);
    execute.mockClear();
    openOrToggleItemCard(123);
    expect(execute).toHaveBeenCalledWith('closeItemCard');
    expect(getOpenItemCardId()).toBeNull();
  });

  it('switches to a DIFFERENT item — opens it, never closes', () => {
    openOrToggleItemCard(1);
    execute.mockClear();
    openOrToggleItemCard(2);
    expect(execute).toHaveBeenCalledWith('openItemCard', { itemId: 2, kind: 'updates' });
    expect(execute).not.toHaveBeenCalledWith('closeItemCard');
    expect(getOpenItemCardId()).toBe('2');
  });

  it('closeOpenItemCard() closes an open card and clears the tracked id', () => {
    openOrToggleItemCard(7);
    execute.mockClear();
    closeOpenItemCard();
    expect(execute).toHaveBeenCalledWith('closeItemCard');
    expect(getOpenItemCardId()).toBeNull();
  });

  it('closeOpenItemCard() is a no-op when nothing is open', () => {
    closeOpenItemCard();
    expect(execute).not.toHaveBeenCalled();
    expect(getOpenItemCardId()).toBeNull();
  });

  it('ignores a null / undefined item id', () => {
    openOrToggleItemCard(null);
    openOrToggleItemCard(undefined);
    expect(execute).not.toHaveBeenCalled();
    expect(getOpenItemCardId()).toBeNull();
  });
});
