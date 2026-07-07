import express from 'express';
import { sessionTokenMiddleware } from '../middlewares/session-token.js';
import syncConfigStorage from '../storage/sync-config-storage.js';
import { issueOauthState, consumeOauthState } from '../services/oauth-state.js';
import { exchangeMondayCode } from '../services/monday-oauth.js';
import { fetchMondayIdentity } from '../services/monday-api.js';
import { renderOAuthDone } from './oauth-callback-html.js';
import logger from '../services/logger.js';
import { buildSyncCtx } from '../helpers/log-context.js';

const TAG = 'oauth';
const router = express.Router();

const MONDAY_SCOPES = 'boards:read boards:write me:read notifications:write';

function redirectUri() {
  return process.env.MONDAY_OAUTH_REDIRECT_URI
    || `${process.env.APP_BASE_URL || ''}/oauth/monday/callback`;
}

// POST /oauth/monday/start — same shape as google start.
router.post('/oauth/monday/start', sessionTokenMiddleware, async (req, res) => {
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
      provider: 'monday',
      configId,
      userId: req.session.userId,
      accountId: req.session.accountId,
    });

    const params = new URLSearchParams({
      client_id: process.env.MONDAY_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: MONDAY_SCOPES,
      state,
    });
    const authUrl = `https://auth.monday.com/oauth2/authorize?${params}`;
    return res.json({ authUrl, state });
  } catch (err) {
    logger.error('error', TAG, { prv: 'monday', stage: 'oauth_start', cause: err.message });
    return res.status(500).json({ error: 'oauth_start_failed' });
  }
});

// GET /oauth/monday/callback
router.get('/oauth/monday/callback', async (req, res) => {
  const { code, state, error: consentError } = req.query;
  if (consentError) {
    logger.warn('oauth_denied', TAG, { prv: 'monday', cause: String(consentError) });
    return res.set('Content-Type', 'text/html').send(
      renderOAuthDone({ provider: 'monday', configId: null, ok: false, errorMsg: String(consentError) })
    );
  }
  if (!code || !state) {
    return res.set('Content-Type', 'text/html').status(400).send(
      renderOAuthDone({ provider: 'monday', configId: null, ok: false, errorMsg: 'missing code/state' })
    );
  }

  try {
    const entry = await consumeOauthState(String(state), 'monday');
    if (!entry) {
      return res.set('Content-Type', 'text/html').status(400).send(
        renderOAuthDone({ provider: 'monday', configId: null, ok: false, errorMsg: 'invalid or expired state' })
      );
    }

    const tokens = await exchangeMondayCode({ code: String(code), redirectUri: redirectUri() });
    const accessToken = tokens.access_token;

    // Best-effort fetch of monday identity (TZ + user name/email + account
    // slug/name). Sync engine also has a lazy TZ fallback so older configs
    // and identity-fetch failures still operate.
    let identity = null;
    try {
      identity = await fetchMondayIdentity(accessToken);
    } catch (err) {
      logger.warn('identity_fetch_failed', TAG, { prv: 'monday', error: err.message });
    }

    await syncConfigStorage.updateSyncConfig(entry.configId, {
      mondayAccessToken: accessToken,
      ...(identity?.timeZone     ? { mondayTimeZone:     identity.timeZone }     : {}),
      ...(identity?.userName     ? { mondayUserName:     identity.userName }     : {}),
      ...(identity?.userEmail    ? { mondayUserEmail:    identity.userEmail }    : {}),
      ...(identity?.accountName  ? { mondayAccountName:  identity.accountName }  : {}),
      ...(identity?.accountSlug  ? { mondayAccountSlug:  identity.accountSlug }  : {}),
    });

    const config = await syncConfigStorage.getSyncConfig(entry.configId);
    logger.info('connected', TAG, {
      ...buildSyncCtx(config),
      prv: 'monday',
      tz: identity?.timeZone,
      slug: identity?.accountSlug,
    });
    return res.set('Content-Type', 'text/html').send(
      renderOAuthDone({ provider: 'monday', configId: entry.configId, ok: true })
    );
  } catch (err) {
    logger.error('error', TAG, { prv: 'monday', stage: 'oauth_callback', cause: err.message });
    return res.set('Content-Type', 'text/html').status(500).send(
      renderOAuthDone({ provider: 'monday', configId: null, ok: false, errorMsg: err.message })
    );
  }
});

export default router;
