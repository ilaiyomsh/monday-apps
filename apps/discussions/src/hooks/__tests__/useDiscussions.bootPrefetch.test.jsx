import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/*
 * Fluent BoardSDK builder mock. execute() returns a configurable payload (or
 * throws) and records the PAGINATION ARGS of every call, so we can assert (a)
 * prefetchDiscussions never throws on error — so the App boot gate can never hang
 * on it — and (b) the first DEFAULT list mount SEEDS from the boot prefetch and
 * never re-fetches the page the boot gate already has.
 *
 * round379 — the args matter now, not just the count. A seeded mount legitimately
 * issues CURSOR calls (the background drain, which continues past the 15 seeded
 * rows); what it must never issue is a second LIMIT call, which would re-fetch the
 * seeded page. Counting calls alone can no longer tell those apart.
 */
let execPayload = { items: [], cursor: null };
let execShouldThrow = false;
const executeSpy = vi.fn();
// A cursor-ed page resolves the drain immediately (cursor: null) unless a test
// overrides it, so a drain never spins inside an unrelated assertion.
let cursorPayload = { items: [], cursor: null };
const paginationCalls = () => executeSpy.mock.calls.map(([p]) => p || {});
const limitCalls = () => paginationCalls().filter((p) => p.cursor === undefined);
const cursorCalls = () => paginationCalls().filter((p) => p.cursor !== undefined);
vi.mock('@api/BoardSDK.js', () => {
  class FakeQuery {
    constructor() { this.pagination = {}; }
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination(p) { this.pagination = p || {}; return this; }
    where() { return this; }
    async execute() {
      executeSpy(this.pagination);
      if (execShouldThrow) throw new Error('boom');
      return this.pagination.cursor !== undefined ? cursorPayload : execPayload;
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
  cursorPayload = { items: [], cursor: null };
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

  it('a default list mount SEEDS from the boot prefetch and never re-fetches that page', async () => {
    execPayload = { items: [{ id: '1', name: 'A' }], cursor: 'c1' };
    await prefetchDiscussions(); // warms the in-memory boot cache
    executeSpy.mockClear();

    const hook = renderHook(() => useDiscussions());
    // Seeded synchronously → no loading spinner, rows already on screen.
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.items).toEqual([{ id: '1', name: 'A' }]);
    // The boot gate already fetched this page → NO second first-page fetch. This
    // is the assertion the round must not break; it is checked on the pagination
    // args because the drain below is also a fetch.
    await Promise.resolve();
    expect(limitCalls()).toHaveLength(0);
  });

  /*
   * round379 — the seed is only the FIRST 15 rows, so a seeded mount has to keep
   * loading. Before this round the seed path returned early and did nothing, which
   * would now leave a boot-seeded session stuck at 15 discussions all session.
   */
  it('a seeded mount DRAINS the rest from the seed cursor', async () => {
    execPayload = { items: [{ id: '1', name: 'A' }], cursor: 'c1' };
    await prefetchDiscussions();
    executeSpy.mockClear();
    cursorPayload = { items: [{ id: '2', name: 'B' }], cursor: null };

    const hook = renderHook(() => useDiscussions());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(2));
    // it continued from the SEED's cursor, and it stopped when the cursor ran out
    expect(cursorCalls()[0].cursor).toBe('c1');
    expect(hook.result.current.items.map((i) => i.id)).toEqual(['1', '2']);
    await waitFor(() => expect(hook.result.current.autoLoading).toBe(false));
    expect(hook.result.current.cursor).toBeNull();
  });

  it('a FILTERED mount takes one full page and does NOT drain', async () => {
    // A filtered list keeps the old behaviour: one page + the manual "טען עוד".
    execPayload = { items: [{ id: '1', name: 'A' }], cursor: 'c1' };
    const hook = renderHook(() => useDiscussions({ search: 'x' }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await Promise.resolve();
    expect(cursorCalls()).toHaveLength(0);
    expect(hook.result.current.cursor).toBe('c1'); // the button has something to do
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
