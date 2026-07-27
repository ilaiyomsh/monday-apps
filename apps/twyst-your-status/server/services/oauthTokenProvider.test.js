import { describe, expect, it, vi } from 'vitest';
import { MAX_AUTHORIZATION_AGE_MS, createOauthTokenProvider } from './oauthTokenProvider.js';

function record(overrides = {}) {
  return {
    v: 2,
    accessToken: 'access-old',
    refreshToken: 'refresh-old',
    expiresAt: 1_100_000,
    obtainedAt: 100,
    refreshedAt: null,
    status: 'active',
    ...overrides,
  };
}

function harness(initialRecord) {
  let stored = initialRecord ?? null;
  const store = {
    getOAuthTokenRecord: vi.fn(async () => stored),
    saveOAuthTokenRecord: vi.fn(async (_accountId, next) => { stored = next; return next; }),
    clearOAuthToken: vi.fn(async () => { stored = null; }),
  };
  const oauthClient = {
    refresh: vi.fn(),
    revoke: vi.fn().mockResolvedValue({ success: true }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const provider = createOauthTokenProvider({ store, oauthClient, logger, now: () => 1_000_000 });
  return { store, oauthClient, logger, provider, getStored: () => stored };
}

describe('createOauthTokenProvider', () => {
  it('reports disconnected and returns null when no record exists', async () => {
    const { provider } = harness(null);
    await expect(provider.getStatus('account-1')).resolves.toBe('disconnected');
    await expect(provider.getFreshAccessToken('account-1')).resolves.toBeNull();
  });

  it('returns a fresh access token without spending the refresh token', async () => {
    const { provider, oauthClient } = harness(record({ expiresAt: 1_400_001 }));
    await expect(provider.getFreshAccessToken('account-1')).resolves.toBe('access-old');
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('keeps a legacy bare-token record usable without refresh', async () => {
    const { provider, oauthClient } = harness(record({
      v: 1, refreshToken: null, expiresAt: null,
    }));
    await expect(provider.getFreshAccessToken('account-1')).resolves.toBe('access-old');
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it('requires a fresh authorization when the original grant reaches six months', async () => {
    const { provider, oauthClient, getStored, logger } = harness(record({
      obtainedAt: 1_000_000 - MAX_AUTHORIZATION_AGE_MS,
      expiresAt: 2_000_000,
    }));

    await expect(provider.getFreshAccessToken('account-1')).resolves.toBeNull();
    expect(oauthClient.refresh).not.toHaveBeenCalled();
    expect(getStored()).toMatchObject({
      accessToken: null,
      refreshToken: null,
      status: 'reauth_required',
    });
    expect(logger.warn).toHaveBeenCalledWith('oauth_authorization_expired', 'oauth', {
      accountId: 'account-1',
    });
  });

  it('persists a rotated refresh token while preserving the original authorization anchor', async () => {
    const { provider, oauthClient, store, getStored } = harness(record());
    oauthClient.refresh.mockResolvedValue({
      accessToken: 'access-new', refreshToken: 'refresh-new', expiresAtMs: 2_000_000,
      expUndecodable: false,
    });

    await expect(provider.getFreshAccessToken('account-1')).resolves.toBe('access-new');
    expect(oauthClient.refresh).toHaveBeenCalledWith('refresh-old');
    expect(store.saveOAuthTokenRecord).toHaveBeenCalledWith('account-1', {
      v: 2,
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresAt: 2_000_000,
      obtainedAt: 100,
      refreshedAt: 1_000_000,
      status: 'active',
    });
    expect(getStored().refreshToken).toBe('refresh-new');
  });

  it('single-flights concurrent refreshes for the same account', async () => {
    const { provider, oauthClient } = harness(record());
    let release;
    oauthClient.refresh.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = provider.getFreshAccessToken('account-1');
    const second = provider.getFreshAccessToken('account-1');
    await vi.waitFor(() => expect(oauthClient.refresh).toHaveBeenCalledTimes(1));
    release({
      accessToken: 'access-new', refreshToken: 'refresh-new', expiresAtMs: 2_000_000,
      expUndecodable: false,
    });
    await expect(Promise.all([first, second])).resolves.toEqual(['access-new', 'access-new']);
  });

  it('marks an invalid refresh grant as reauthorization required', async () => {
    const { provider, oauthClient, getStored, logger } = harness(record());
    oauthClient.refresh.mockRejectedValue(Object.assign(new Error('invalid'), {
      code: 'refresh_token_invalid',
    }));

    await expect(provider.getFreshAccessToken('account-1')).resolves.toBeNull();
    expect(getStored()).toMatchObject({
      accessToken: null, refreshToken: null, status: 'reauth_required', obtainedAt: 100,
    });
    expect(logger.warn).toHaveBeenCalledWith('oauth_refresh_invalid_grant', 'oauth', {
      accountId: 'account-1',
    });
    await expect(provider.getStatus('account-1')).resolves.toBe('reauth_required');
  });

  it('returns a still-valid stale token after a transient refresh failure but not an expired one', async () => {
    const transient = Object.assign(new Error('offline'), { code: 'refresh_transient' });
    const first = harness(record({ expiresAt: 1_000_001 }));
    first.oauthClient.refresh.mockRejectedValue(transient);
    await expect(first.provider.getFreshAccessToken('account-1')).resolves.toBe('access-old');

    const second = harness(record({ expiresAt: 1_000_000 }));
    second.oauthClient.refresh.mockRejectedValue(transient);
    await expect(second.provider.getFreshAccessToken('account-1')).resolves.toBeNull();
    expect(second.logger.error).toHaveBeenCalledWith('oauth_refresh_transient_error', 'oauth', {
      accountId: 'account-1', code: 'refresh_transient', error: 'offline',
    });
  });

  it('revokes both token kinds and always clears local state when one revoke fails', async () => {
    const { provider, oauthClient, store, logger } = harness(record());
    oauthClient.revoke
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(Object.assign(new Error('gateway'), { code: 'revoke_http' }));

    await expect(provider.disconnect('account-1')).resolves.toEqual({ revoked: false });
    expect(oauthClient.revoke.mock.calls).toEqual([
      ['refresh-old', 'refresh_token'],
      ['access-old', 'access_token'],
    ]);
    expect(store.clearOAuthToken).toHaveBeenCalledWith('account-1');
    expect(logger.warn).toHaveBeenCalledWith('oauth_revoke_failed', 'oauth', {
      accountId: 'account-1', hint: 'access_token', code: 'revoke_http',
    });
  });
});
