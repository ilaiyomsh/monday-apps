// monday OAuth 2.0 helper — per-user access token issuance for background
// GraphQL writes. Tokens do not expire until uninstall, so there is no
// refresh flow; failed requests on 401 should surface as "reconnect monday".

import logger from './logger.js';

const TAG = 'monday_oauth';

const TOKEN_URL = 'https://auth.monday.com/oauth2/token';

function clientId() { return process.env.MONDAY_OAUTH_CLIENT_ID; }
function clientSecret() { return process.env.MONDAY_OAUTH_CLIENT_SECRET; }

export async function exchangeMondayCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('monday token exchange failed', TAG, { status: res.status, body: text.slice(0, 300) });
    throw new Error(`monday token exchange failed: ${res.status}`);
  }
  return res.json();
}
