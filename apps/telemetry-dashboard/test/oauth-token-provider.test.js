// Contract tests for src/services/oauth-token-provider.js — the refresh-aware
// wrapper around the stored owner-token record (mirrors sync-calender's
// ensureMicrosoftAccessToken shape): proactive refresh inside the 5-minute
// cushion, single-flight mutex (refresh tokens are SINGLE-USE — a concurrent
// double-refresh burns the rotation), rotated-refresh persistence,
// invalid_grant → reauth_required, transient failure → stale-but-valid.
// Storage is the REAL createStorageService over an in-memory backend so
// persistence is asserted through the actual cache/read path.

import { describe, it, expect, vi } from 'vitest';
import {
  createOauthTokenProvider,
  REFRESH_CUSHION_MS,
} from '../src/services/oauth-token-provider.js';
import { FALLBACK_TTL_MS } from '../src/services/monday-oauth-client.js';
import { createStorageService, OWNER_TOKEN_KEY } from '../src/services/storage.js';

const NOW = 1_784_700_000_000;

function makeLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function makeBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
    set: vi.fn(async (key, value) => {
      map.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      map.delete(key);
    }),
    map,
  };
}

function record(overrides = {}) {
  return {
    v: 2,
    accessToken: 'at-current',
    refreshToken: 'rt-current',
    expiresAt: NOW + 60 * 60_000, // fresh: an hour out
    obtainedAt: NOW - 24 * 60 * 60_000,
    refreshedAt: null,
    status: 'active',
    ...overrides,
  };
}

function makeHarness({ stored, refreshImpl, revokeImpl, now = () => NOW } = {}) {
  const logger = makeLogger();
  const backend = makeBackend(stored === undefined ? {} : { [OWNER_TOKEN_KEY]: stored });
  const storage = createStorageService({ backend, logger, now });
  const oauthClient = {
    refresh: vi.fn(
      refreshImpl ??
        (async () => ({
          accessToken: 'at-refreshed',
          refreshToken: 'rt-rotated',
          expiresAtMs: NOW + 55 * 60_000,
          expUndecodable: false,
        }))
    ),
    revoke: vi.fn(revokeImpl ?? (async () => ({ success: true }))),
  };
  const provider = createOauthTokenProvider({ storage, oauthClient, logger, now });
  return { provider, storage, backend, oauthClient, logger };
}

/** Every argument ever passed to any logger method, flattened to one string. */
function allLoggerArgs(logger) {
  return ['error', 'warn', 'info', 'debug']
    .flatMap((method) => logger[method].mock.calls)
    .map((args) => JSON.stringify(args))
    .join('\n');
}

