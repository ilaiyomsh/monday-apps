/**
 * oauth — one-time activation: an admin/board-owner grants the guard its
 * monday OAuth token (deadline-confirm's proven flow, spec §8 there).
 *
 * GET /oauth/start?st=<sessionToken>
 *   Verifies the sessionToken (client secret) — the connecting ACCOUNT comes
 *   from the JWT, never from a query param — issues a single-use state nonce
 *   bound to that account, and 302s to auth.monday.com with OAUTH_SCOPES.
 *
 * GET /oauth/callback?code&state
 *   Exchanges the code (client id+secret), asks `me` for the granting user,
 *   and stores the activation record { token, botUserId, botName } under
 *   `${accountId}:activation`. monday OAuth tokens do not expire; a later 401
 *   means revoked. Renders a tiny Hebrew done/error page (the tab was opened
 *   from settings and is closed by hand).
 *
 * State nonces are single-use with a 10-minute TTL, held in memory —
 * activation is a once-per-account act; a restart mid-flow means clicking
 * again, nothing worse.
 */

import crypto from 'node:crypto';
import express from 'express';
import { verifySessionToken } from '../middlewares/auth.js';

export const OAUTH_SCOPES = 'me:read account:read boards:read boards:write users:read teams:read webhooks:write notifications:write';
export const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
export const TOKEN_URL = 'https://auth.monday.com/oauth2/token';

const STATE_TTL_MS = 10 * 60 * 1000;
const TAG = 'oauth';

const page = (title, body) => `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: sans-serif; text-align: center; padding-top: 4rem;"><h2>${title}</h2><p>${body}</p></body></html>`;

export function createOauthRouter({ tokenStore, api, env, fetchImpl, logger }) {
  const router = express.Router();
  const doFetch = fetchImpl ?? globalThis.fetch;
  const redirectUri = `${env.baseUrl}/oauth/callback`;
  /** state nonce → { accountId, expiresAt } (single-use) */
  const pendingStates = new Map();

  const sendPage = (res, status, html) => {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  };

  router.get('/oauth/start', (req, res) => {
    const session = verifySessionToken(
      typeof req.query.st === 'string' ? req.query.st : null,
      env.clientSecret,
      logger,
    );
    if (!session) {
      sendPage(res, 401, page('חיבור לא מורשה', 'פתח את החיבור מתוך מסך ההגדרות של האפליקציה.'));
      return;
    }
    const nonce = crypto.randomBytes(16).toString('base64url');
    pendingStates.set(nonce, { accountId: session.accountId, expiresAt: Date.now() + STATE_TTL_MS });
    const params = new URLSearchParams({
      client_id: env.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES,
      state: nonce,
    });
    res.redirect(302, `${AUTHORIZE_URL}?${params.toString()}`);
  });

  router.get('/oauth/callback', async (req, res) => {
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const pending = pendingStates.get(state);
      pendingStates.delete(state); // single-use, consumed on ANY outcome
      if (!pending || pending.expiresAt < Date.now() || code === '') {
        sendPage(res, 400, page('החיבור נכשל', 'הקישור אינו תקף או שפג תוקפו — נסה שוב ממסך ההגדרות.'));
        return;
      }

      const exchange = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.clientId,
          client_secret: env.clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      });
      if (!exchange.ok) {
        logger.error('oauth code exchange failed', TAG, { status: exchange.status });
        sendPage(res, 502, page('החיבור נכשל', 'monday סירבה לבקשה — נסה שוב.'));
        return;
      }
      const tokenBody = await exchange.json();
      const token = tokenBody?.access_token;
      if (typeof token !== 'string' || token === '') {
        logger.error('oauth exchange returned no access_token', TAG, {});
        sendPage(res, 502, page('החיבור נכשל', 'לא התקבל טוקן — נסה שוב.'));
        return;
      }

      const me = await api.me(token);
      // The authorizing user is a real OWNER lending their identity to reverts —
      // stored per-user AND as the account reader (services/stores.js).
      await tokenStore.setOwnerToken(pending.accountId, String(me.id), {
        token,
        userId: String(me.id),
        userName: me?.name ?? '',
        activatedAt: new Date().toISOString(),
      });
      logger.info('guard authorized by owner', TAG, {
        accountId: pending.accountId, userId: String(me.id),
      });
      sendPage(res, 200, page('חובר בהצלחה', 'ביטולים אוטומטיים של שינויים לא-חוקיים יירשמו על שמך כשתהיה הבעלים הראשי. אפשר לסגור את הלשונית.'));
    } catch (err) {
      logger.error('oauth callback failed', TAG, { error: String(err?.message ?? err) });
      sendPage(res, 502, page('החיבור נכשל', 'שגיאה בלתי צפויה — נסה שוב.'));
    }
  });

  return router;
}
