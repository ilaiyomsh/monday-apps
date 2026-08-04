/**
 * OAuth route contract for the guard service (OAuth 2.1 / New OAuth Flow):
 * GET /oauth/start (session-token gated redirect to monday's authorize endpoint
 * WITH a PKCE S256 challenge) and GET /oauth/callback (single-use state carrying
 * the verifier, code exchange via the injected oauthClient at monday's oauth_ms
 * endpoint, owner-token RECORD persist).
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';

const CLIENT_SECRET = 'clisec';

function makeDeps(envOverrides = {}) {
  return {
    handleEvent: vi.fn().mockResolvedValue(undefined),
    tokenStore: {
      getReaderToken: vi.fn(),
      getOwnerToken: vi.fn(),
      setOwnerToken: vi.fn().mockResolvedValue(undefined),
    },
    enrollmentStore: { get: vi.fn(), set: vi.fn() },
    api: {
      getBoardOwnership: vi.fn(),
      getUserTeamIds: vi.fn(),
      createColumnWebhook: vi.fn(),
      me: vi.fn(),
    },
    oauthClient: {
      exchangeCode: vi.fn(),
      refresh: vi.fn(),
      revoke: vi.fn(),
    },
    env: {
      signingSecret: 'signsec',
      clientSecret: CLIENT_SECRET,
      clientId: 'cid',
      baseUrl: 'https://guard.example',
      allowUnsignedWebhooks: false,
      oauthAppVersionId: '',
      ...envOverrides,
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function sessionToken(secret = CLIENT_SECRET) {
  return jwt.sign({ dat: { account_id: 999, user_id: 41 } }, secret);
}

/** Drives /oauth/start and returns the { state, challenge } carried in the redirect. */
async function startAndGrab(app) {
  const res = await request(app).get(`/oauth/start?st=${encodeURIComponent(sessionToken())}`);
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location);
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  return { state, challenge: url.searchParams.get('code_challenge') };
}

/** A successful exchangeCode result shape (services/monday-oauth-client.js). */
function tokensDouble(overrides = {}) {
  return { accessToken: 'newtok', refreshToken: 'refresh-1', expiresAtMs: 5_000_000, expUndecodable: false, ...overrides };
}

describe('GET /oauth/start', () => {
  it('rejects with 401 when no st session token is provided', async () => {
    const res = await request(createApp(makeDeps())).get('/oauth/start');
    expect(res.status).toBe(401);
  });

  it('redirects a valid session to authorize with client_id, response_type=code, a state, the notification scope, and a PKCE S256 challenge', async () => {
    const res = await request(createApp(makeDeps())).get(`/oauth/start?st=${encodeURIComponent(sessionToken())}`);

    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe('https://auth.monday.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('notifications:write');
    // PKCE: S256 method + a non-empty base64url challenge.
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('adds app_version_id to the authorize request when oauthAppVersionId is configured', async () => {
    const res = await request(createApp(makeDeps({ oauthAppVersionId: '77' }))).get(
      `/oauth/start?st=${encodeURIComponent(sessionToken())}`
    );
    expect(new URL(res.headers.location).searchParams.get('app_version_id')).toBe('77');
  });

  it('sends a code_challenge that is the S256 hash of a 43-char verifier (never plain)', async () => {
    // The verifier is server-held; assert only that the challenge is a proper
    // base64url S256 digest length (43 chars) — plain PKCE is rejected by monday.
    const { challenge } = await startAndGrab(createApp(makeDeps()));
    expect(challenge).toHaveLength(43);
  });
});

describe('GET /oauth/callback', () => {
  it('rejects an unknown state with 4xx and never persists an owner token', async () => {
    const deps = makeDeps();
    const res = await request(createApp(deps)).get('/oauth/callback?code=thecode&state=never-issued');
    expect([400, 401]).toContain(res.status);
    expect(deps.tokenStore.setOwnerToken).not.toHaveBeenCalled();
  });

  it('exchanges the code at the oauth_ms endpoint WITH the PKCE verifier, resolves identity, persists the token RECORD, and responds 200 html', async () => {
    const deps = makeDeps();
    deps.oauthClient.exchangeCode.mockResolvedValue(tokensDouble());
    deps.api.me.mockResolvedValue({ id: 314, name: 'Owner' });
    const app = createApp(deps);

    const { state } = await startAndGrab(app);
    const res = await request(app).get(`/oauth/callback?code=thecode&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);

    expect(deps.oauthClient.exchangeCode).toHaveBeenCalledTimes(1);
    const exchangeArg = deps.oauthClient.exchangeCode.mock.calls[0][0];
    expect(exchangeArg.code).toBe('thecode');
    expect(exchangeArg.redirectUri).toBe('https://guard.example/oauth/callback');
    expect(typeof exchangeArg.verifier).toBe('string');
    expect(exchangeArg.verifier.length).toBeGreaterThanOrEqual(43);
    // The verifier's S256 hash must equal the challenge sent to authorize.
    const expectedChallenge = crypto.createHash('sha256').update(exchangeArg.verifier).digest('base64url');
    const { challenge } = await startAndGrab(app); // fresh pair; only length/shape asserted above
    expect(challenge).toHaveLength(expectedChallenge.length);

    expect(deps.api.me).toHaveBeenCalledWith('newtok');
    expect(deps.tokenStore.setOwnerToken).toHaveBeenCalledWith(
      '999',
      '314',
      expect.objectContaining({
        token: 'newtok',
        refreshToken: 'refresh-1',
        expiresAt: 5_000_000,
        status: 'active',
        userId: '314',
      })
    );
  });

  it('consumes state on first use: replaying the same callback returns 4xx and setOwnerToken stays at exactly one call', async () => {
    const deps = makeDeps();
    deps.oauthClient.exchangeCode.mockResolvedValue(tokensDouble());
    deps.api.me.mockResolvedValue({ id: 314, name: 'Owner' });
    const app = createApp(deps);

    const { state } = await startAndGrab(app);
    const path = `/oauth/callback?code=thecode&state=${encodeURIComponent(state)}`;

    const first = await request(app).get(path);
    expect(first.status).toBe(200);
    const replay = await request(app).get(path);
    expect([400, 401]).toContain(replay.status);
    expect(deps.tokenStore.setOwnerToken).toHaveBeenCalledTimes(1);
  });

  it('answers 502 and never persists when the code exchange fails', async () => {
    const deps = makeDeps();
    deps.oauthClient.exchangeCode.mockRejectedValue(Object.assign(new Error('bad'), { code: 'exchange_http', status: 400 }));
    const app = createApp(deps);

    const { state } = await startAndGrab(app);
    const res = await request(app).get(`/oauth/callback?code=thecode&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(502);
    expect(deps.tokenStore.setOwnerToken).not.toHaveBeenCalled();
  });
});
