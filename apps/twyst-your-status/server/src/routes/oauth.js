/**
 * oauth — one-time activation via monday's OAuth 2.1 (New OAuth Flow). An OWNER
 * authorizes ONCE so the guard can (a) read the board and (b) write reverts AS the
 * primary owner. There is NO bot/service identity — the authorizing user lends
 * their own identity (BYPASS-PROOF-DECISION.md / GUARD-ACTIVATION.md).
 *
 * GET /oauth/start?st=<sessionToken>
 *   Verifies the sessionToken (client secret) — the connecting ACCOUNT comes from
 *   the JWT, never a query param — mints a PKCE S256 pair + a single-use state
 *   nonce that CARRIES the verifier, and 302s to auth.monday.com/oauth2/authorize
 *   with code_challenge. (When testing a draft version, app_version_id is added so
 *   the authorize request targets the version whose New OAuth Flow toggle is ON.)
 *
 * GET /oauth/callback?code&state
 *   Consumes the state (replay/expiry → 400), exchanges the code at monday's NEW
 *   oauth_ms token endpoint WITH the PKCE code_verifier (services/monday-oauth-
 *   client.js), asks `me` for the granting user, and stores the token RECORD
 *   (services/stores.js) — access + ROTATING refresh token + decoded expiry. A
 *   later refresh keeps it alive; a dead grant flags `reauth_required`.
 *
 * State nonces are single-use with a 10-minute TTL, held in memory — activation is
 * a once-per-account act; a restart mid-flow just means clicking again.
 *
 * PRIVACY: the authorization code, state nonce, PKCE verifier and BOTH tokens NEVER
 * reach any logger — machine codes only, even on failure.
 */

import crypto from 'node:crypto';
import express from 'express';
import { verifySessionToken } from '../middlewares/auth.js';

export const OAUTH_SCOPES = 'me:read account:read boards:read boards:write users:read teams:read webhooks:write notifications:write';
export const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';

const STATE_TTL_MS = 10 * 60 * 1000;
const TAG = 'oauth';

const page = (title, body) => `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: sans-serif; text-align: center; padding-top: 4rem;"><h2>${title}</h2><p>${body}</p></body></html>`;

export function createOauthRouter({ tokenStore, api, oauthClient, env, logger, now = () => Date.now() }) {
  const router = express.Router();
  const redirectUri = `${env.baseUrl}/oauth/callback`;
  /** state nonce → { accountId, verifier, expiresAt } (single-use) */
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
    // PKCE (OAuth 2.1, S256-only): verifier 43-128 chars of the unreserved charset —
    // randomBytes(32).toString('base64url') yields exactly 43.
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    // round328: carry the CLICKING user too — the callback refuses a consent that
    // came back as anyone else (multi-account browsers, see below).
    pendingStates.set(nonce, {
      accountId: session.accountId,
      userId: session.userId,
      verifier,
      expiresAt: now() + STATE_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: env.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES,
      state: nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    // OAuth config (scopes/redirects + the New OAuth Flow toggle) is per app VERSION;
    // during draft testing the authorize request must name the draft version.
    if (env.oauthAppVersionId) params.set('app_version_id', env.oauthAppVersionId);
    // round328 — PIN the consent to the session's account. auth.monday.com uses the
    // browser's ACTIVE monday session, so a multi-account user silently consents on
    // the wrong account: the token stores under the wrong identity, the settings
    // line never turns "connected", and every revert is skipped. Per monday's OAuth
    // docs the slug HOST only sets the default account — the `subdomain` query
    // param is what actually forces it (Codex P2) — so send both; the callback's
    // user-identity check stays as the hard net either way.
    if (session.slug) params.set('subdomain', session.slug);
    const authorizeBase = session.slug
      ? `https://${session.slug}.monday.com/oauth2/authorize`
      : AUTHORIZE_URL;
    res.redirect(302, `${authorizeBase}?${params.toString()}`);
  });

  router.get('/oauth/callback', async (req, res) => {
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const pending = pendingStates.get(state);
      pendingStates.delete(state); // single-use, consumed on ANY outcome
      if (!pending || pending.expiresAt < now() || code === '') {
        sendPage(res, 400, page('החיבור נכשל', 'הקישור אינו תקף או שפג תוקפו — נסה שוב ממסך ההגדרות.'));
        return;
      }

      let tokens;
      try {
        tokens = await oauthClient.exchangeCode({ code, verifier: pending.verifier, redirectUri });
      } catch (err) {
        // Machine code only — never the code, verifier, or any token.
        logger.error('oauth code exchange failed', TAG, {
          code: String(err?.code ?? ''), status: err?.status ?? null,
        });
        sendPage(res, 502, page('החיבור נכשל', 'monday סירבה לבקשה — נסה שוב.'));
        return;
      }

      const me = await api.me(tokens.accessToken);
      // round328 — the consent must come back as the SAME user who clicked
      // connect. A multi-account browser session can complete the consent as a
      // different user (or a different ACCOUNT entirely) — storing that token
      // would point the account reader at foreign boards and leave this
      // column's reverts silently skipped, while the success page tells the
      // clicking owner they are connected. Refuse and explain instead.
      if (pending.userId != null && String(me.id) !== String(pending.userId)) {
        logger.warn('oauth consent returned a different user — token NOT stored', TAG, {
          accountId: pending.accountId,
          expectedUserId: String(pending.userId),
          actualUserId: String(me.id),
        });
        sendPage(res, 409, page(
          'האישור בוצע ממשתמש אחר',
          'לשונית האישור של monday הייתה מחוברת לחשבון או למשתמש אחר. עברו בלשונית של monday לחשבון שבו פתחתם את ההגדרות, ונסו שוב מכפתור החיבור.',
        ));
        return;
      }
      // The authorizing user is a real OWNER lending their identity to reverts —
      // stored per-user AND pointed to by the account reader (services/stores.js).
      const nowMs = now();
      await tokenStore.setOwnerToken(pending.accountId, String(me.id), {
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAtMs,
        obtainedAt: nowMs, // the 6-month lifetime anchor
        refreshedAt: null,
        status: 'active',
        userId: String(me.id),
        userName: me?.name ?? '',
        activatedAt: new Date(nowMs).toISOString(),
      });
      if (tokens.expUndecodable) {
        // Opaque exp → the client substituted a short fallback TTL; flag it (no token).
        logger.warn('oauth access-token exp undecodable — using fallback TTL', TAG, {
          accountId: pending.accountId,
        });
      }
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
