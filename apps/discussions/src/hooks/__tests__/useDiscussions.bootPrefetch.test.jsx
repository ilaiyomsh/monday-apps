import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Fluent BoardSDK builder mock. execute() returns a configurable payload (or
// throws) and records calls, so we can assert (a) prefetchDiscussions never
// throws on error — so the App boot gate can never hang on it — and (b) the
// first DEFAULT list mount SEEDS from the boot prefetch and skips its own fetch.
let execPayload = { items: [], cursor: null };
let execShouldThrow = false;
const executeSpy = vi.fn();
vi.mock('@api/BoardSDK.js', () => {
  class FakeQuery {
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    where() { return this; }
    async execute() {
      executeSpy();
      if (execShouldThrow) throw new Error('boom');
      return execPayload;
    }
  }
  return { דיונים1Board: class { items() { return new FakeQuery(); } } };
});
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ api: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { useDiscussions, prefetchDiscussions } from '../useDiscussions.js';

beforeEach(() => {
  vi.clearAllMocks();
  execPayload = { items: [], cursor: null };
  execShouldThrow = false;
});

describe('prefetchDiscussions — boot gate + list seeding', () => {
  it('fetches the default first page and resolves true', async () => {
    execPayload = { items: [{ id: '1', name: 'A' }], cursor: 'c1' };
    const ok = await prefetchDiscussions();
    expect(ok).toBe(true);
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves false (never throws) when the fetch errors, so boot can never hang', async () => {
    execShouldThrow = true;
    await expect(prefetchDiscussions()).resolves.toBe(false);
  });

  it('a default list mount SEEDS from the boot prefetch and skips the initial fetch', async () => {
    execPayload = { items: [{ id: '1', name: 'A' }], cursor: 'c1' };
    await prefetchDiscussions(); // warms the in-memory boot cache
    executeSpy.mockClear();

    const hook = renderHook(() => useDiscussions());
    // Seeded synchronously → no loading spinner, rows already on screen.
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.items).toEqual([{ id: '1', name: 'A' }]);
    // The boot gate already fetched this page → the mount must NOT re-fetch.
    await Promise.resolve();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('a FILTERED mount ignores the seed and fetches normally', async () => {
    execPayload = { items: [{ id: '1', name: 'A' }], cursor: 'c1' };
    await prefetchDiscussions(); // warms the boot cache (a filtered mount must NOT consume it)
    executeSpy.mockClear();

    const hook = renderHook(({ f }) => useDiscussions(f), { initialProps: { f: { search: 'x' } } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(executeSpy).toHaveBeenCalled();
  });
});
