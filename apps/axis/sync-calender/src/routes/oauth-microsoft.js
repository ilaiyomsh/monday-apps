import express from 'express';
import { sessionTokenMiddleware } from '../middlewares/session-token.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { issueOauthState, consumeOauthState } from '../services/oauth-state.js';
import { isMicrosoftEnabled } from '../services/provider.js';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftUserProfile,
  pickMicrosoftEmail,
} from '../services/providers/microsoft/oauth.js';
import { renderOAuthDone } from './oauth-callback-html.js';
import logger, { maskEmail } from '../services/logger.js';
import { buildSyncCtx } from '../helpers/log-context.js';

const TAG = 'oauth';
const router = express.Router();

function redirectUri() {
  return process.env.MICROSOFT_OAUTH_REDIRECT_URI
    || `${process.env.APP_BASE_URL || ''}/oauth/microsoft/callback`;
}

// Common gate: every Microsoft route returns 503 when env vars aren't set, so
// the codepath is dormant in production until you flip the feature flag by
// configuring MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET in monday code.
function requireMicrosoftEnabled(_req, res, next) {
  if (!isMicrosoftEnabled()) {
    return res.status(503).json({ error: 'microsoft_provider_disabled' });
  }
  next();
}

// POST /oauth/microsoft/start
// body: { configId }
// Returns { authUrl, state }. Caller opens authUrl in a popup or redirects.
router.post('/oauth/microsoft/start', requireMicrosoftEnabled, sessionTokenMiddleware, async (req, res) => {
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

    // XOR enforcement: a config that's already connected to Google must
    // disconnect first before connecting to Microsoft.
    if (config.googleRefreshToken) {
      return res.status(409).json({ error: 'already_connected_to_google' });
    }

    const state = await issueOauthState({
      provider: 'microsoft',
      configId,
      userId: req.session.userId,
      accountId: req.session.accountId,
    });

    const authUrl = buildMicrosoftAuthUrl({ state, redirectUri: redirectUri() });
    return res.json({ authUrl, state });
  } catch (err) {
    logger.error('error', TAG, { prv: 'microsoft', stage: 'oauth_start', cause: err.message });
    return res.status(500).json({ error: 'oauth_start_failed' });
  }
});

// GET /oauth/microsoft/callback
// Microsoft redirects here after consent. Consumes state, exchanges code,
// stores tokens + email + provider='microsoft' onto sync_config, and renders
// a postMessage HTML success page back to the SPA popup.
router.get('/oauth/microsoft/callback', async (req, res) => {
  if (!isMicrosoftEnabled()) {
    return res.status(503).set('Content-Type', 'text/html').send(
      renderOAuthDone({ provider: 'microsoft', configId: null, ok: false, errorMsg: 'microsoft_provider_disabled' })
    );
  }

  const { code, state, error: consentError, error_description: consentErrorDesc } = req.query;
  if (consentError) {
    logger.warn('oauth_denied', TAG, {
      prv: 'microsoft',
      cause: String(consentErrorDesc || consentError).slice(0, 200),
    });
    return res.set('Content-Type', 'text/html').send(
      renderOAuthDone({
        provider: 'microsoft',
        configId: null,
        ok: false,
        errorMsg: String(consentErrorDesc || consentError),
      })
    );
  }
  if (!code || !state) {
    return res.set('Content-Type', 'text/html').status(400).send(
      renderOAuthDone({ provider: 'microsoft', configId: null, ok: false, errorMsg: 'missing code/state' })
    );
  }

  try {
    const entry = await consumeOauthState(String(state), 'microsoft');
    if (!entry) {
      return res.set('Content-Type', 'text/html').status(400).send(
        renderOAuthDone({ provider: 'microsoft', configId: null, ok: false, errorMsg: 'invalid or expired state' })
      );
    }

    const tokens = await exchangeMicrosoftCode({ code: String(code), redirectUri: redirectUri() });
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;

    const profile = await fetchMicrosoftUserProfile(accessToken);
    const email = pickMicrosoftEmail(profile);

    await syncConfigStorage.updateSyncConfig(entry.configId, {
      provider: 'microsoft',
      microsoftAccessToken: accessToken,
      microsoftRefreshToken: refreshToken,
      microsoftTokenExpiresAt: expiresAt,
      microsoftUserEmail: email,
      microsoftUserId: profile?.id || null,
    });

    const config = await syncConfigStorage.getSyncConfig(entry.configId);
    logger.info('connected', TAG, {
      ...buildSyncCtx(config),
      email: maskEmail(email),
      hasRefreshToken: Boolean(refreshToken),
    });
    return res.set('Content-Type', 'text/html').send(
      renderOAuthDone({ provider: 'microsoft', configId: entry.configId, ok: true })
    );
  } catch (err) {
    logger.error('error', TAG, { prv: 'microsoft', stage: 'oauth_callback', cause: err.message });
    return res.set('Content-Type', 'text/html').status(500).send(
      renderOAuthDone({ provider: 'microsoft', configId: null, ok: false, errorMsg: err.message })
    );
  }
});

export default router;
