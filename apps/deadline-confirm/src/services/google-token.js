// The Google access-token lifecycle, extracted VERBATIM from
// services/gmail-sender.js so the SMTP XOAUTH2 channel (the wired send path —
// docs/amp-email-verified-findings.md §2) and the kept-for-reference Gmail API
// sender share ONE implementation instead of drifting copies.
//
// Semantics preserved from the extraction source, all characterized by
// tests/gmail-sender.test.js:
//  - an in-process memo PER ACCOUNT holds the access token so a 200-recipient
//    digest performs ONE refresh, not 200;
//  - refresh happens inside a 60s cushion before the stored expiry, via the
//    provider layer (providers/google/oauth.js), and the fresh token is
//    persisted so a container restart does not re-refresh;
//  - `invalid_grant` — and ONLY `invalid_grant` — trips the kill switch
//    (disconnectedAt + lastError on the record); a transient 5xx must not, or
//    one bad minute at Google silences a tenant until someone notices;
//  - error codes are part of the seam contract and stay exactly:
//    google_not_connected / google_disconnected / google_refresh_failed.

import { refreshGoogleAccessToken } from './providers/google/oauth.js';
import { logError } from '../helpers/logger.js';

/** Refresh this long before the stored expiry. */
const REFRESH_CUSHION_MS = 60_000;

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Build the per-account token source both senders consume.
 *
 * @param {object} deps
 * @param {ReturnType<import('./storage.js').createAppStorage>} deps.storage
 * @param {string} [deps.clientId] - app-level fallback OAuth client id
 * @param {string} [deps.clientSecret] - app-level fallback OAuth client secret
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @returns {{
 *   senderFor(accountId: string): Promise<{ record: object, accessToken: string }>,
 *   forceRefresh(accountId: string): Promise<{ record: object, accessToken: string }>,
 *   markDisconnected(accountId: string, lastError: string): Promise<void>,
 * }}
 */
export function createGoogleTokenSource({ storage, clientId, clientSecret, fetchImpl = globalThis.fetch, now = Date.now }) {
  /** @type {Map<string, { accessToken: string, accessTokenExpiresAt: number }>} */
  const memo = new Map();

  /** Load the tenant record, refusing absent and dead connections distinctly. */
  async function loadRecord(scoped, accountId) {
    const record = await scoped.getGoogleSender();
    if (!record || !record.refreshToken) {
      throw fail('google_not_connected', `tenant ${accountId} has no Google sender connected`);
    }
    if (record.disconnectedAt) {
      throw fail('google_disconnected', `tenant ${accountId} Google sender is disconnected`);
    }
    return record;
  }

  function valid(token) {
    return Boolean(token?.accessToken) && token.accessTokenExpiresAt - REFRESH_CUSHION_MS > now();
  }

  /**
   * A usable access token for the tenant: memo → stored → refresh. A refresh
   * persists the fresh token so a container restart does not re-refresh.
   */
  async function accessTokenFor({ scoped, accountId, record, force = false }) {
    if (!force && valid(memo.get(accountId))) return memo.get(accountId).accessToken;
    if (!force && valid(record)) {
      memo.set(accountId, { accessToken: record.accessToken, accessTokenExpiresAt: record.accessTokenExpiresAt });
      return record.accessToken;
    }

    let refreshed;
    try {
      refreshed = await refreshGoogleAccessToken({
        refreshToken: record.refreshToken,
        clientId: record.clientId || clientId,
        clientSecret: record.clientSecret || clientSecret,
        fetchImpl,
        now,
      });
    } catch (err) {
      // Only a dead grant flips the switch. Everything else stays connected so
      // the next run retries — the provider layer made that distinction for us.
      if (err?.code === 'google_invalid_grant') {
        memo.delete(accountId);
        await scoped.setGoogleSender({ ...record, disconnectedAt: now(), lastError: 'google_invalid_grant' });
        logError('google-token', 'Google sender disconnected — reconnect required', { accountId });
        throw fail('google_disconnected', `tenant ${accountId} Google grant is dead`);
      }
      logError('google-token', 'access token refresh failed', {
        accountId,
        status: err?.status,
        error: String(err?.message ?? err),
      });
      throw fail('google_refresh_failed', `tenant ${accountId} token refresh failed`, { status: err?.status });
    }

    memo.set(accountId, refreshed);
    await scoped.setGoogleSender({ ...record, ...refreshed });
    return refreshed.accessToken;
  }

  return {
    async senderFor(accountId) {
      const scoped = storage.forAccount(accountId);
      const record = await loadRecord(scoped, accountId);
      const accessToken = await accessTokenFor({ scoped, accountId, record });
      return { record, accessToken };
    },

    /**
     * The one-shot retry lever: bypass memo AND stored token, mint a fresh one.
     * Callers use it exactly once per send when the server disagrees with the
     * stored expiry (Gmail 401 / SMTP EAUTH) — never in a loop.
     */
    async forceRefresh(accountId) {
      const scoped = storage.forAccount(accountId);
      const record = await loadRecord(scoped, accountId);
      const accessToken = await accessTokenFor({ scoped, accountId, record, force: true });
      return { record, accessToken };
    },

    /**
     * Channel-level kill switch (e.g. SMTP 535 after a forced refresh): mark
     * the record dead so /api/state surfaces it and every later send refuses
     * with google_disconnected. A missing record is a no-op — never invented.
     */
    async markDisconnected(accountId, lastError) {
      const scoped = storage.forAccount(accountId);
      const record = await scoped.getGoogleSender();
      if (!record) return;
      memo.delete(accountId);
      await scoped.setGoogleSender({ ...record, disconnectedAt: now(), lastError });
      logError('google-token', 'Google sender disconnected — reconnect required', { accountId, lastError });
    },
  };
}
