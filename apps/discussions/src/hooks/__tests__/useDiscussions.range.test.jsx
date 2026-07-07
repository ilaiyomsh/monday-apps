import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the board class with a fluent-builder spy so we can assert the where
// clause the hook builds for each filter combination.
const whereSpy = vi.fn();
vi.mock('@api/BoardSDK.js', () => {
  class FakeQuery {
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    where(w) { whereSpy(w); return this; }
    async execute() { return { items: [], cursor: null }; }
  }
  return { דיונים1Board: class { items() { return new FakeQuery(); } } };
});
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ api: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useDiscussions } from '../useDiscussions.js';

beforeEach(() => vi.clearAllMocks());

async function mounted(filters) {
  const hook = renderHook(({ f }) => useDiscussions(f), { initialProps: { f: filters } });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useDiscussions range filter', () => {
  it('builds a between clause from filters.range', async () => {
    await mounted({ range: { from: '2026-05-30', to: '2026-07-05' } });
    expect(whereSpy).toHaveBeenCalledWith({ discussionDateID: { between: ['2026-05-30', '2026-07-05'] } });
  });

  it('range wins over month when both are set', async () => {
    await mounted({ month: '2026-06', range: { from: '2026-05-30', to: '2026-07-05' } });
    expect(whereSpy).toHaveBeenCalledWith({ discussionDateID: { between: ['2026-05-30', '2026-07-05'] } });
  });

  it('month alone still builds its own between clause', async () => {
    await mounted({ month: '2026-06' });
    expect(whereSpy).toHaveBeenCalledWith({ discussionDateID: { between: ['2026-06-01', '2026-06-30'] } });
  });

  it('a range change triggers a refetch with the new clause', async () => {
    const hook = renderHook(({ f }) => useDiscussions(f), {
      initialProps: { f: { range: { from: '2026-05-30', to: '2026-07-05' } } },
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    whereSpy.mockClear();
    hook.rerender({ f: { range: { from: '2026-06-06', to: '2026-06-14' } } });
    await waitFor(() =>
      expect(whereSpy).toHaveBeenCalledWith({ discussionDateID: { between: ['2026-06-06', '2026-06-14'] } })
    );
  });
});