describe('getFreshAccessToken — passthrough paths (no refresh call)', () => {
  it('resolves null when no record is stored', async () => {
    const { provider, oauthClient } = makeHarness();
    await expect(provider.getFreshAccessToken()).resolves.toBeNull();
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('returns the access token untouched while outside the refresh cushion', async () => {
    const { provider, oauthClient } = makeHarness({ stored: record() });
    await expect(provider.getFreshAccessToken()).resolves.toBe('at-current');
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('a LEGACY record (bare-string normalization, no refresh token) passes through with zero refresh calls', async () => {
    const { provider, oauthClient } = makeHarness({ stored: 'at-legacy-bare' });
    await expect(provider.getFreshAccessToken()).resolves.toBe('at-legacy-bare');
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('resolves null (no refresh attempt) when the record is flagged reauth_required', async () => {
    const { provider, oauthClient } = makeHarness({
      stored: record({ accessToken: null, refreshToken: null, status: 'reauth_required' }),
    });
    await expect(provider.getFreshAccessToken()).resolves.toBeNull();
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });
});

describe('getFreshAccessToken — refresh path', () => {
  it('refreshes inside the cushion, persists the rotated pair and PRESERVES obtainedAt', async () => {
    const stored = record({ expiresAt: NOW + REFRESH_CUSHION_MS - 1_000 });
    const { provider, backend, oauthClient } = makeHarness({ stored });

    await expect(provider.getFreshAccessToken()).resolves.toBe('at-refreshed');

    expect(oauthClient.refresh).toHaveBeenCalledWith('rt-current');
    const persisted = backend.map.get(OWNER_TOKEN_KEY);
    expect(persisted).toMatchObject({
      v: 2,
      accessToken: 'at-refreshed',
      refreshToken: 'rt-rotated',
      expiresAt: NOW + 55 * 60_000,
      obtainedAt: stored.obtainedAt, // 6-month anchor survives rotation
      refreshedAt: NOW,
      status: 'active',
    });
  });

  it('keeps the PREVIOUS refresh token when the server does not rotate', async () => {
    const { provider, backend } = makeHarness({
      stored: record({ expiresAt: NOW + 1_000 }),
      refreshImpl: async () => ({
        accessToken: 'at-refreshed',
        refreshToken: null,
        expiresAtMs: NOW + 30 * 60_000,
        expUndecodable: false,
      }),
    });

    await provider.getFreshAccessToken();

    expect(backend.map.get(OWNER_TOKEN_KEY)).toMatchObject({ refreshToken: 'rt-current' });
  });

  it('an undecodable rotated-token exp falls back to now+FALLBACK_TTL_MS and warns (no token material logged)', async () => {
    const { provider, backend, logger } = makeHarness({
      stored: record({ expiresAt: NOW + 1_000 }),
      refreshImpl: async () => ({
        accessToken: 'at-opaque',
        refreshToken: 'rt-rotated',
        expiresAtMs: NOW + FALLBACK_TTL_MS,
        expUndecodable: true,
      }),
    });

    await provider.getFreshAccessToken();

    expect(backend.map.get(OWNER_TOKEN_KEY)).toMatchObject({ expiresAt: NOW + FALLBACK_TTL_MS });
    expect(logger.warn).toHaveBeenCalledWith('oauth_jwt_exp_undecodable', 'oauth', expect.any(Object));
    expect(allLoggerArgs(logger)).not.toContain('at-opaque');
  });

  it('SINGLE-FLIGHT: two concurrent callers share ONE refresh call and both resolve to the new token', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const { provider, oauthClient } = makeHarness({
      stored: record({ expiresAt: NOW + 1_000 }),
      refreshImpl: async () => {
        await gate;
        return {
          accessToken: 'at-refreshed',
          refreshToken: 'rt-rotated',
          expiresAtMs: NOW + 55 * 60_000,
          expUndecodable: false,
        };
      },
    });

    const p1 = provider.getFreshAccessToken();
    const p2 = provider.getFreshAccessToken();
    release();

    await expect(p1).resolves.toBe('at-refreshed');
    await expect(p2).resolves.toBe('at-refreshed');
    expect(oauthClient.refresh).toHaveBeenCalledTimes(1);
  });

  it('invalid_grant → flags reauth_required, resolves null, and NEVER refreshes again', async () => {
    const { provider, backend, oauthClient, logger } = makeHarness({
      stored: record({ expiresAt: NOW + 1_000 }),
      refreshImpl: async () => {
        throw Object.assign(new Error('invalid_grant'), { code: 'refresh_token_invalid' });
      },
    });

    await expect(provider.getFreshAccessToken()).resolves.toBeNull();

    expect(backend.map.get(OWNER_TOKEN_KEY)).toMatchObject({
      accessToken: null,
      refreshToken: null,
      status: 'reauth_required',
    });
    expect(logger.warn).toHaveBeenCalledWith('oauth_refresh_invalid_grant', 'oauth', expect.any(Object));

    // Subsequent calls short-circuit on the flagged record — no further refresh.
    await expect(provider.getFreshAccessToken()).resolves.toBeNull();
    expect(oauthClient.refresh).toHaveBeenCalledTimes(1);
  });

  it('a TRANSIENT failure returns the stale-but-still-valid token (and logs the error code only)', async () => {
    const { provider, logger } = makeHarness({
      stored: record({ expiresAt: NOW + 1_000 }), // inside cushion but NOT hard-expired
      refreshImpl: async () => {
        throw Object.assign(new Error('HTTP 503'), { code: 'refresh_transient' });
      },
    });

    await expect(provider.getFreshAccessToken()).resolves.toBe('at-current');
    expect(logger.error).toHaveBeenCalledWith(
      'oauth_refresh_transient_error',
      'oauth',
      expect.any(Object)
    );
  });

  it('a transient failure on a HARD-EXPIRED token resolves null', async () => {
    const { provider } = makeHarness({
      stored: record({ expiresAt: NOW - 1_000 }),
      refreshImpl: async () => {
        throw Object.assign(new Error('HTTP 503'), { code: 'refresh_transient' });
      },
    });

    await expect(provider.getFreshAccessToken()).resolves.toBeNull();
  });
});

describe('getStatus', () => {
  it('maps record states to connected / disconnected / reauth_required', async () => {
    const { provider: connected } = makeHarness({ stored: record() });
    await expect(connected.getStatus()).resolves.toBe('connected');

    const { provider: disconnected } = makeHarness();
    await expect(disconnected.getStatus()).resolves.toBe('disconnected');

    const { provider: reauth } = makeHarness({
      stored: record({ accessToken: null, refreshToken: null, status: 'reauth_required' }),
    });
    await expect(reauth.getStatus()).resolves.toBe('reauth_required');

    const { provider: legacy } = makeHarness({ stored: 'at-legacy' });
    await expect(legacy.getStatus()).resolves.toBe('connected');
  });
});

describe('disconnect', () => {
  it('revokes refresh + access tokens (typed hints) and ALWAYS clears the stored record', async () => {
    const { provider, backend, oauthClient, storage } = makeHarness({ stored: record() });

    await expect(provider.disconnect()).resolves.toEqual({ revoked: true });

    expect(oauthClient.revoke).toHaveBeenCalledWith('rt-current', 'refresh_token');
    expect(oauthClient.revoke).toHaveBeenCalledWith('at-current', 'access_token');
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
    await expect(storage.getOwnerTokenRecord()).resolves.toBeNull(); // cache cleared too
  });

  it('a failed best-effort revoke still clears storage and reports revoked:false', async () => {
    const { provider, backend, logger } = makeHarness({
      stored: record(),
      revokeImpl: async () => ({ success: false, error: 'HTTP 500' }),
    });

    await expect(provider.disconnect()).resolves.toEqual({ revoked: false });
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('oauth_revoke_failed', 'oauth', expect.any(Object));
  });

  it('disconnect with nothing stored is a no-op that reports revoked:false', async () => {
    const { provider, oauthClient } = makeHarness();
    await expect(provider.disconnect()).resolves.toEqual({ revoked: false });
    expect(oauthClient.revoke).not.toHaveBeenCalled();
  });
});

describe('privacy — no token material in any log call', () => {
  it('success, invalid_grant and transient paths never log token values', async () => {
    const harnesses = [
      makeHarness({ stored: record({ expiresAt: NOW + 1_000 }) }),
      makeHarness({
        stored: record({ expiresAt: NOW + 1_000 }),
        refreshImpl: async () => {
          throw Object.assign(new Error('invalid_grant'), { code: 'refresh_token_invalid' });
        },
      }),
      makeHarness({
        stored: record({ expiresAt: NOW + 1_000 }),
        refreshImpl: async () => {
          throw Object.assign(new Error('HTTP 503'), { code: 'refresh_transient' });
        },
      }),
    ];
    for (const h of harnesses) {
      await h.provider.getFreshAccessToken();
      await h.provider.disconnect();
      const logged = allLoggerArgs(h.logger);
      for (const secret of ['at-current', 'rt-current', 'at-refreshed', 'rt-rotated']) {
        expect(logged).not.toContain(secret);
      }
    }
  });
});
