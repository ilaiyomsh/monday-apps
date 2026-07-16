import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round-77 shared group-header color storage. Mock the monday SDK singleton so
// load/save round-trip through an in-memory store.
const store = new Map();
vi.mock('../mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: vi.fn(async (k) => ({ data: { value: store.has(k) ? store.get(k) : null } })),
      setItem: vi.fn(async (k, v) => { store.set(k, v); return { success: true }; }),
    },
  },
}));
vi.mock('../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  loadGroupColors, saveGroupColors, groupColorsScope, withGroupColor, withoutGroupColor,
} from '../groupColors.js';

beforeEach(() => { store.clear(); });

describe('groupColorsScope', () => {
  it('prefers instanceId, then boardId, then default', () => {
    expect(groupColorsScope({ instanceId: 'i1', boardId: 'b1' })).toBe('i1');
    expect(groupColorsScope({ boardId: 'b1' })).toBe('b1');
    expect(groupColorsScope(null)).toBe('default');
  });
});

describe('withGroupColor / withoutGroupColor (pure reducers)', () => {
  it('withGroupColor sets one key without mutating the input', () => {
    const base = { a: '#111' };
    const next = withGroupColor(base, 'b', '#222');
    expect(next).toEqual({ a: '#111', b: '#222' });
    expect(base).toEqual({ a: '#111' }); // unchanged
  });
  it('withoutGroupColor removes one key without mutating the input', () => {
    const base = { a: '#111', b: '#222' };
    const next = withoutGroupColor(base, 'a');
    expect(next).toEqual({ b: '#222' });
    expect(base).toEqual({ a: '#111', b: '#222' });
  });
});

describe('loadGroupColors / saveGroupColors round-trip', () => {
  it('saves under the scoped key and loads the same map back', async () => {
    await saveGroupColors('inst-1', { g1: '#123456', g2: '#abcdef' });
    // stored under the scoped key
    expect(store.has('discussions_group_colors_inst-1')).toBe(true);
    const loaded = await loadGroupColors('inst-1');
    expect(loaded).toEqual({ g1: '#123456', g2: '#abcdef' });
  });

  it('returns {} for an unknown scope', async () => {
    expect(await loadGroupColors('nope')).toEqual({});
  });

  it('drops non-string color values on save', async () => {
    await saveGroupColors('inst-2', { good: '#0f0', bad: 42, empty: '' });
    const loaded = await loadGroupColors('inst-2');
    expect(loaded).toEqual({ good: '#0f0' });
  });

  it('drops non-string color values on LOAD too (dirty data written outside save)', async () => {
    // Seed the store directly with a raw payload that bypasses saveGroupColors,
    // so only the LOAD-side normalization can clean it.
    store.set('discussions_group_colors_dirty', JSON.stringify({ colors: { good: '#0f0', bad: 42, nul: null, empty: '' } }));
    const loaded = await loadGroupColors('dirty');
    expect(loaded).toEqual({ good: '#0f0' });
  });

  it('returns {} when the stored payload has no colors object', async () => {
    store.set('discussions_group_colors_shapeless', JSON.stringify({ notColors: 1 }));
    expect(await loadGroupColors('shapeless')).toEqual({});
  });
});
