import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_TTL_MS,
  REVOKE_URL,
  TOKEN_URL,
  createMondayOauthClient,
  decodeJwtExpMs,
} from './mondayOauthClient.js';

function jwtWith(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

function response({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

describe('decodeJwtExpMs', () => {
  it('returns the exp claim as an exact millisecond timestamp', () => {
    expect(decodeJwtExpMs(jwtWith({ exp: 1_700_000_123 }))).toBe(1_700_000_123_000);
  });

  it.each([null, '', 'opaque', jwtWith({ exp: '1700000123' }), jwtWith({})])(
    'returns null for an undecodable or non-numeric expiry %#',
    (token) => expect(decodeJwtExpMs(token)).toBeNull(),
  );
});

describe('createMondayOauthClient', () => {
  it('exchanges an authorization code at the OAuth 2.1 endpoint with PKCE', async () => {
    const accessToken = jwtWith({ exp: 2_000 });
    const fetchImpl = vi.fn().mockResolvedValue(response({
      body: { access_token: accessToken, refresh_token: 'refresh-2' },
    }));
    const client = createMondayOauthClient({
      clientId: 'client-1', clientSecret: 'secret-1', fetchImpl, now: () => 1_000,
    });

    await expect(client.exchangeCode({
      code: 'code-1', verifier: 'verifier-1', redirectUri: 'https://app.test/oauth/callback',
    })).resolves.toEqual({
      accessToken,
      refreshToken: 'refresh-2',
      expiresAtMs: 2_000_000,
      expUndecodable: false,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(options.body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      client_secret: 'secret-1',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'https://app.test/oauth/callback',
    });
  });

  it('uses a bounded fallback expiry when monday returns an opaque access token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ body: { access_token: 'opaque' } }));
    const client = createMondayOauthClient({
      clientId: 'client-1', clientSecret: 'secret-1', fetchImpl, now: () => 5_000,
    });

    await expect(client.exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'https://x' }))
      .resolves.toEqual({
        accessToken: 'opaque',
        refreshToken: null,
        expiresAtMs: 5_000 + FALLBACK_TTL_MS,
        expUndecodable: true,
      });
  });

  it('classifies exchange transport, HTTP, JSON, and missing-token failures', async () => {
    const cases = [
      [vi.fn().mockRejectedValue(new Error('offline')), 'exchange_network'],
      [vi.fn().mockResolvedValue(response({ ok: false, status: 503 })), 'exchange_http'],
      [vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockRejectedValue(new Error('bad json')) }), 'exchange_bad_json'],
      [vi.fn().mockResolvedValue(response({ body: {} })), 'exchange_no_token'],
    ];

    for (const [fetchImpl, code] of cases) {
      const client = createMondayOauthClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });
      await expect(client.exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'https://x' }))
        .rejects.toMatchObject({ code });
    }
  });

  it('refreshes with the single-use token and returns the rotated pair', async () => {
    const accessToken = jwtWith({ exp: 3_000 });
    const fetchImpl = vi.fn().mockResolvedValue(response({
      body: { access_token: accessToken, refresh_token: 'refresh-new' },
    }));
    const client = createMondayOauthClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

    await expect(client.refresh('refresh-old')).resolves.toMatchObject({
      accessToken,
      refreshToken: 'refresh-new',
      expiresAtMs: 3_000_000,
    });
    expect(Object.fromEntries(fetchImpl.mock.calls[0][1].body)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'id',
      client_secret: 'secret',
      refresh_token: 'refresh-old',
    });
  });

  it.each([400, 401])('marks HTTP %i refresh rejection as permanently invalid', async (status) => {
    const client = createMondayOauthClient({
      clientId: 'id', clientSecret: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(response({ ok: false, status })),
    });
    await expect(client.refresh('refresh-old')).rejects.toMatchObject({
      code: 'refresh_token_invalid', status,
    });
  });

  it('marks network and server refresh failures as transient', async () => {
    const networkClient = createMondayOauthClient({
      clientId: 'id', clientSecret: 'secret',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    });
    await expect(networkClient.refresh('refresh')).rejects.toMatchObject({ code: 'refresh_transient' });

    const serverClient = createMondayOauthClient({
      clientId: 'id', clientSecret: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(response({ ok: false, status: 503 })),
    });
    await expect(serverClient.refresh('refresh')).rejects.toMatchObject({
      code: 'refresh_transient', status: 503,
    });
  });

  it('revokes the requested token with its type hint and surfaces failures', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ ok: false, status: 502 }));
    const client = createMondayOauthClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

    await expect(client.revoke('refresh-1', 'refresh_token')).resolves.toEqual({ success: true });
    expect(fetchImpl.mock.calls[0][0]).toBe(REVOKE_URL);
    expect(Object.fromEntries(fetchImpl.mock.calls[0][1].body)).toEqual({
      token: 'refresh-1', client_id: 'id', client_secret: 'secret', token_type_hint: 'refresh_token',
    });
    await expect(client.revoke('access-1', 'access_token')).rejects.toMatchObject({
      code: 'revoke_http', status: 502,
    });
  });
});
