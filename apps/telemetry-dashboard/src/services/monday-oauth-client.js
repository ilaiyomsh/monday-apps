// monday OAuth 2.1 HTTP client (Change #144) — the ONE place that owns the
// oauth_ms endpoint URLs and form-param shapes, so the router (code
// exchange), the token provider (refresh) and disconnect (revoke) never
// triplicate them. monday's new flow: PKCE S256 is mandatory, access tokens
// EXPIRE (no expires_in — the expiry is the JWT `exp` claim), refresh tokens
// are SINGLE-USE and rotate on every refresh, and the whole grant dies 6
// months after the original authorization.
//
// PRIVACY: this module NEVER logs — token material must not reach any logger.
// Errors carry machine `code`s (exchange_* / refresh_*) and callers do the
// logging with those codes only.
//
// All collaborators are injected — this module imports nothing.

export const TOKEN_URL = 'https://auth.monday.com/oauth_ms/oauth/token';
export const REVOKE_URL = 'https://auth.monday.com/oauth_ms/oauth/revoke';

// Used when an access token's exp claim cannot be decoded: schedule the next
// refresh half an hour out instead of never (see decodeJwtExpMs).
export const FALLBACK_TTL_MS = 30 * 60_000;

/**
 * Decode a JWT's `exp` claim to ms-epoch. DECODE, NOT VERIFY — monday issued
 * this JWT and we have no verification key; the value is used ONLY to
 * schedule proactive refreshes, never for authorization decisions.
 * @param {unknown} token
 * @returns {number|null} ms-epoch expiry, or null when undecodable
 */
export function decodeJwtExpMs(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const exp = payload?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    // Opaque / non-JWT token — callers fall back to FALLBACK_TTL_MS.
    return null;
  }
}

/** @param {string} code @param {string} message @param {object} [extra] */
function oauthError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * @param {object} opts
 * @param {string} opts.clientId - monday app Client ID
 * @param {string} opts.clientSecret - monday app Client Secret (token_endpoint_auth_methods: client_secret_post)
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {{
 *   exchangeCode: (args: { code: string, verifier: string, redirectUri: string }) =>
 *     Promise<{ accessToken: string, refreshToken: string|null, expiresAtMs: number, expUndecodable: boolean }>,
 *   refresh: (refreshToken: string) =>
 *     Promise<{ accessToken: string, refreshToken: string|null, expiresAtMs: number, expUndecodable: boolean }>,
 *   revoke: (token: string, tokenTypeHint?: 'access_token'|'refresh_token') =>
 *     Promise<{ success: boolean, error?: string }>,
 * }}
 */
export function createMondayOauthClient({ clientId, clientSecret, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  async function postForm(url, params) {
    return doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  }

  /** Shape a successful token response; exp decoded from the access token JWT. */
  function toTokens(body) {
    const accessToken = body?.access_token;
    const expMs = decodeJwtExpMs(accessToken);
    return {
      accessToken,
      refreshToken: typeof body?.refresh_token === 'string' ? body.refresh_token : null,
      expiresAtMs: expMs ?? Date.now() + FALLBACK_TTL_MS,
      expUndecodable: expMs === null,
    };
  }

  return {
    /** authorization_code grant — PKCE verifier required by the new flow. */
    async exchangeCode({ code, verifier, redirectUri }) {
      let res;
      try {
        res = await postForm(TOKEN_URL, {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        });
      } catch (err) {
        throw oauthError('exchange_network', `token exchange network failure: ${err?.message ?? err}`);
      }
      if (!res.ok) {
        throw oauthError('exchange_http', `token exchange HTTP ${res.status}`, { status: res.status });
      }
      let body;
      try {
        body = await res.json();
      } catch (err) {
        throw oauthError('exchange_bad_json', `token exchange returned non-JSON: ${err?.message ?? err}`);
      }
      if (typeof body?.access_token !== 'string' || body.access_token.length === 0) {
        throw oauthError('exchange_no_token', 'token exchange returned no access_token');
      }
      return toTokens(body);
    },

    /**
     * refresh_token grant. Refresh tokens are SINGLE-USE: a success rotates
     * the pair (persist the new refresh token, discard the old). invalid_grant
     * / 400 / 401 means the refresh token is permanently dead (rotated-away,
     * revoked, or past the 6-month lifetime) → code 'refresh_token_invalid';
     * anything else is retryable → code 'refresh_transient'.
     */
    async refresh(refreshToken) {
      let res;
      try {
        res = await postForm(TOKEN_URL, {
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        });
      } catch (err) {
        throw oauthError('refresh_transient', `refresh network failure: ${err?.message ?? err}`);
      }
      if (!res.ok) {
        let errCode = '';
        try {
          const body = await res.json();
          errCode = String(body?.error ?? '');
        } catch {
          // Non-JSON error body — classify on status alone below.
        }
        if (errCode === 'invalid_grant' || res.status === 400 || res.status === 401) {
          throw oauthError('refresh_token_invalid', `refresh rejected (HTTP ${res.status})`, {
            status: res.status,
          });
        }
        throw oauthError('refresh_transient', `refresh HTTP ${res.status}`, { status: res.status });
      }
      let body;
      try {
        body = await res.json();
      } catch (err) {
        throw oauthError('refresh_transient', `refresh returned non-JSON: ${err?.message ?? err}`);
      }
      if (typeof body?.access_token !== 'string' || body.access_token.length === 0) {
        throw oauthError('refresh_transient', 'refresh returned no access_token');
      }
      return toTokens(body);
    },

    /**
     * Best-effort revocation — NEVER throws (disconnect must always be able
     * to clear local state). The caller logs a failure using the returned
     * error string (never the token).
     */
    async revoke(token, tokenTypeHint) {
      try {
        const res = await postForm(REVOKE_URL, {
          token,
          client_id: clientId,
          client_secret: clientSecret,
          ...(tokenTypeHint ? { token_type_hint: tokenTypeHint } : {}),
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        return { success: true };
      } catch (err) {
        // Best-effort by contract: the error is RETURNED for the caller to
        // log (privacy: this module must stay logger-free).
        return { success: false, error: String(err?.message ?? err) };
      }
    },
  };
}
