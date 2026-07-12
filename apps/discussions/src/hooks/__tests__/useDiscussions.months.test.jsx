process.env.TZ = 'Asia/Jerusalem';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the board with a fluent-builder whose execute() returns a fixed item list
// (id + Date) so we can assert the distinct-month reduction without a network.
let execItems = [];
vi.mock('@api/BoardSDK.js', () => {
  class FakeQuery {
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    where() { return this; }
    async execute() { return { items: execItems, cursor: null }; }
  }
  return { דיונים1Board: class { items() { return new FakeQuery(); } } };
});
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ api: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useDiscussionMonths } from '../useDiscussions.js';

beforeEach(() => vi.clearAllMocks());

describe('useDiscussionMonths', () => {
  it('reduces discussion dates to the sorted distinct month set, incl. a FUTURE month', async () => {
    // Mixed dates incl. a future-dated discussion and a duplicate month; a null
    // date is ignored. Input order is irrelevant → output must be newest-first.
    execItems = [
      { id: '1', discussionDateID: new Date(2026, 7, 3) },   // 2026-08 (future)
      { id: '2', discussionDateID: new Date(2026, 6, 20) },  // 2026-07
      { id: '3', discussionDateID: new Date(2026, 6, 1) },   // 2026-07 (dup)
      { id: '4', discussionDateID: new Date(2026, 4, 9) },   // 2026-05
      { id: '5', discussionDateID: null },                   // ignored
    ];
    const hook = renderHook(() => useDiscussionMonths());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.months).toEqual(['2026-08', '2026-07', '2026-05']);
  });

  it('returns an empty set (and never throws) when there are no discussions', async () => {
    execItems = [];
    const hook = renderHook(() => useDiscussionMonths());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.months).toEqual([]);
  });
});
