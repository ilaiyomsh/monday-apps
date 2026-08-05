/**
 * mondayApi.caps.test.js — silent truncation defaults under high volume.
 *
 * High-scale round (30+ users / thousands of items): the shared service ships
 * three defaults that TRUNCATE SILENTLY once real data outgrows them —
 *   getAllItems: maxItems = 500 (auto-pagination stops mid-board, cursor live)
 *   getItems:    limit    = 50  per page
 *   getUsers:    limit    = 50  (a 60-user account loses 10 users)
 * These tests CHARACTERIZE the current contract so any caller relying on the
 * defaults does so knowingly, and pin that explicit overrides do lift the caps.
 * If a truncation warning / higher default lands later, the exact assertions
 * below are the ones meant to fail and be updated.
 *
 * Same monday-sdk-js mock harness as mondayApi.test.js.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockMonday = {
  setApiVersion: vi.fn(),
  api: vi.fn(),
  get: vi.fn(),
  execute: vi.fn(),
  listen: vi.fn(),
  storage: { instance: { getItem: vi.fn(), setItem: vi.fn() } },
};

vi.mock('monday-sdk-js', () => ({
  default: () => mockMonday,
}));

const { createMondayApiService } = await import('../mondayApi.js');

async function createInitializedService(options = {}) {
  const service = createMondayApiService();
  mockMonday.get.mockResolvedValueOnce({
    data: {
      boardId: '123',
      user: { id: 'u1' },
      account: { id: 'a1' },
      instanceId: 'inst1',
      app: { id: 'app1' },
      theme: 'light',
    },
  });
  await service.init({ logLevel: 'silent', ...options });
  return service;
}

const makeItems = (from, count) =>
  Array.from({ length: count }, (_, i) => ({ id: String(from + i), name: `item ${from + i}` }));

/**
 * Board with `total` items served in `pageSize` pages; cursors keep flowing
 * as long as items remain (the last served page still returns a cursor when
 * the board has more) so the maxItems break is what stops the loop.
 */
function installPagedBoard(total, pageSize) {
  let served = 0;
  mockMonday.api.mockImplementation(async (query) => {
    const items = makeItems(served + 1, Math.min(pageSize, total - served));
    served += items.length;
    const cursor = served < total ? `c${served}` : null;
    const page = { cursor, items };
    return {
      data: query.includes('next_items_page')
        ? { next_items_page: page }
        : { boards: [{ items_page: page }] },
      errors: undefined,
      extensions: {},
    };
  });
  return () => served;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

describe('getAllItems default caps (maxItems 500 / page limit 50)', () => {
  it('stops at exactly 500 items on a 700-item board — silently, with the cursor still live (current contract)', async () => {
    const service = await createInitializedService();
    installPagedBoard(700, 50);

    const items = await service.getAllItems('900100');

    expect(items).toHaveLength(500);
    // 10 pages of 50 were fetched, then the loop broke ON the cap with 200
    // items still unread behind a live cursor — nothing signals the loss.
    expect(mockMonday.api).toHaveBeenCalledTimes(10);
    expect(items[0].id).toBe('1');
    expect(items[499].id).toBe('500');
  });

  it('requests 50-item pages by default: first call items_page(limit: 50), later calls next_items_page(..., limit: 50)', async () => {
    const service = await createInitializedService();
    installPagedBoard(120, 50);

    await service.getAllItems('900100');

    const queries = mockMonday.api.mock.calls.map((c) => c[0]);
    expect(queries[0]).toContain('items_page(limit: 50)');
    expect(queries[1]).toContain('next_items_page(cursor: $cursor, limit: 50)');
  });

  it('OVERSHOOTS the cap without slicing when a page crosses it: limit 300 → 600 of 900 returned', async () => {
    const service = await createInitializedService();
    installPagedBoard(900, 300);

    const items = await service.getAllItems('900100', { limit: 300 });

    // 300 < 500 → fetch another 300 → 600 ≥ 500 → break. The overshoot is
    // returned as-is; maxItems is a stop condition, not a hard slice.
    expect(items).toHaveLength(600);
    expect(mockMonday.api).toHaveBeenCalledTimes(2);
  });

  it('lifts the cap with an explicit maxItems: 1,200-item board drained fully at limit 500', async () => {
    const service = await createInitializedService();
    installPagedBoard(1200, 500);

    const items = await service.getAllItems('900100', { limit: 500, maxItems: 2000 });

    expect(items).toHaveLength(1200);
    expect(mockMonday.api).toHaveBeenCalledTimes(3);
    expect(new Set(items.map((i) => i.id)).size).toBe(1200);
  });
});

describe('getUsers default cap (limit 50)', () => {
  it('asks the API for users(limit: 50) by default — a 30+-user account is fine, a 51st user is silently dropped by the request itself', async () => {
    const service = await createInitializedService();
    mockMonday.api.mockResolvedValueOnce({
      data: { users: makeItems(1, 50) },
      errors: undefined,
      extensions: {},
    });

    const users = await service.getUsers();

    expect(mockMonday.api.mock.calls[0][0]).toContain('users(limit: 50)');
    expect(users).toHaveLength(50);
  });

  it('passes an explicit limit through to the query: users(limit: 200)', async () => {
    const service = await createInitializedService();
    mockMonday.api.mockResolvedValueOnce({
      data: { users: makeItems(1, 60) },
      errors: undefined,
      extensions: {},
    });

    const users = await service.getUsers({ limit: 200 });

    expect(mockMonday.api.mock.calls[0][0]).toContain('users(limit: 200)');
    expect(users).toHaveLength(60);
  });
});
