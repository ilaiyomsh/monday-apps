// Contract tests for src/services/monday-oauth-client.js — the ONE place that
// owns monday's OAuth 2.1 endpoint URLs and form-param shapes (exchange,
// refresh, revoke) plus the JWT `exp` decode used for refresh scheduling.
// All traffic goes through an injected fetchImpl — zero network. The client
// itself never logs (privacy: token material must not reach any logger);
// errors carry machine codes, callers do the logging.

import { describe, it, expect, vi } from 'vitest';
import {
  createMondayOauthClient,
  decodeJwtExpMs,
  TOKEN_URL,
  REVOKE_URL,
  FALLBACK_TTL_MS,
} from '../src/services/monday-oauth-client.js';

const CLIENT_ID = 'cid-1';
const CLIENT_SECRET = 'cs-1';
const REDIRECT_URI = 'https://dashboard.example/oauth/callback';
const CODE = 'code-secret-abc';
const VERIFIER = 'verifier-secret-xyz';
const REFRESH_TOKEN = 'rt-secret-1';

/** A structurally valid JWT whose payload carries the given claims. */
function fakeJwt(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

function makeClient(responder) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  });
  const client = createMondayOauthClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    fetchImpl,
  });
  return { client, calls, fetchImpl };
}

describe('decodeJwtExpMs', () => {
  it('decodes the exp claim to ms-epoch', () => {
    expect(decodeJwtExpMs(fakeJwt({ exp: 1_784_700_000 }))).toBe(1_784_700_000_000);
  });

  it('returns null for a malformed token, a non-JWT string, and a missing exp', () => {
    expect(decodeJwtExpMs('not-a-jwt')).toBeNull();
    expect(decodeJwtExpMs('a.%%%%.c')).toBeNull();
    expect(decodeJwtExpMs(fakeJwt({ sub: 'no-exp' }))).toBeNull();
    expect(decodeJwtExpMs(null)).toBeNull();
  });
});

describe('exchangeCode', () => {
  it('POSTs the exact authorization_code form params and returns tokens + decoded expiry', async () => {
    const accessToken = fakeJwt({ exp: 2_000_000_000 });
    const { client, calls } = makeClient(() => ({
      ok: true,
      json: async () => ({ access_token: accessToken, refresh_token: 'rt-new' }),
    }));

    const out = await client.exchangeCode({ code: CODE, verifier: VERIFIER, redirectUri: REDIRECT_URI });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(String(calls[0].init.method).toUpperCase()).toBe('POST');
    const params = new URLSearchParams(calls[0].init.body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('client_secret')).toBe(CLIENT_SECRET);
    expect(params.get('code')).toBe(CODE);
    expect(params.get('code_verifier')).toBe(VERIFIER);
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);

    expect(out.accessToken).toBe(accessToken);
    expect(out.refreshToken).toBe('rt-new');
    expect(out.expiresAtMs).toBe(2_000_000_000_000);
    expect(out.expUndecodable).toBe(false);
  });

  it('flags an undecodable access-token exp and falls back to now+FALLBACK_TTL_MS', async () => {
    const { client } = makeClient(() => ({
      ok: true,
      json: async () => ({ access_token: 'opaque-not-a-jwt', refresh_token: 'rt' }),
    }));

    const before = Date.now();
    const out = await client.exchangeCode({ code: CODE, verifier: VERIFIER, redirectUri: REDIRECT_URI });

    expect(out.expUndecodable).toBe(true);
    expect(out.expiresAtMs).toBeGreaterThanOrEqual(before + FALLBACK_TTL_MS);
  });

  it('throws code exchange_network when fetch rejects', async () => {
    const { client } = makeClient(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      client.exchangeCode({ code: CODE, verifier: VERIFIER, redirectUri: REDIRECT_URI })
    ).rejects.toMatchObject({ code: 'exchange_network' });
  });

  it('throws code exchange_http with the status on a non-OK response', async () => {
    const { client } = makeClient(() => ({ ok: false, status: 401, text: async () => 'nope' }));
    await expect(
      client.exchangeCode({ code: CODE, verifier: VERIFIER, redirectUri: REDIRECT_URI })
    ).rejects.toMatchObject({ code: 'exchange_http', status: 401 });
  });

  it('throws code exchange_bad_json when the body is not JSON', async () => {
    const { client } = makeClient(() => ({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    }));
    await expect(
      client.exchangeCode({ code: CODE, verifier: VERIFIER, redirectUri: REDIRECT_URI })
    ).rejects.toMatchObject({ code: 'exchange_bad_json' });
  });

  it('throws code exchange_no_token when the body carries no access_token', async () => {
    const { client } = makeClient(() => ({ ok: true, json: async () => ({}) }));
    await expect(
      client.exchangeCode({ code: CODE, verifier: VERIFIER, redirectUri: REDIRECT_URI })
    ).rejects.toMatchObject({ code: 'exchange_no_token' });
  });
});

