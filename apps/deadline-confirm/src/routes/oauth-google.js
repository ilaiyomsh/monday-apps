// T9b/T9c — connect the tenant's Gmail sending mailbox.
//
// Opened in a NEW TAB from the admin view (accounts.google.com refuses to be
// framed), mirroring the monday flow in routes/oauth.js: the connecting ACCOUNT
// comes from a monday sessionToken passed as `?st=`, never from anything the
// browser could pick.
//
// Access control. D13 called for an operator-only gate, on the reasoning that
// connecting rebound the ONE global sending identity, so any tenant admin could
// break every other customer's mail. The owner decision of 2026-07-29 makes the
// sending identity per-organization — each tenant connects a mailbox in its own
// Workspace, under its own OAuth client — which removes that blast radius
// entirely. The gate is therefore the same one the monday flow uses: a valid
// sessionToken whose account is on ALLOWED_ACCOUNT_IDS (empty roster =
// default-deny). A tenant can only ever rebind its own sender.
//
// The state nonce is minted with flow='google' and the callback refuses any
// nonce from another flow, so a monday-issued state cannot be redeemed here.

import crypto from 'node:crypto';
import express from 'express';
import { oauthDonePage, oauthErrorPage } from '../helpers/pages.js';
import { verifySessionToken } from '../middlewares/session-token.js';
import { buildGoogleAuthUrl, exchangeGoogleCode } from '../services/providers/google/oauth.js';
import logger from '../helpers/logger.js';

/**
 * Build the /oauth/google router.
 * @param {object} deps
 * @param {ReturnType<import('../services/storage.js').createAppStorage>} deps.storage
 * @param {{ clientSecret: string, baseUrl: string, allowedAccountIds: string[],
 *           googleOauthClientId: string, googleOauthClientSecret: string }} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @returns {import('express').Router}
 */
export function createGoogleOauthRouter({ storage, env, fetchImpl, now = Date.now }) {
  const router = express.Router();
  const redirectUri = `${env.baseUrl}/oauth/google/callback`;

  function sendPage(res, status, html) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  }

  router.get('/oauth/google/start', async (req, res) => {
    try {
      if (!env.googleOauthClientId || !env.googleOauthClientSecret) {
        logger.logError('oauth-google', 'start refused: no OAuth client configured', {});
        sendPage(res, 409, oauthErrorPage('שליחת המייל אינה מוגדרת בשרת'));
        return;
      }
      const session = verifySessionToken(req.query.st, env.clientSecret);
      if (!session) {
        logger.logError('oauth-google', 'start refused: missing/invalid sessionToken', {});
        sendPage(res, 401, oauthErrorPage('חיבור לא מורשה'));
        return;
      }
      if (!env.allowedAccountIds.includes(session.accountId)) {
        logger.logError('oauth-google', 'start refused: account not on tenant roster', {});
        sendPage(res, 403, oauthErrorPage('חיבור לא מורשה'));
        return;
      }

      const nonce = crypto.randomBytes(16).toString('base64url');
      await storage.issueGoogleOauthState(nonce, session.accountId);
      res
        .status(302)
        .set('Cache-Control', 'no-store')
        .location(
          buildGoogleAuthUrl({ clientId: env.googleOauthClientId, redirectUri, state: nonce })
        )
        .end();
    } catch (err) {
      logger.logError('oauth-google', 'start failed', { error: String(err?.message ?? err) });
      sendPage(res, 500, oauthErrorPage('שגיאת שרת'));
    }
  });

  router.get('/oauth/google/callback', async (req, res) => {
    try {
      const { code, state, error: consentError } = req.query;
      if (consentError) {
        logger.logError('oauth-google', 'consent denied', { reason: String(consentError) });
        sendPage(res, 400, oauthErrorPage('ההרשאה בוטלה'));
        return;
      }
      if (typeof code !== 'string' || code.length === 0 || typeof state !== 'string' || state.length === 0) {
        logger.logError('oauth-google', 'callback missing code/state', {});
        sendPage(res, 400, oauthErrorPage('בקשה חסרה'));
        return;
      }

      // Single-use and age-bounded, in the Google-only key namespace: a
      // monday-issued nonce does not exist here, so it cannot be redeemed.
      const entry = await storage.consumeGoogleOauthState(state);
      if (!entry) {
        logger.logError('oauth-google', 'callback state invalid or expired', {});
        sendPage(res, 400, oauthErrorPage('הבקשה פגה — נסו שוב'));
        return;
      }

      const tokens = await exchangeGoogleCode({
        code,
        redirectUri,
        clientId: env.googleOauthClientId,
        clientSecret: env.googleOauthClientSecret,
        fetchImpl,
        now,
      });

      // Fresh record: a reconnect must clear a previous `disconnectedAt`, or the
      // sender would keep refusing to send with a valid grant in hand.
      await storage.forAccount(entry.accountId).setGoogleSender({
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        senderAddress: tokens.senderAddress,
        connectedAt: now(),
      });
      logger.logInfo('oauth-google', 'sender mailbox connected', { accountId: entry.accountId });
      sendPage(res, 200, oauthDonePage());
    } catch (err) {
      logger.logError('oauth-google', 'callback failed', { error: String(err?.message ?? err) });
      sendPage(res, 500, oauthErrorPage('החיבור נכשל'));
    }
  });

  return router;
}
