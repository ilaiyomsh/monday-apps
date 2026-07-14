// monday OAuth authorization-code flow (spec §8). Opened in a NEW TAB by the
// admin view (auth.monday.com may refuse the iframe). Tokens do not expire
// and there is no refresh token — a later 401 means revoked ("broken").

import crypto from 'node:crypto';
import express from 'express';
import { oauthDonePage, oauthErrorPage } from '../helpers/pages.js';
import { logError, logInfo } from '../helpers/logger.js';

export const OAUTH_SCOPES = 'me:read boards:read boards:write updates:write';
export const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
export const TOKEN_URL = 'https://auth.monday.com/oauth2/token';

/**
 * Build the /oauth router — see the stub JSDoc contract (git history) and
 * tests/oauth.test.js for the behavioral spec.
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {ReturnType<import('../services/monday-api.js').createMondayApi>} deps.api
 * @param {{ clientId: string, clientSecret: string, baseUrl: string }} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @returns {import('express').Router}
 */
export function createOauthRouter({ storage, api, env, fetchImpl }) {
  const router = express.Router();
  const doFetch = fetchImpl ?? globalThis.fetch;
  const redirectUri = `${env.baseUrl}/oauth/callback`;

  function sendPage(res, status, html) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  }

  router.get('/oauth/start', async (_req, res) => {
    try {
      const nonce = crypto.randomBytes(16).toString('base64url');
      await storage.issueOauthState(nonce);
      const params = new URLSearchParams({
        client_id: env.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES,
        state: nonce,
      });
      res.redirect(`${AUTHORIZE_URL}?${params}`);
    } catch (err) {
      logError('oauth', 'start failed', { error: String(err?.message ?? err) });
      sendPage(res, 500, oauthErrorPage());
    }
  });

  router.get('/oauth/callback', async (req, res) => {
    const { code, state, error: consentError } = req.query;
    try {
      if (consentError) {
        logError('oauth', 'consent denied', { cause: String(consentError) });
        sendPage(res, 200, oauthErrorPage('החיבור בוטל'));
        return;
      }
      if (typeof code !== 'string' || code.length === 0 || typeof state !== 'string' || state.length === 0) {
        sendPage(res, 400, oauthErrorPage('בקשה חסרה'));
        return;
      }

      // CSRF nonce — single-use, expiring (spec §13).
      const stateValid = await storage.consumeOauthState(state);
      if (!stateValid) {
        logError('oauth', 'invalid or replayed state nonce', {});
        sendPage(res, 400, oauthErrorPage('הקישור פג תוקף'));
        return;
      }

      const exchangeRes = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.clientId,
          client_secret: env.clientSecret,
          redirect_uri: redirectUri,
        }),
      });

      if (!exchangeRes.ok) {
        let detail = '';
        try {
          detail = (await exchangeRes.text()).slice(0, 200);
        } catch {
          // body unreadable — status alone is logged below
        }
        logError('oauth', 'token exchange failed', { status: exchangeRes.status, detail });
        sendPage(res, 502, oauthErrorPage());
        return;
      }

      const tokens = await exchangeRes.json();
      const accessToken = tokens?.access_token;
      if (!accessToken) {
        logError('oauth', 'token exchange returned no access_token', {});
        sendPage(res, 502, oauthErrorPage());
        return;
      }

      await storage.setOauthToken(accessToken);

      // Best-effort identity fetch for the admin display — never fails the flow.
      try {
        const me = await api.fetchMe({ token: accessToken });
        await storage.setOauthIdentity({ id: me.id, name: me.name });
        logInfo('oauth', 'connected', { name: me.name });
      } catch (err) {
        logError('oauth', 'identity fetch failed (connection still stored)', {
          error: String(err?.message ?? err),
        });
      }

      sendPage(res, 200, oauthDonePage());
    } catch (err) {
      logError('oauth', 'callback failed', { error: String(err?.message ?? err) });
      sendPage(res, 500, oauthErrorPage());
    }
  });

  return router;
}