describe('refresh', () => {
  it('POSTs the exact refresh_token form params and returns the rotated pair', async () => {
    const accessToken = fakeJwt({ exp: 2_100_000_000 });
    const { client, calls } = makeClient(() => ({
      ok: true,
      json: async () => ({ access_token: accessToken, refresh_token: 'rt-rotated' }),
    }));

    const out = await client.refresh(REFRESH_TOKEN);

    expect(calls[0].url).toBe(TOKEN_URL);
    const params = new URLSearchParams(calls[0].init.body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('client_secret')).toBe(CLIENT_SECRET);
    expect(params.get('refresh_token')).toBe(REFRESH_TOKEN);
    expect(params.get('code')).toBeNull();

    expect(out.accessToken).toBe(accessToken);
    expect(out.refreshToken).toBe('rt-rotated');
    expect(out.expiresAtMs).toBe(2_100_000_000_000);
  });

  it('maps invalid_grant (and 400/401) to code refresh_token_invalid', async () => {
    const { client } = makeClient(() => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => '{"error":"invalid_grant"}',
    }));
    await expect(client.refresh(REFRESH_TOKEN)).rejects.toMatchObject({
      code: 'refresh_token_invalid',
    });
  });

  it('maps a 5xx to code refresh_transient', async () => {
    const { client } = makeClient(() => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'unavailable',
    }));
    await expect(client.refresh(REFRESH_TOKEN)).rejects.toMatchObject({
      code: 'refresh_transient',
    });
  });

  it('maps a network rejection to code refresh_transient', async () => {
    const { client } = makeClient(() => {
      throw new Error('ETIMEDOUT');
    });
    await expect(client.refresh(REFRESH_TOKEN)).rejects.toMatchObject({
      code: 'refresh_transient',
    });
  });
});

describe('revoke', () => {
  it('POSTs token + hint to the revoke endpoint and reports success', async () => {
    const { client, calls } = makeClient(() => ({ ok: true, json: async () => ({ success: true }) }));

    const out = await client.revoke(REFRESH_TOKEN, 'refresh_token');

    expect(calls[0].url).toBe(REVOKE_URL);
    const params = new URLSearchParams(calls[0].init.body);
    expect(params.get('token')).toBe(REFRESH_TOKEN);
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('client_secret')).toBe(CLIENT_SECRET);
    expect(params.get('token_type_hint')).toBe('refresh_token');
    expect(out).toMatchObject({ success: true });
  });

  it('never throws — a non-OK response and a network rejection both report success:false', async () => {
    const { client: httpErr } = makeClient(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    await expect(httpErr.revoke('tok', 'access_token')).resolves.toMatchObject({ success: false });

    const { client: netErr } = makeClient(() => {
      throw new Error('ECONNRESET');
    });
    await expect(netErr.revoke('tok', 'access_token')).resolves.toMatchObject({ success: false });
  });
});
