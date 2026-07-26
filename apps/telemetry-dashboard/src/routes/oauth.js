// OAuth app-identity token flow — Change #143 (owner-token model), #144
// (monday OAuth 2.1). Replaces the need for a personal MONDAY_API_TOKEN. A
// single OWNER authorizes ONCE at GET /oauth/start; GET /oauth/callback
// exchanges the code and stores the resulting token RECORD
// (services/storage.js, key owner:oauth_token) so services/monday-api.js can
// resolve it per call (via the oauth-token-provider) for board writes.
//
// OAuth 2.1 (Change #144): /start issues a single-use CSRF `state` nonce and
// a PKCE S256 code_challenge (the verifier rides in the state record —
// deadline-confirm's nonce pattern); /callback consumes the state
// (replay/expiry → 400) and exchanges at monday's NEW oauth_ms token
// endpoint (services/monday-oauth-client.js) with grant_type + code_verifier.
// The stored record carries the ROTATING refresh token and the access
// token's decoded expiry — see oauth-token-provider.js for the refresh loop.
//
// Modeled on deadline-confirm's src/routes/oauth.js, simplified: this app has
// no per-account tenancy and no monday sessionToken gate on /start (there is
// exactly one operator) — mirrors the exchange-request shape and error
// handling idioms only.
//
// PRIVACY: every catch logs via the injected logger with safe, structured
// context — the authorization `code`, the `state` nonce, the PKCE verifier
// and both exchanged tokens are NEVER logged, not even on failure.
//
// Collaborators are injected — this module imports only express + node:crypto.

import crypto from 'node:crypto';
import express from 'express';

export const OAUTH_SCOPES = 'boards:read boards:write me:read';
export const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
export const ME_URL = 'https://api.monday.com/v2';
const API_VERSION = '2026-04'; // matches services/monday-api.js's pin

const ME_QUERY = 'query { me { account { id } } }';

const DONE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Authorized</title></head>' +
  '<body><p>Authorized ✓ you can close this tab.</p></body></html>';

/**
 * @param {object} deps
 * @param {{ mondayClientId: string, clientSecret: string, baseUrl: string,
 *           allowedAccountIds: string[], oauthAppVersionId?: string }} deps.env
 * @param {ReturnType<import('../services/storage.js').createStorageService>} deps.storage
 * @param {ReturnType<import('../services/monday-oauth-client.js').createMondayOauthClient>} deps.oauthClient
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @param {typeof fetch} [deps.fetchImpl] - the `me` identity check only
 * @returns {import('express').Router}
 */
