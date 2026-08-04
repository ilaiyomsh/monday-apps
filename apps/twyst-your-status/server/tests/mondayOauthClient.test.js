// test-guard gate for src/services/monday-oauth-client.js — the OAuth 2.1 (New
// OAuth Flow) HTTP client: PKCE code exchange, rotating single-use refresh, and
// best-effort revoke, all against monday's oauth_ms endpoints. All transport is
// injected (fetchImpl) so nothing hits the network.

import { describe, it, expect, vi } from 'vitest';
import {
  createMondayOauthClient,
  decodeJwtExpMs,
  TOKEN_URL,
  REVOKE_URL,
  FALLBACK_TTL_MS,
} from '../src/services/monday-oauth-client.js';

/** Build a JWT whose payload carries the given claims (signature is a placeholder). */
function jwtWith(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function clientWith(fetchImpl, logger) {
  return createMondayOauthClient({ clientId: 'cid', clientSecret: 'csec', fetchImpl, logger });
}

function formOf(fetchImpl, n = 0) {
  const [, init] = fetchImpl.mock.calls[n];
  return Object.fromEntries(new URLSearchParams(String(init.body)));
}

// ---------------------------------------------------------------------------
// decodeJwtExpMs
// ---------------------------------------------------------------------------

describe('decodeJwtExpMs', () => {
  it('decodes the exp claim (seconds) to ms-epoch', () => {
    expect(decodeJwtExpMs(jwtWith({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it('returns null for a non-string token', () => {
    expect(decodeJwtExpMs(null)).toBeNull();
    expect(decodeJwtExpMs(42)).toBeNull();
  });

  it('returns null when the token does not have three dot-separated parts', () => {
    expect(decodeJwtExpMs('a.b')).toBeNull();
  });

  it('returns null when the payload has no numeric exp', () => {
    expect(decodeJwtExpMs(jwtWith({ sub: 'x' }))).toBeNull();
    expect(decodeJwtExpMs(jwtWith({ exp: 'soon' }))).toBeNull();
  });

  it('returns null AND logs a machine code (no token) when the payload is not JSON', () => {
    const logger = { debug: vi.fn() };
    const bad = `${Buffer.from('h').toString('base64url')}.${Buffer.from('not-json{').toString('base64url')}.sig`;
    expect(decodeJwtExpMs(bad, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug.mock.calls[0][0]).toBe('oauth_jwt_exp_undecodable');
  });
});

// ---------------------------------------------------------------------------
// exchangeCode
// ---------------------------------------------------------------------------

describe('exchangeCode (authorization_code + PKCE)', () => {
  it('POSTs the code + code_verifier to the oauth_ms token endpoint and returns the token pair', async () => {
    const token = jwtWith({ exp: 2_000_000_000 });
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: token, refresh_token: 'refresh-1' })
    );
    const client = clientWith(fetchImpl);

    const tokens = await client.exchangeCode({ code: 'the-code', verifier: 'the-verifier', redirectUri: 'https://g/cb' });

    expect(fetchImpl.mock.calls[0][0]).toBe(TOKEN_URL);
    const form = formOf(fetchImpl);
    expect(form.grant_type).toBe('authorization_code');
    expect(form.code).toBe('the-code');
    expect(form.code_verifier).toBe('the-verifier');
    expect(form.redirect_uri).toBe('https://g/cb');
    expect(form.client_id).toBe('cid');
    expect(form.client_secret).toBe('csec');
    expect(tokens).toEqual({
      accessToken: token,
      refreshToken: 'refresh-1',
      expiresAtMs: 2_000_000_000_000,
      expUndecodable: false,
    });
  });

  it('substitutes a fallback TTL and flags expUndecodable when the access token is opaque', async () => {
    const before = Date.now();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'opaque', refresh_token: 'r' }));
    const tokens = await clientWith(fetchImpl).exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'u' });
    expect(tokens.expUndecodable).toBe(true);
    expect(tokens.expiresAtMs).toBeGreaterThanOrEqual(before + FALLBACK_TTL_MS);
  });

  it('throws exchange_http (carrying status) on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 400 }));
    const err = await clientWith(fetchImpl).exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'u' }).catch((e) => e);
    expect(err.code).toBe('exchange_http');
    expect(err.status).toBe(400);
  });

  it('throws exchange_no_token when the 200 body carries no access_token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ refresh_token: 'r' }));
    const err = await clientWith(fetchImpl).exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'u' }).catch((e) => e);
    expect(err.code).toBe('exchange_no_token');
  });

  it('throws exchange_network when fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('down'));
    const err = await clientWith(fetchImpl).exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'u' }).catch((e) => e);
    expect(err.code).toBe('exchange_network');
  });
});

// ---------------------------------------------------------------------------
// refresh (single-use rotation)
// ---------------------------------------------------------------------------

describe('refresh (rotating refresh_token grant)', () => {
  it('POSTs grant_type=refresh_token and returns the ROTATED refresh token', async () => {
    const token = jwtWith({ exp: 2_100_000_000 });
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: token, refresh_token: 'refresh-2' })
    );
    const tokens = await clientWith(fetchImpl).refresh('refresh-1');
    const form = formOf(fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(TOKEN_URL);
    expect(form.grant_type).toBe('refresh_token');
    expect(form.refresh_token).toBe('refresh-1');
    expect(tokens.refreshToken).toBe('refresh-2');
    expect(tokens.accessToken).toBe(token);
  });

  it('classifies an invalid_grant body as refresh_token_invalid (permanently dead)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, { ok: false, status: 400 }));
    const err = await clientWith(fetchImpl).refresh('dead').catch((e) => e);
    expect(err.code).toBe('refresh_token_invalid');
  });

  it('classifies a 401 as refresh_token_invalid even without an invalid_grant body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }));
    const err = await clientWith(fetchImpl).refresh('dead').catch((e) => e);
    expect(err.code).toBe('refresh_token_invalid');
  });

  it('classifies a 500 as refresh_transient (retryable)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
    const err = await clientWith(fetchImpl).refresh('r').catch((e) => e);
    expect(err.code).toBe('refresh_transient');
  });
});

// ---------------------------------------------------------------------------
// revoke (best-effort, never throws)
// ---------------------------------------------------------------------------

describe('revoke (best-effort)', () => {
  it('POSTs the token + token_type_hint to the revoke endpoint and reports success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: true, status: 200 }));
    const out = await clientWith(fetchImpl).revoke('tok', 'refresh_token');
    expect(fetchImpl.mock.calls[0][0]).toBe(REVOKE_URL);
    expect(formOf(fetchImpl).token_type_hint).toBe('refresh_token');
    expect(out).toEqual({ success: true });
  });

  it('returns success:false (never throws) on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 400 }));
    await expect(clientWith(fetchImpl).revoke('tok')).resolves.toEqual({ success: false, error: 'HTTP 400' });
  });

  it('returns success:false and logs a machine code when fetch throws', async () => {
    const logger = { debug: vi.fn() };
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await clientWith(fetchImpl, logger).revoke('tok');
    expect(out.success).toBe(false);
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});
