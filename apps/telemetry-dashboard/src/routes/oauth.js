// OAuth app-identity token flow (Change #143 continuation) — replaces the
// need for a personal MONDAY_API_TOKEN. A single OWNER authorizes ONCE at
// GET /oauth/start; GET /oauth/callback exchanges the code and stores the
// resulting token (services/storage.js, key owner:oauth_token) so
// services/monday-api.js can resolve it per call for board writes.
//
// Modeled on deadline-confirm's src/routes/oauth.js, simplified: this app has
// no per-account tenancy and no monday sessionToken gate on /start (there is
// exactly one operator) — mirrors the exchange-request shape and error
// handling idioms only.
//
// PRIVACY: every catch logs via the injected logger with safe, structured
// context — the authorization `code` and the exchanged access token are
// NEVER logged, not even on failure.
//
// All collaborators are injected — this module imports nothing but express.

import express from 'express';

export const OAUTH_SCOPES = 'boards:read boards:write me:read';
export const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
export const TOKEN_URL = 'https://auth.monday.com/oauth2/token';
export const ME_URL = 'https://api.monday.com/v2';
const API_VERSION = '2026-04'; // matches services/monday-api.js's pin

const ME_QUERY = 'query { me { account { id } } }';

const DONE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Authorized</title></head>' +
  '<body><p>Authorized ✓ you can close this tab.</p></body></html>';

/**
 * @param {object} deps
 * @param {{ mondayClientId: string, clientSecret: string, baseUrl: string, allowedAccountIds: string[] }} deps.env
 * @param {ReturnType<import('../services/storage.js').createStorageService>} deps.storage
 * @param {object} deps.logger - app logger (`(message, tag, context)` shape)
 * @param {typeof fetch} [deps.fetchImpl]
 * @returns {import('express').Router}
 */
export function createOauthRouter({ env, storage, logger, fetchImpl }) {
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

  router.get('/start', (_req, res) => {
    try {
      const params = new URLSearchParams({
        client_id: env.mondayClientId,
        redirect_uri: redirectUri,
        scope: OAUTH_SCOPES,
      });
      res.redirect(`${AUTHORIZE_URL}?${params}`);
    } catch (err) {
      logger.error('oauth_start_failed', 'oauth', { error: String(err?.message ?? err) });
      sendHtml(res, 500, '<p>Authorization failed.</p>');
    }
  });

  router.get('/callback', async (req, res) => {
    const { code, error: consentError } = req.query;
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

      let exchangeRes;
      try {
        exchangeRes = await doFetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.mondayClientId,
            client_secret: env.clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        });
      } catch (err) {
        logger.error('oauth_token_exchange_network_error', 'oauth', {
          error: String(err?.message ?? err),
        });
        sendHtml(res, 502, '<p>Authorization failed.</p>');
        return;
      }

      if (!exchangeRes.ok) {
        logger.error('oauth_token_exchange_failed', 'oauth', { status: exchangeRes.status });
        sendHtml(res, 502, '<p>Authorization failed.</p>');
        return;
      }

      let tokens;
      try {
        tokens = await exchangeRes.json();
      } catch (err) {
        logger.error('oauth_token_exchange_bad_json', 'oauth', {
          error: String(err?.message ?? err),
        });
        sendHtml(res, 502, '<p>Authorization failed.</p>');
        return;
      }

      const accessToken = tokens?.access_token;
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        logger.error('oauth_token_exchange_no_token', 'oauth', {});
        sendHtml(res, 502, '<p>Authorization failed.</p>');
        return;
      }

      if (Array.isArray(env.allowedAccountIds) && env.allowedAccountIds.length > 0) {
        let accountId = null;
        try {
          accountId = await fetchAccountId(accessToken);
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

      await storage.setOwnerToken(accessToken);
      logger.info('oauth_owner_authorized', 'oauth', {});
      sendHtml(res, 200, DONE_HTML);
    } catch (err) {
      logger.error('oauth_callback_failed', 'oauth', { error: String(err?.message ?? err) });
      sendHtml(res, 500, '<p>Authorization failed.</p>');
    }
  });

  return router;
}
