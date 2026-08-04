/**
 * guardStatus — the settings screen's read of the guard's activation/enrollment
 * state (round326). The contract under test: a shape for every outcome and never
 * a throw; the exact request the server's /api/guard/status endpoint expects
 * (sessionToken auth, boardId+columnId in the query, URL-encoded); and the
 * neutral { null, null } fallback whenever the answer is missing/unreachable so
 * the UI never shows a false "not connected".
 */

import { describe, expect, it, vi } from 'vitest';

import { getGuardStatus } from './guardStatus.js';

const okResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const makeDeps = (overrides = {}) => ({
  guardUrl: 'https://guard.example',
  sessionTokenProvider: vi.fn().mockResolvedValue('session-jwt'),
  fetchImpl: vi.fn().mockResolvedValue(okResponse(200, { activated: true, enrolled: true })),
  ...overrides,
});

describe('getGuardStatus', () => {
  it('returns the neutral {null,null} without fetching when the base resolves to null (dev-harness mock)', async () => {
    const deps = makeDeps({ guardUrl: null });
    const status = await getGuardStatus({ boardId: '5098', columnId: 'status_col' }, deps);
    expect(status).toEqual({ activated: null, enrolled: null });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.sessionTokenProvider).not.toHaveBeenCalled();
  });

  it('GETs the RELATIVE /api/guard/status (same-origin) with boardId+columnId when the base is \'\'', async () => {
    const deps = makeDeps({ guardUrl: '' });
    await getGuardStatus({ boardId: '5098', columnId: 'status_col' }, deps);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe('/api/guard/status?boardId=5098&columnId=status_col');
    expect(init.headers).toMatchObject({ Authorization: 'session-jwt' });
  });

  it('maps a 200 body to strict booleans (activated + enrolled)', async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(200, { activated: true, enrolled: false })) });
    expect(await getGuardStatus({ boardId: 1, columnId: 'c' }, deps)).toEqual({ activated: true, enrolled: false });
  });

  it('coerces a missing/undefined flag to false, never true', async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(200, {})) });
    expect(await getGuardStatus({ boardId: 1, columnId: 'c' }, deps)).toEqual({ activated: false, enrolled: false });
  });

  it('URL-encodes a columnId that contains reserved characters', async () => {
    const deps = makeDeps({ guardUrl: '', columnId: 'a b&c' });
    await getGuardStatus({ boardId: '5098', columnId: 'a b&c' }, deps);
    expect(deps.fetchImpl.mock.calls[0][0]).toBe('/api/guard/status?boardId=5098&columnId=a%20b%26c');
  });

  it('returns the neutral {null,null} on a non-2xx answer (does not treat it as not-connected)', async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockResolvedValue(okResponse(502, { error: 'status_failed' })) });
    expect(await getGuardStatus({ boardId: 1, columnId: 'c' }, deps)).toEqual({ activated: null, enrolled: null });
  });

  it('returns the neutral {null,null} — never throws — when the network request rejects', async () => {
    const deps = makeDeps({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await expect(getGuardStatus({ boardId: 1, columnId: 'c' }, deps)).resolves.toEqual({ activated: null, enrolled: null });
  });
});
