export const REFRESH_CUSHION_MS = 5 * 60_000;
export const MAX_AUTHORIZATION_AGE_MS = 180 * 24 * 60 * 60_000;

export function createOauthTokenProvider({ store, oauthClient, logger, now = Date.now } = {}) {
  if (!store || !oauthClient || !logger) {
    throw new TypeError('store, oauthClient, and logger are required.');
  }
  const refreshes = new Map();

  function isFresh(record) {
    return Number.isFinite(record?.expiresAt)
      && record.expiresAt - now() > REFRESH_CUSHION_MS;
  }

  function authorizationExpired(record) {
    return record?.v === 2
      && Number.isFinite(record.obtainedAt)
      && now() - record.obtainedAt >= MAX_AUTHORIZATION_AGE_MS;
  }

  async function requireReauthorization(accountId, record) {
    await store.saveOAuthTokenRecord(accountId, {
      ...record,
      accessToken: null,
      refreshToken: null,
      status: 'reauth_required',
    });
    logger.warn('oauth_authorization_expired', 'oauth', { accountId });
    return null;
  }

  async function refreshAccount(accountId) {
    const record = await store.getOAuthTokenRecord(accountId);
    if (!record || record.status === 'reauth_required') return null;
    if (authorizationExpired(record)) return requireReauthorization(accountId, record);
    if (!record.refreshToken) return record.accessToken ?? null;
    if (isFresh(record)) return record.accessToken;

    try {
      const rotated = await oauthClient.refresh(record.refreshToken);
      if (rotated.expUndecodable) {
        logger.warn('oauth_jwt_exp_undecodable', 'oauth', { accountId });
      }
      await store.saveOAuthTokenRecord(accountId, {
        v: 2,
        accessToken: rotated.accessToken,
        refreshToken: rotated.refreshToken ?? record.refreshToken,
        expiresAt: rotated.expiresAtMs,
        obtainedAt: record.obtainedAt ?? now(),
        refreshedAt: now(),
        status: 'active',
      });
      logger.info('oauth_token_refreshed', 'oauth', { accountId });
      return rotated.accessToken;
    } catch (error) {
      if (error?.code === 'refresh_token_invalid') {
        await store.saveOAuthTokenRecord(accountId, {
          ...record,
          accessToken: null,
          refreshToken: null,
          status: 'reauth_required',
        });
        logger.warn('oauth_refresh_invalid_grant', 'oauth', { accountId });
        return null;
      }
      logger.error('oauth_refresh_transient_error', 'oauth', {
        accountId,
        code: String(error?.code ?? ''),
        error: String(error?.message ?? error),
      });
      return Number.isFinite(record.expiresAt) && record.expiresAt > now()
        ? record.accessToken
        : null;
    }
  }

  return {
    async getFreshAccessToken(accountId) {
      const record = await store.getOAuthTokenRecord(accountId);
      if (!record || record.status === 'reauth_required') return null;
      if (authorizationExpired(record)) return requireReauthorization(accountId, record);
      if (!record.refreshToken || isFresh(record)) return record.accessToken ?? null;

      if (!refreshes.has(accountId)) {
        const refresh = refreshAccount(accountId).finally(() => refreshes.delete(accountId));
        refreshes.set(accountId, refresh);
      }
      return refreshes.get(accountId);
    },

    async getStatus(accountId) {
      const record = await store.getOAuthTokenRecord(accountId);
      if (!record) return 'disconnected';
      if (record.status === 'reauth_required') return 'reauth_required';
      if (authorizationExpired(record)) {
        await requireReauthorization(accountId, record);
        return 'reauth_required';
      }
      return record.accessToken ? 'connected' : 'disconnected';
    },

    async disconnect(accountId) {
      const record = await store.getOAuthTokenRecord(accountId);
      let attempted = 0;
      let succeeded = 0;
      if (record) {
        for (const [token, hint] of [
          [record.refreshToken, 'refresh_token'],
          [record.accessToken, 'access_token'],
        ]) {
          if (!token) continue;
          attempted += 1;
          try {
            await oauthClient.revoke(token, hint);
            succeeded += 1;
          } catch (error) {
            logger.warn('oauth_revoke_failed', 'oauth', {
              accountId,
              hint,
              code: String(error?.code ?? ''),
            });
          }
        }
      }
      await store.clearOAuthToken(accountId);
      const revoked = attempted > 0 && succeeded === attempted;
      logger.info('oauth_disconnected', 'oauth', { accountId, revoked });
      return { revoked };
    },
  };
}
