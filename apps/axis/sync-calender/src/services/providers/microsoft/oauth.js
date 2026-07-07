// Microsoft Identity Platform OAuth 2.0 helpers — code exchange and token
// refresh against Microsoft Graph. tenant=common so both M365 work/school
// and personal Microsoft accounts can connect (per Phase 1 decision).
//
// IMPORTANT: Microsoft requires `scope` on refresh-token requests too — leaving
// it off returns a token with a default minimal scope set, which then fails
// when called against /v1.0/me/calendarView. We pass the same scopes used
// during the original consent.

import logger from '../../logger.js';

const TAG = 'oauth';

const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.Read',
].join(' ');

function tenant() {
  // monday Developer Center has the env var as MICROSOFT_TENANT_ID; we accept
  // either name (preferring _ID) so a rename isn't required.
  return process.env.MICROSOFT_TENANT_ID || process.env.MICROSOFT_TENANT || 'common';
}

function clientId() {
  return process.env.MICROSOFT_CLIENT_ID;
}

function clientSecret() {
  return process.env.MICROSOFT_CLIENT_SECRET;
}

function authBaseUrl() {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
}

export function buildMicrosoftAuthUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    state,
    // prompt=select_account lets users pick between multiple Microsoft
    // accounts on the same browser; consent screen only shows once per app.
    prompt: 'select_account',
  });
  return `${authBaseUrl()}/authorize?${params}`;
}

export async function exchangeMicrosoftCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: MICROSOFT_SCOPES,
  });
  const res = await fetch(`${authBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('token exchange failed', TAG, { provider: 'microsoft', status: res.status, body: text.slice(0, 200) });
    const err = new Error(`microsoft token exchange failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function refreshMicrosoftAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: MICROSOFT_SCOPES,
  });
  const res = await fetch(`${authBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn('token refresh failed', TAG, { provider: 'microsoft', status: res.status, body: text.slice(0, 200) });
    const err = new Error(`microsoft token refresh failed: ${res.status}`);
    err.status = res.status;
    if (/invalid_grant/.test(text)) err.code = 'refresh_token_invalid';
    throw err;
  }
  return res.json();
}

// GET /v1.0/me — profile lookup. mail is sometimes null on personal accounts
// (consumer outlook.com), so callers should fall back to userPrincipalName.
export async function fetchMicrosoftUserProfile(accessToken) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    id: data.id || null,
    mail: data.mail || null,
    userPrincipalName: data.userPrincipalName || null,
    displayName: data.displayName || null,
  };
}

// Return the email we treat as the user's primary identity. mail wins on
// work/school; userPrincipalName is the consumer fallback.
export function pickMicrosoftEmail(profile) {
  if (!profile) return null;
  return profile.mail || profile.userPrincipalName || null;
}

// Return a still-valid access token for a Microsoft-connected config,
// refreshing on demand. Updates storage if a fresh token was minted.
// Throws { code: 'microsoft_refresh_token_missing' } when no refresh token,
// or rethrows the refresh error (often { code: 'refresh_token_invalid' }).
export async function ensureMicrosoftAccessToken(config, syncConfigStorage) {
  const now = Date.now();
  const cushion = 60_000; // refresh one minute before actual expiry
  if (config.microsoftAccessToken && config.microsoftTokenExpiresAt && config.microsoftTokenExpiresAt - cushion > now) {
    return config.microsoftAccessToken;
  }
  if (!config.microsoftRefreshToken) {
    const err = new Error('microsoft_refresh_token_missing');
    err.code = 'microsoft_refresh_token_missing';
    throw err;
  }
  const refreshed = await refreshMicrosoftAccessToken(config.microsoftRefreshToken);
  const accessToken = refreshed.access_token;
  const expiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  // Microsoft typically rotates the refresh token on every refresh — capture
  // the new one if returned, otherwise keep the existing one.
  const patch = {
    microsoftAccessToken: accessToken,
    microsoftTokenExpiresAt: expiresAt,
  };
  if (refreshed.refresh_token) patch.microsoftRefreshToken = refreshed.refresh_token;
  await syncConfigStorage.updateSyncConfig(config.configId, patch);
  return accessToken;
}
