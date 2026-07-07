// Google OAuth 2.0 helpers — code exchange and token refresh.
// Lives under providers/google/ as part of the provider-abstraction layout
// introduced in Phase 0 of the multi-provider work. The Microsoft provider
// has a sibling at providers/microsoft/oauth.js.

import logger from '../../logger.js';

const TAG = 'oauth';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

function clientId() { return process.env.GOOGLE_OAUTH_CLIENT_ID; }
function clientSecret() { return process.env.GOOGLE_OAUTH_CLIENT_SECRET; }

export async function exchangeGoogleCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('token exchange failed', TAG, { provider: 'google', status: res.status, body: text.slice(0, 200) });
    throw new Error(`google token exchange failed: ${res.status}`);
  }
  return res.json();
}

export async function refreshGoogleAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn('token refresh failed', TAG, { provider: 'google', status: res.status, body: text.slice(0, 200) });
    const err = new Error(`google token refresh failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchGoogleUserEmail(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

// Return a still-valid access token for a config, refreshing on demand.
// Updates storage if a fresh token was minted. Throws if refresh fails —
// callers should catch and mark the config as `google_disconnected`.
export async function ensureGoogleAccessToken(config, syncConfigStorage) {
  const now = Date.now();
  const cushion = 60_000; // refresh one minute before actual expiry
  if (config.googleAccessToken && config.googleAccessTokenExpiresAt && config.googleAccessTokenExpiresAt - cushion > now) {
    return config.googleAccessToken;
  }
  if (!config.googleRefreshToken) {
    const err = new Error('google_refresh_token_missing');
    err.code = 'google_refresh_token_missing';
    throw err;
  }
  const refreshed = await refreshGoogleAccessToken(config.googleRefreshToken);
  const accessToken = refreshed.access_token;
  const expiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  await syncConfigStorage.updateSyncConfig(config.configId, {
    googleAccessToken: accessToken,
    googleAccessTokenExpiresAt: expiresAt,
  });
  return accessToken;
}
