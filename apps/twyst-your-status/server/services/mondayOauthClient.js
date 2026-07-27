import logger from '../logger.js';

export const TOKEN_URL = 'https://auth.monday.com/oauth_ms/oauth/token';
export const REVOKE_URL = 'https://auth.monday.com/oauth_ms/oauth/revoke';
export const FALLBACK_TTL_MS = 30 * 60_000;

export function decodeJwtExpMs(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const segments = token.split('.');
    if (segments.length !== 3 || !segments[1]) return null;
    const decoded = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return decoded && typeof decoded === 'object' && Number.isFinite(decoded.exp)
      ? decoded.exp * 1000
      : null;
  } catch (error) {
    logger.warn('oauth_jwt_decode_failed', 'oauth', { error });
    return null;
  }
}

function oauthError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

export function createMondayOauthClient({
  clientId,
  clientSecret,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 10_000,
} = {}) {
  if (!clientId || !clientSecret) {
    throw new TypeError('OAuth client id and client secret are required.');
  }

  function requestOptions(params) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(timeoutMs),
    };
  }

  function normalizeTokens(body) {
    const accessToken = body?.access_token;
    const expiresAtMs = decodeJwtExpMs(accessToken);
    return {
      accessToken,
      refreshToken: typeof body?.refresh_token === 'string' ? body.refresh_token : null,
      expiresAtMs: expiresAtMs ?? now() + FALLBACK_TTL_MS,
      expUndecodable: expiresAtMs === null,
    };
  }

  return {
    async exchangeCode({ code, verifier, redirectUri }) {
      let response;
      try {
        response = await fetchImpl(TOKEN_URL, requestOptions({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }));
      } catch (error) {
        throw oauthError('exchange_network', 'OAuth token exchange network failure.', {
          cause: error,
        });
      }
      if (!response.ok) {
        throw oauthError('exchange_http', `OAuth token exchange returned HTTP ${response.status}.`, {
          status: response.status,
        });
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        throw oauthError('exchange_bad_json', 'OAuth token exchange returned invalid JSON.', {
          cause: error,
        });
      }
      if (typeof body?.access_token !== 'string' || !body.access_token) {
        throw oauthError('exchange_no_token', 'OAuth token exchange returned no access token.');
      }
      return normalizeTokens(body);
    },

    async refresh(refreshToken) {
      let response;
      try {
        response = await fetchImpl(TOKEN_URL, requestOptions({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }));
      } catch (error) {
        throw oauthError('refresh_transient', 'OAuth refresh network failure.', { cause: error });
      }
      if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
          throw oauthError('refresh_token_invalid', 'OAuth refresh token was rejected.', {
            status: response.status,
          });
        }
        throw oauthError('refresh_transient', `OAuth refresh returned HTTP ${response.status}.`, {
          status: response.status,
        });
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        throw oauthError('refresh_transient', 'OAuth refresh returned invalid JSON.', {
          cause: error,
        });
      }
      if (typeof body?.access_token !== 'string' || !body.access_token) {
        throw oauthError('refresh_transient', 'OAuth refresh returned no access token.');
      }
      return normalizeTokens(body);
    },

    async revoke(token, tokenTypeHint) {
      let response;
      try {
        response = await fetchImpl(REVOKE_URL, requestOptions({
          token,
          client_id: clientId,
          client_secret: clientSecret,
          ...(tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}),
        }));
      } catch (error) {
        throw oauthError('revoke_network', 'OAuth revocation network failure.', { cause: error });
      }
      if (!response.ok) {
        throw oauthError('revoke_http', `OAuth revocation returned HTTP ${response.status}.`, {
          status: response.status,
        });
      }
      return { success: true };
    },
  };
}
