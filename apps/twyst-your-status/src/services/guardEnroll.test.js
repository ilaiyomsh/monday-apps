/**
 * guardEnroll — the settings screen's best-effort call to the guard server
 * after a successful save (round322). The contract under test: a returned
 * status for every outcome, never a throw — a save must not fail or wait on
 * the guard — and the exact request shape the server's enroll endpoint pins
 * on its side (Authorization sessionToken, JSON body with boardId+columnId).
 */

import { describe, expect, it, vi } from 'vitest';

import { enrollColumnGuard } from './guardEnroll.js';

const okResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const makeDeps = (overrides = {}) => ({
  guardUrl: 'https://guard.example',
  sessionTokenProvider: vi.fn().mockResolvedValue('session-jwt'),
  fetchImpl: vi.fn().mockResolvedValue(okResponse(200, { ok: true, webhookId: '55501' })),
  ...overrides,
});

describe('enrollColumnGuard', () => {
  it("returns 'disabled' without fetching or asking for a token when no guard URL is configured", async () => {
    const deps = makeDeps({ guardUrl: '' });
    const status = await enrollColumnGuard({ boardId: '5098', columnId: 'status_col' }, deps);
    expect(status).toBe('disabled');
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.sessionTokenProvider).not.toHaveBeenCalled();
  });

  it('POSTs to <guardUrl>/api/guard/enroll with the sessionToken and a JSON body of boardId+columnId as strings', async () => {
    const deps = makeDeps();
    const status = await enrollColumnGuard({ boardId: 5098, columnId: 'status_col' }, deps);
    expect(status).toBe('enrolled');
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe('https://guard.example/api/guard/enroll');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'session-jwt',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({ boardId: '5098', columnId: 'status_col' });
  });

  it('a trailing slash on the configured guard URL does not double the path separator', async () => {
    const deps = makeDeps({ guardUrl: 'https://guard.example/' });
    await enrollColumnGuard({ boardId: '5098', columnId: 'status_col' }, deps);
    expect(deps.fetchImpl.mock.calls[0][0]).toBe('https://guard.example/api/guard/enroll');
  });

  it("returns 'not_activated' on a 409 answer", async () => {
    const deps = makeDeps({
      fetchImpl: vi.fn().mockResolvedValue(okResponse(409, { error: 'not_activated' })),
    });
    expect(await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps)).toBe('not_activated');
  });

  it("returns 'failed' on any other non-2xx answer (403 not_board_owner included)", async () => {
    const deps = makeDeps({
      fetchImpl: vi.fn().mockResolvedValue(okResponse(403, { error: 'not_board_owner' })),
    });
    expect(await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps)).toBe('failed');
  });

  it("returns 'failed' — never throws — when the network request rejects", async () => {
    const deps = makeDeps({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps)).resolves.toBe('failed');
  });

  it("returns 'failed' — never throws — when the sessionToken provider rejects", async () => {
    const deps = makeDeps({
      sessionTokenProvider: vi.fn().mockRejectedValue(new Error('no monday context')),
    });
    const status = await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps);
    expect(status).toBe('failed');
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
});
