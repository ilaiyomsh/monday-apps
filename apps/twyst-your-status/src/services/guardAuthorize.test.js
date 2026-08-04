/**
 * guardAuthorize — the settings screen's in-app trigger for the guard's one-time
 * OAuth activation (round325). The contract under test: a returned status for
 * every outcome, never a throw (the settings screen must not break on it), and
 * the EXACT URL the server's /oauth/start endpoint expects — the same-origin
 * relative path by default, the sessionToken carried in `st` and URL-encoded.
 */

import { describe, expect, it, vi } from 'vitest';

import { startGuardAuthorization } from './guardAuthorize.js';

const makeDeps = (overrides = {}) => ({
  guardUrl: 'https://guard.example',
  sessionTokenProvider: vi.fn().mockResolvedValue('session-jwt'),
  openImpl: vi.fn().mockReturnValue({ closed: false }), // a truthy Window
  ...overrides,
});

describe('startGuardAuthorization', () => {
  it("returns 'disabled' without a token or an open when the base resolves to null (dev-harness mock)", async () => {
    const deps = makeDeps({ guardUrl: null });
    const status = await startGuardAuthorization(deps);
    expect(status).toBe('disabled');
    expect(deps.openImpl).not.toHaveBeenCalled();
    expect(deps.sessionTokenProvider).not.toHaveBeenCalled();
  });

  it("opens the RELATIVE /oauth/start (same-origin) when the base is '' — a real build's default", async () => {
    const deps = makeDeps({ guardUrl: '' });
    const status = await startGuardAuthorization(deps);
    expect(status).toBe('opened');
    expect(deps.openImpl).toHaveBeenCalledTimes(1);
    expect(deps.openImpl).toHaveBeenCalledWith('/oauth/start?st=session-jwt');
  });

  it('opens <guardUrl>/oauth/start with the sessionToken in the st query param', async () => {
    const deps = makeDeps();
    const status = await startGuardAuthorization(deps);
    expect(status).toBe('opened');
    expect(deps.openImpl).toHaveBeenCalledWith('https://guard.example/oauth/start?st=session-jwt');
  });

  it('a trailing slash on the configured guard URL does not double the path separator', async () => {
    const deps = makeDeps({ guardUrl: 'https://guard.example/' });
    await startGuardAuthorization(deps);
    expect(deps.openImpl).toHaveBeenCalledWith('https://guard.example/oauth/start?st=session-jwt');
  });

  it('URL-encodes a sessionToken that contains reserved characters', async () => {
    const deps = makeDeps({
      guardUrl: '',
      sessionTokenProvider: vi.fn().mockResolvedValue('a b+c/d=e&f'),
    });
    await startGuardAuthorization(deps);
    expect(deps.openImpl).toHaveBeenCalledWith('/oauth/start?st=a%20b%2Bc%2Fd%3De%26f');
  });

  it("returns 'blocked' when the opener returns null (pop-up blocked) — and does not throw", async () => {
    const deps = makeDeps({ openImpl: vi.fn().mockReturnValue(null) });
    expect(await startGuardAuthorization(deps)).toBe('blocked');
  });

  it("returns 'failed' — never throws — when the sessionToken provider rejects, and never opens", async () => {
    const deps = makeDeps({
      sessionTokenProvider: vi.fn().mockRejectedValue(new Error('no monday context')),
    });
    const status = await startGuardAuthorization(deps);
    expect(status).toBe('failed');
    expect(deps.openImpl).not.toHaveBeenCalled();
  });

  it("returns 'failed' — never throws — when the opener itself throws", async () => {
    const deps = makeDeps({
      openImpl: vi.fn(() => { throw new Error('window.open unavailable'); }),
    });
    await expect(startGuardAuthorization(deps)).resolves.toBe('failed');
  });
});
