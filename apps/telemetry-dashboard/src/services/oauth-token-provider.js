// OAuth token provider (Change #144) — the refresh-aware wrapper between the
// stored owner-token record and every consumer (monday-api's per-request
// getToken, the Settings status/disconnect routes). Mirrors sync-calender's
// ensureMicrosoftAccessToken shape: expiry cushion → refresh → persist the
// ROTATED refresh token; invalid_grant flags the record reauth_required.
//
// Concurrency: monday refresh tokens are SINGLE-USE. Two overlapping
// refreshes would burn the rotation (the second presents an already-rotated
// token → invalid_grant → false reauth). All refreshes therefore go through
// a single-flight in-process mutex, and the winner re-reads the record
// (cache invalidated) before spending the token — if another path already
// rotated it, the refresh is skipped.
//
// 401-retry-once is DELIBERATELY not implemented: the token is resolved per
// monday-api request and the 5-minute cushion makes a mid-flight expiry
// require a >5-minute request; the realistic 401 causes (external
// revocation) are not fixed by a retry. Revisit only if Axiom shows real
// unauthorized api_latency events post-migration.
//
// PRIVACY: log events carry codes/flags only — never token material.
//
// All collaborators are injected — this module imports nothing.

// Refresh proactively when less than this remains on the access token.
export const REFRESH_CUSHION_MS = 5 * 60_000;

/**
 * @param {object} deps
 * @param {ReturnType<import('./storage.js').createStorageService>} deps.storage
 * @param {ReturnType<import('./monday-oauth-client.js').createMondayOauthClient>} deps.oauthClient
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @param {() => number} [deps.now=Date.now]
 * @returns {{
 *   getFreshAccessToken: () => Promise<string|null>,
 *   getStatus: () => Promise<'connected'|'disconnected'|'reauth_required'>,
 *   disconnect: () => Promise<{ revoked: boolean }>,
 * }}
 */
export function createOauthTokenProvider({ storage, oauthClient, logger, now = Date.now }) {
  /** @type {Promise<string|null>|null} single-flight refresh gate */
  let refreshInFlight = null;

  function isFresh(record) {
    return (
      typeof record?.expiresAt === 'number' && record.expiresAt - now() > REFRESH_CUSHION_MS
    );
  }

  async function doRefresh() {
    // Re-read through the backend (not the 60s cache): another path may have
    // rotated the pair between the caller's read and this mutex acquisition.
    storage.invalidateTokenCache();
    const record = await storage.getOwnerTokenRecord();
    if (!record || record.status === 'reauth_required') return null;
    if (!record.refreshToken) return record.accessToken ?? null;
    if (isFresh(record)) return record.accessToken;

    try {
      const rotated = await oauthClient.refresh(record.refreshToken);
      if (rotated.expUndecodable) {
        // Opaque exp → the client substituted now+FALLBACK_TTL_MS; flag it.
        logger.warn('oauth_jwt_exp_undecodable', 'oauth', {});
      }
      await storage.setOwnerTokenRecord({
        v: 2,
        accessToken: rotated.accessToken,
        // No rotation in the response → the previous refresh token stays valid.
        refreshToken: rotated.refreshToken ?? record.refreshToken,
        expiresAt: rotated.expiresAtMs,
        obtainedAt: record.obtainedAt ?? now(), // 6-month anchor survives rotation
        refreshedAt: now(),
        status: 'active',
      });
      logger.info('oauth_token_refreshed', 'oauth', {});
      return rotated.accessToken;
    } catch (err) {
      if (err?.code === 'refresh_token_invalid') {
        // Permanently dead (rotated-away / revoked / 6-month lifetime hit):
        // flag the record so the Settings UI shows the re-authorize CTA and
        // no further refresh is ever attempted on it.
        await storage.setOwnerTokenRecord({
          ...record,
          accessToken: null,
          refreshToken: null,
          status: 'reauth_required',
        });
        logger.warn('oauth_refresh_invalid_grant', 'oauth', {});
        return null;
      }
      logger.error('oauth_refresh_transient_error', 'oauth', {
        code: String(err?.code ?? ''),
        error: String(err?.message ?? err),
      });
      // Stale-but-valid: inside the cushion but not hard-expired the current
      // token still works — return it and let a later call retry the refresh.
      if (typeof record.expiresAt === 'number' && record.expiresAt > now()) {
        return record.accessToken;
      }
      return null;
    }
  }

  return {
    /**
     * The write credential for monday-api, refreshed proactively. null =
     * no usable OAuth token (caller falls back to the env personal token).
     */
    async getFreshAccessToken() {
      const record = await storage.getOwnerTokenRecord();
      if (!record || record.status === 'reauth_required') return null;
      // Legacy v1 record (bare-string token): non-expiring, never refreshed.
      if (!record.refreshToken) return record.accessToken ?? null;
      if (isFresh(record)) return record.accessToken;

      if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => {
          refreshInFlight = null;
        });
      }
      return refreshInFlight;
    },

    /** Connection state for the Settings UI. */
    async getStatus() {
      const record = await storage.getOwnerTokenRecord();
      if (!record) return 'disconnected';
      if (record.status === 'reauth_required') return 'reauth_required';
      return record.accessToken ? 'connected' : 'disconnected';
    },

    /**
     * Disconnect: best-effort revocation of both tokens, then ALWAYS clear
     * the stored record (user intent wins even when monday is unreachable).
     */
    async disconnect() {
      const record = await storage.getOwnerTokenRecord();
      let attempted = 0;
      let succeeded = 0;
      if (record) {
        for (const [token, hint] of [
          [record.refreshToken, 'refresh_token'],
          [record.accessToken, 'access_token'],
        ]) {
          if (!token) continue;
          attempted += 1;
          const out = await oauthClient.revoke(token, hint);
          if (out.success) {
            succeeded += 1;
          } else {
            logger.warn('oauth_revoke_failed', 'oauth', { hint, error: String(out.error ?? '') });
          }
        }
        await storage.clearOwnerToken();
      }
      const revoked = attempted > 0 && succeeded === attempted;
      logger.info('oauth_disconnected', 'oauth', { revoked });
      return { revoked };
    },
  };
}
