// T9b — Google OAuth 2.0 transport for the digest sender mailbox.
//
// Mechanics copied from apps/axis/sync-calender/src/services/providers/google/
// oauth.js (D13 says copy, do not reinvent), with three deliberate deviations:
//
//  1. Client credentials are PARAMETERS, not process.env reads. deadline-confirm
//     keeps env in helpers/environment.js + index.js, and per-tenant credentials
//     (owner decision 2026-07-29 — each organization sends from its own internal
//     mailbox) are only expressible if the caller supplies them.
//  2. Scope is `gmail.send` plus the OIDC identity pair. D12 forbids mail READ
//     scopes; `openid email` reads no mail — it is what makes the sender address
//     known without a Gmail metadata call, and the address is required to write
//     the `From` header.
//  3. Token state is returned, never persisted here. This module is transport
//     only; services/gmail-sender.js owns storage.
//
// Refresh failures are classified: `invalid_grant` means the grant is dead and
// a human must reconnect (`google_invalid_grant`); anything else is transient
// (`google_refresh_failed`). Conflating them would either hide a dead
// connection or trip the kill switch on a passing 503.

import { logError, logWarn } from '../../../helpers/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** gmail.send for the mail itself; openid+email to learn the sender address. */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'].join(' ');

/**
 * The consent URL the operator's browser is sent to.
 * `access_type=offline` + `prompt=consent` are what make Google mint a refresh
 * token; without both, a re-consent returns an access token only and sending
 * dies silently at the first expiry.
 * @param {{ clientId: string, redirectUri: string, state: string }} p
 * @returns {string}
 */
export function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/**
 * Read the `email` claim out of an id_token. The token comes straight from
 * Google's token endpoint over TLS, so the signature adds nothing here — we
 * are not accepting it from a client.
 * @param {unknown} idToken
 * @returns {string}
 */
function emailFromIdToken(idToken) {
  if (typeof idToken !== 'string') return '';
  const payload = idToken.split('.')[1];
  if (!payload) return '';
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
  } catch (err) {
    logError('google-oauth', 'id_token payload not decodable', { error: String(err?.message ?? err) });
    return '';
  }
}

async function postForm(fetchImpl, body) {
  return fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

/**
 * Authorization-code exchange. Fails loudly when the response is missing
 * either half of what sending needs — a refresh token or a sender address —
 * because both failures are invisible until the first digest run otherwise.
 * @param {{ code: string, redirectUri: string, clientId: string, clientSecret: string,
 *          fetchImpl?: typeof fetch, now?: () => number }} p
 * @returns {Promise<{ accessToken: string, refreshToken: string, accessTokenExpiresAt: number, senderAddress: string }>}
 */
export async function exchangeGoogleCode({
  code,
  redirectUri,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  now = Date.now,
}) {
  const res = await postForm(fetchImpl, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!res.ok) {
    const text = await res.text();
    logError('google-oauth', 'token exchange failed', { status: res.status, body: text.slice(0, 200) });
    throw new Error(`google token exchange failed: ${res.status}`);
  }
  const tokens = await res.json();

  const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
  if (!refreshToken) {
    logError('google-oauth', 'exchange returned no refresh token', { hasAccess: Boolean(tokens.access_token) });
    throw new Error('google exchange returned no refresh token — re-consent with prompt=consent');
  }
  const senderAddress = emailFromIdToken(tokens.id_token);
  if (!senderAddress) {
    logError('google-oauth', 'exchange returned no sender address', {});
    throw new Error('google exchange returned no sender address — the email scope was not granted');
  }

  return {
    accessToken: tokens.access_token,
    refreshToken,
    accessTokenExpiresAt: now() + Number(tokens.expires_in || 3600) * 1000,
    senderAddress,
  };
}

/**
 * Mint a fresh access token. Throws with `code: 'google_invalid_grant'` when
 * the grant itself is dead (revoked, expired, client changed) — the caller
 * must mark the connection disconnected on that code and ONLY that code.
 * @param {{ refreshToken: string, clientId: string, clientSecret: string,
 *          fetchImpl?: typeof fetch, now?: () => number }} p
 * @returns {Promise<{ accessToken: string, accessTokenExpiresAt: number }>}
 */
export async function refreshGoogleAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  now = Date.now,
}) {
  const res = await postForm(fetchImpl, {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  if (!res.ok) {
    const text = await res.text();
    const invalidGrant = text.includes('invalid_grant');
    const err = new Error(`google token refresh failed: ${res.status}`);
    err.code = invalidGrant ? 'google_invalid_grant' : 'google_refresh_failed';
    err.status = res.status;
    if (invalidGrant) {
      logError('google-oauth', 'refresh token is dead — reconnect required', { status: res.status });
    } else {
      logWarn('google-oauth', 'token refresh failed (transient)', { status: res.status, body: text.slice(0, 200) });
    }
    throw err;
  }
  const tokens = await res.json();
  return {
    accessToken: tokens.access_token,
    accessTokenExpiresAt: now() + Number(tokens.expires_in || 3600) * 1000,
  };
}
