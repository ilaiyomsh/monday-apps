import express from 'express';
import { sessionTokenMiddleware } from '../middlewares/session-token.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { issueOauthState, consumeOauthState } from '../services/oauth-state.js';
import { exchangeGoogleCode, fetchGoogleUserEmail } from '../services/providers/google/oauth.js';
import { renderOAuthDone } from './oauth-callback-html.js';
import logger, { maskEmail } from '../services/logger.js';
import { buildSyncCtx } from '../helpers/log-context.js';

const TAG = 'oauth';
const router = express.Router();

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function redirectUri() {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    || `${process.env.APP_BASE_URL || ''}/oauth/google/callback`;
}

// POST /oauth/google/start
// body: { configId }
// Returns { authUrl, state }. Caller opens authUrl in a new tab or redirects.
router.post('/oauth/google/start', sessionTokenMiddleware, async (req, res) => {
  try {
    const { configId } = req.body || {};
    if (!configId) return res.status(400).json({ error: 'missing_configId' });

    const config = await syncConfigStorage.getSyncConfig(configId);
    if (!config) return res.status(404).json({ error: 'config_not_found' });
    if (String(config.accountId) !== String(req.session.accountId)) {
      return res.status(403).json({ error: 'account_mismatch' });
    }
    if (String(config.userId) !== String(req.session.userId)) {
      return res.status(403).json({ error: 'not_row_owner' });
    }

    const state = await issueOauthState({
      provider: 'google',
      configId,
      userId: req.session.userId,
      accountId: req.session.accountId,
    });

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    return res.json({ authUrl, state });
  } catch (err) {
    logger.error('error', TAG, { prv: 'google', stage: 'oauth_start', cause: err.message });
    return res.status(500).json({ error: 'oauth_start_failed' });
  }
});

// GET /oauth/google/callback
// Google redirects here after consent. Consumes state, exchanges code,
// stores tokens + email into sync_config, and renders a minimal HTML
// success page telling the user to return to monday.
router.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error: consentError } = req.query;
  if (consentError) {
    logger.warn('oauth_denied', TAG, { prv: 'google', cause: String(consentError) });
    return res.set('Content-Type', 'text/html').send(
      renderOAuthDone({ provider: 'google', configId: null, ok: false, errorMsg: String(consentError) })
    );
  }
  if (!code || !state) {
    return res.set('Content-Type', 'text/html').status(400).send(
      renderOAuthDone({ provider: 'google', configId: null, ok: false, errorMsg: 'missing code/state' })
    );
  }

  try {
    const entry = await consumeOauthState(String(state), 'google');
    if (!entry) {
      return res.set('Content-Type', 'text/html').status(400).send(
        renderOAuthDone({ provider: 'google', configId: null, ok: false, errorMsg: 'invalid or expired state' })
      );
    }

    const tokens = await exchangeGoogleCode({ code: String(code), redirectUri: redirectUri() });
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
    const email = await fetchGoogleUserEmail(accessToken);

    await syncConfigStorage.updateSyncConfig(entry.configId, {
      provider: 'google',
      googleAccessToken: accessToken,
      googleRefreshToken: refreshToken,
      googleAccessTokenExpiresAt: expiresAt,
      googleUserEmail: email,
    });

    const config = await syncConfigStorage.getSyncConfig(entry.configId);
    logger.info('connected', TAG, { ...buildSyncCtx(config), email: maskEmail(email) });
    return res.set('Content-Type', 'text/html').send(
      renderOAuthDone({ provider: 'google', configId: entry.configId, ok: true })
    );
  } catch (err) {
    logger.error('error', TAG, { prv: 'google', stage: 'oauth_callback', cause: err.message });
    return res.set('Content-Type', 'text/html').status(500).send(
      renderOAuthDone({ provider: 'google', configId: null, ok: false, errorMsg: err.message })
    );
  }
});

export default router;
