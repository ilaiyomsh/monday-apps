import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round-75 audit fix E1: useDiscussions fetch/loadMore failures must route to
// the logger funnel (toast + dedup), NEVER to console.error (invisible to the
// user). A failing board read must call logger.error, not console.
let failNext = false;
vi.mock('@api/BoardSDK.js', () => {
  class FakeQuery {
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    where() { return this; }
    async execute() {
      if (failNext) { failNext = false; throw new Error('board read failed'); }
      return { items: [], cursor: null };
    }
  }
  return { דיונים1Board: class { items() { return new FakeQuery(); } } };
});
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ api: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useDiscussions } from '../useDiscussions.js';
import logger from '../../utils/logger.js';

beforeEach(() => { vi.clearAllMocks(); failNext = false; });

describe('useDiscussions — E1: fetch failures go through the logger, not console', () => {
  it('a failing initial fetch calls logger.error (funnel) and never console.error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    failNext = true;
    const { result } = renderHook(() => useDiscussions({ search: '', month: null, type: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(logger.error).toHaveBeenCalledWith('useDiscussions', expect.any(String), expect.any(Error));
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
