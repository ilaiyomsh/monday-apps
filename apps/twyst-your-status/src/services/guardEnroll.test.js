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
  it("returns 'disabled' without fetching or asking for a token when the base resolves to null (dev-harness mock)", async () => {
    const deps = makeDeps({ guardUrl: null });
    const status = await enrollColumnGuard({ boardId: '5098', columnId: 'status_col' }, deps);
    expect(status).toBe('disabled');
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.sessionTokenProvider).not.toHaveBeenCalled();
  });

  it("POSTs to the RELATIVE /api/guard/enroll (same-origin) when the base is '' — a real build's default", async () => {
    const deps = makeDeps({ guardUrl: '' });
    const status = await enrollColumnGuard({ boardId: '5098', columnId: 'status_col' }, deps);
    expect(status).toBe('enrolled');
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.fetchImpl.mock.calls[0][0]).toBe('/api/guard/enroll');
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

  /*
   * round330 — 403 gets its own status. The manual enroll button reports the
   * reason to the owner, and "רק בעלי הלוח יכולים לרשום" is a different
   * instruction from "נסו שוב": retrying cannot fix a permission.
   */
  it("returns 'not_board_owner' on a 403 answer", async () => {
    const deps = makeDeps({
      fetchImpl: vi.fn().mockResolvedValue(okResponse(403, { error: 'not_board_owner' })),
    });
    expect(await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps)).toBe('not_board_owner');
  });

  it("returns 'failed' on any other non-2xx answer (502 from monday included)", async () => {
    const deps = makeDeps({
      fetchImpl: vi.fn().mockResolvedValue(okResponse(502, { error: 'enroll_failed' })),
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

  /*
   * round329 — the caller now AWAITS this call and closes the settings surface
   * only afterwards, which puts two new requirements on the request itself.
   */

  it('sends the request as keepalive, so a surface that closes mid-flight cannot kill it', async () => {
    const deps = makeDeps();
    await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps);
    expect(deps.fetchImpl.mock.calls[0][1].keepalive).toBe(true);
  });

  it("gives up with 'failed' after timeoutMs — an unreachable guard cannot hold the settings screen open", async () => {
    // A guard that never answers, and honours the abort the way fetch does.
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const deps = makeDeps({ fetchImpl, timeoutMs: 20 });

    const status = await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps);

    expect(status).toBe('failed');
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('does not abort a request that answers in time', async () => {
    const deps = makeDeps({ timeoutMs: 5000 });
    const status = await enrollColumnGuard({ boardId: '5098', columnId: 'c' }, deps);
    expect(status).toBe('enrolled');
    expect(deps.fetchImpl.mock.calls[0][1].signal.aborted).toBe(false);
  });
});
