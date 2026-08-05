/**
 * bypassMonitor — the settings monitor's fetch (round323). A returned status
 * for every outcome, never a throw; the request carries the sessionToken and
 * the window as query params.
 */

import { describe, expect, it, vi } from 'vitest';

import { fetchBypasses } from './bypassMonitor.js';

const okResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const Q = { boardId: '5098', columnId: 'status_col', fromMs: 1000, toMs: 2000 };

const makeDeps = (overrides = {}) => ({
  guardUrl: 'https://guard.example',
  sessionTokenProvider: vi.fn().mockResolvedValue('session-jwt'),
  fetchImpl: vi.fn().mockResolvedValue(okResponse(200, { count: 1, events: [{ ts: 1500 }] })),
  ...overrides,
});

describe('fetchBypasses', () => {
  it("returns 'disabled' without fetching when the base resolves to null (dev-harness mock)", async () => {
    const deps = makeDeps({ guardUrl: null });
    expect(await fetchBypasses(Q, deps)).toEqual({ status: 'disabled' });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.sessionTokenProvider).not.toHaveBeenCalled();
  });

  it("GETs the RELATIVE bypasses endpoint (same-origin) when the base is '' — a real build's default", async () => {
    const deps = makeDeps({ guardUrl: '' });
    await fetchBypasses(Q, deps);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    expect(deps.fetchImpl.mock.calls[0][0])
      .toBe('/api/guard/bypasses?boardId=5098&columnId=status_col&from=1000&to=2000');
  });

  it('GETs the bypasses endpoint with the sessionToken and the window as query params', async () => {
    const deps = makeDeps();
    await fetchBypasses(Q, deps);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe('https://guard.example/api/guard/bypasses?boardId=5098&columnId=status_col&from=1000&to=2000');
    expect(init.headers).toMatchObject({ Authorization: 'session-jwt' });
  });

  it("returns { status:'ok', events } from a 200 answer", async () => {
    const events = [{ ts: 1900 }, { ts: 1500 }];
    const deps = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(200, { count: 2, events })) });
    expect(await fetchBypasses(Q, deps)).toEqual({ status: 'ok', events });
  });

  it("coerces a missing events array to [] on a 200 answer", async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(200, { count: 0 })) });
    expect(await fetchBypasses(Q, deps)).toEqual({ status: 'ok', events: [] });
  });

  it("maps 409 to 'not_activated' and 403 to 'forbidden'", async () => {
    const dep409 = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(409, { error: 'not_activated' })) });
    expect((await fetchBypasses(Q, dep409)).status).toBe('not_activated');
    const dep403 = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(403, { error: 'not_column_owner' })) });
    expect((await fetchBypasses(Q, dep403)).status).toBe('forbidden');
  });

  it("returns 'failed' on any other non-2xx answer", async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(502, { error: 'x' })) });
    expect((await fetchBypasses(Q, deps)).status).toBe('failed');
  });

  it("returns 'failed' — never throws — when the request rejects", async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await expect(fetchBypasses(Q, deps)).resolves.toEqual({ status: 'failed' });
  });

  it("returns 'failed' — never throws — when the session token provider rejects", async () => {
    const deps = makeDeps({ sessionTokenProvider: vi.fn().mockRejectedValue(new Error('no context')) });
    const out = await fetchBypasses(Q, deps);
    expect(out).toEqual({ status: 'failed' });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
});