export function createOauthRouter({ env, storage, logger, fetchImpl, oauthClient }) {
  const router = express.Router();
  const doFetch = fetchImpl ?? globalThis.fetch;
  const redirectUri = `${env.baseUrl}/oauth/callback`;

  function sendHtml(res, status, html) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  }

  /** Fetch the connecting account id via `me { account { id } }`. Throws on any failure. */
  async function fetchAccountId(accessToken) {
    const res = await doFetch(ME_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken, // raw token, no Bearer (monday convention)
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({ query: ME_QUERY }),
    });
    if (!res.ok) throw new Error(`monday API HTTP ${res.status}`);
    const payload = await res.json();
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      throw new Error(String(payload.errors[0]?.message ?? 'monday API error'));
    }
    const id = payload?.data?.me?.account?.id;
    return id == null ? null : String(id);
  }

  router.get('/start', async (_req, res) => {
    try {
      // PKCE (OAuth 2.1, S256-only): verifier 43-128 chars of unreserved
      // charset — randomBytes(32).toString('base64url') yields exactly 43.
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      // CSRF state nonce, single-use + expiring; carries the verifier to the
      // callback (deadline-confirm's oauth_state pattern).
      const nonce = crypto.randomBytes(16).toString('base64url');
      await storage.issueOauthState(nonce, { verifier });

      const params = new URLSearchParams({
        client_id: env.mondayClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES,
        state: nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      // OAuth config (scopes/redirects + the New OAuth Flow toggle) is per
      // app version — during draft testing the authorize request must name
      // the draft version explicitly.
      if (env.oauthAppVersionId) params.set('app_version_id', env.oauthAppVersionId);
      res.redirect(`${AUTHORIZE_URL}?${params}`);
    } catch (err) {
      logger.error('oauth_start_failed', 'oauth', { error: String(err?.message ?? err) });
      sendHtml(res, 500, '<p>Authorization failed.</p>');
    }
  });

  router.get('/callback', async (req, res) => {
    const { code, state, error: consentError } = req.query;
    try {
      if (consentError) {
        logger.warn('oauth_consent_denied', 'oauth', { reason: String(consentError) });
        sendHtml(res, 400, '<p>Authorization was cancelled.</p>');
        return;
      }
      if (typeof code !== 'string' || code.length === 0) {
        logger.warn('oauth_callback_missing_code', 'oauth', {});
        sendHtml(res, 400, '<p>Missing authorization code.</p>');
        return;
      }
      if (typeof state !== 'string' || state.length === 0) {
        logger.warn('oauth_callback_missing_state', 'oauth', {});
        sendHtml(res, 400, '<p>Missing state.</p>');
        return;
      }

      // Single-use CSRF nonce; also carries the PKCE verifier. Replay and
      // expiry are indistinguishable by design (both → invalid).
      const stateRecord = await storage.consumeOauthState(state);
      if (!stateRecord) {
        logger.warn('oauth_state_invalid', 'oauth', {});
        sendHtml(res, 400, '<p>This authorization link is invalid or expired — start again.</p>');
        return;
      }

      let tokens;
      try {
        tokens = await oauthClient.exchangeCode({
          code,
          verifier: stateRecord.verifier,
          redirectUri,
        });
      } catch (err) {
        // Map the client's machine codes onto the established log taxonomy.
        const errCode = String(err?.code ?? '');
        if (errCode === 'exchange_network') {
          logger.error('oauth_token_exchange_network_error', 'oauth', {
            error: String(err?.message ?? err),
          });
        } else if (errCode === 'exchange_bad_json') {
          logger.error('oauth_token_exchange_bad_json', 'oauth', {
            error: String(err?.message ?? err),
          });
        } else if (errCode === 'exchange_no_token') {
          logger.error('oauth_token_exchange_no_token', 'oauth', {});
        } else {
          logger.error('oauth_token_exchange_failed', 'oauth', { status: err?.status ?? null });
        }
        sendHtml(res, 502, '<p>Authorization failed.</p>');
        return;
      }

      if (Array.isArray(env.allowedAccountIds) && env.allowedAccountIds.length > 0) {
        let accountId = null;
        try {
          accountId = await fetchAccountId(tokens.accessToken);
        } catch (err) {
          // Cannot confirm the allowlist → fail closed, never store.
          logger.error('oauth_identity_check_failed', 'oauth', {
            error: String(err?.message ?? err),
          });
          sendHtml(res, 403, '<p>Authorization rejected.</p>');
          return;
        }
        if (!accountId || !env.allowedAccountIds.includes(accountId)) {
          logger.warn('oauth_account_not_allowlisted', 'oauth', {});
          sendHtml(res, 403, '<p>Authorization rejected.</p>');
          return;
        }
      }

      if (tokens.expUndecodable) {
        // Opaque exp → the client substituted now+FALLBACK_TTL_MS; flag it.
        logger.warn('oauth_jwt_exp_undecodable', 'oauth', {});
      }
      await storage.setOwnerTokenRecord({
        v: 2,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAtMs,
        obtainedAt: Date.now(), // the 6-month lifetime anchor
        refreshedAt: null,
        status: 'active',
      });
      logger.info('oauth_owner_authorized', 'oauth', {});
      sendHtml(res, 200, DONE_HTML);
    } catch (err) {
      logger.error('oauth_callback_failed', 'oauth', { error: String(err?.message ?? err) });
      sendHtml(res, 500, '<p>Authorization failed.</p>');
    }
  });

  return router;
}
