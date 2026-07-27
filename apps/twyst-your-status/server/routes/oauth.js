import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import { asyncHandler } from '../asyncHandler.js';
import logger from '../logger.js';

const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';

function redirectUri(env) {
  return `${env.baseUrl}/oauth/callback`;
}

function authorizationUrl(env, state, challenge) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('redirect_uri', redirectUri(env));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (env.oauthAppVersionId) url.searchParams.set('app_version_id', env.oauthAppVersionId);
  return url.toString();
}

function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createOAuthApiRouter({ store, tokenProvider, env, randomBytesImpl = randomBytes }) {
  const router = express.Router();

  router.post('/start', asyncHandler(async (req, res) => {
    const state = randomBytesImpl(32).toString('base64url');
    const verifier = randomBytesImpl(32).toString('base64url');
    await store.issueOAuthState(state, {
      verifier,
      accountId: req.session.accountId,
      userId: req.session.userId,
    });
    res.json({ url: authorizationUrl(env, state, pkceChallenge(verifier)) });
  }));

  router.get('/status', asyncHandler(async (req, res) => {
    const status = await tokenProvider.getStatus(req.session.accountId);
    res.json({ connected: status === 'connected', status });
  }));

  router.delete('/connection', asyncHandler(async (req, res) => {
    const result = await tokenProvider.disconnect(req.session.accountId);
    res.json({ disconnected: true, revoked: result.revoked });
  }));

  return router;
}

export function createOAuthCallbackRouter({ store, oauthClient, env, now = Date.now }) {
  const router = express.Router();

  router.get('/callback', asyncHandler(async (req, res) => {
    if (typeof req.query.state !== 'string' || typeof req.query.code !== 'string') {
      res.status(400).send('Invalid or expired OAuth callback.');
      return;
    }
    const identity = await store.consumeOAuthState(req.query.state);
    if (!identity) {
      res.status(400).send('Invalid or expired OAuth callback.');
      return;
    }
    const tokens = await oauthClient.exchangeCode({
      code: req.query.code,
      verifier: identity.verifier,
      redirectUri: redirectUri(env),
    });
    await store.saveOAuthTokenRecord(identity.accountId, {
      v: 2,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAtMs,
      obtainedAt: now(),
      status: 'active',
    });
    if (tokens.expUndecodable) {
      logger.warn('oauth_jwt_exp_undecodable', 'oauth', { accountId: identity.accountId });
    }
    const targetOrigin = new URL(env.baseUrl).origin;
    res.type('html').send(`<!doctype html><html lang="he" dir="rtl"><body><p>החיבור הושלם. אפשר לסגור חלון זה.</p><script>window.opener?.postMessage({type:'twyst-oauth-connected'}, ${JSON.stringify(targetOrigin)});window.close();</script></body></html>`);
  }));

  return router;
}
