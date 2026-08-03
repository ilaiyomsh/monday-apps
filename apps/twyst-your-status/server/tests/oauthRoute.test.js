/**
 * OAuth route contract for the guard service: GET /oauth/start (session-token
 * gated redirect to monday's authorize endpoint) and GET /oauth/callback
 * (single-use state, token exchange via injected fetchImpl, owner-token persist).
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';

const CLIENT_SECRET = 'clisec';

function makeDeps(envOverrides = {}) {
  return {
    handleEvent: vi.fn().mockResolvedValue(undefined),
    tokenStore: {
      getReaderToken: vi.fn(),
      getOwnerToken: vi.fn(),
      setOwnerToken: vi.fn(),
    },
    enrollmentStore: { get: vi.fn(), set: vi.fn() },
    api: {
      getBoardOwnership: vi.fn(),
      getUserTeamIds: vi.fn(),
      createColumnWebhook: vi.fn(),
      me: vi.fn(),
    },
    env: {
      signingSecret: 'signsec',
      clientSecret: CLIENT_SECRET,
      clientId: 'cid',
      baseUrl: 'https://guard.example',
      allowUnsignedWebhooks: false,
      ...envOverrides,
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    fetchImpl: vi.fn(),
  };
}

function sessionToken(secret = CLIENT_SECRET) {
  return jwt.sign({ dat: { account_id: 999, user_id: 41 } }, secret);
}

/** Drives /oauth/start and returns the state carried in the redirect. */
async function startAndGrabState(app) {
  const res = await request(app).get(`/oauth/start?st=${encodeURIComponent(sessionToken())}`);
  expect(res.status).toBe(302);
  const state = new URL(res.headers.location).searchParams.get('state');
  expect(state).toBeTruthy();
  return state;
}

describe('GET /oauth/start', () => {
  it('rejects with 401 when no st session token is provided', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app).get('/oauth/start');

    expect(res.status).toBe(401);
  });

  it('redirects a valid session token to monday authorize with client_id, response_type=code, a non-empty state, and the notification scope', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app).get(`/oauth/start?st=${encodeURIComponent(sessionToken())}`);

    expect(res.status).toBe(302);
    const location = res.headers.location;
    expect(location.startsWith('https://auth.monday.com/oauth2/authorize')).toBe(true);

    const url = new URL(location);
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('state')).not.toBe('');
    const scope = url.searchParams.get('scope');
    expect(scope).toContain('notifications:write');
  });
});

describe('GET /oauth/callback', () => {
  it('rejects an unknown state with 4xx and never persists an owner token', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app).get('/oauth/callback?code=thecode&state=never-issued-state');

    expect([400, 401]).toContain(res.status);
    expect(deps.tokenStore.setOwnerToken).not.toHaveBeenCalled();
  });

  it('exchanges the code at monday token endpoint, resolves the owner identity, persists the owner token, and responds 200 html (full flow)', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'newtok' }),
    });
    deps.api.me.mockResolvedValue({ id: 314, name: 'Owner' });
    const app = createApp(deps);

    const state = await startAndGrabState(app);

    const res = await request(app).get(
      `/oauth/callback?code=thecode&state=${encodeURIComponent(state)}`
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);

    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [exchangeUrl, exchangeInit] = deps.fetchImpl.mock.calls[0];
    expect(String(exchangeUrl)).toBe('https://auth.monday.com/oauth2/token');
    expect(exchangeInit.method).toMatch(/post/i);
    // Body may be JSON or URL-encoded — assert the required params are present either way.
    const bodyStr = String(exchangeInit.body);
    expect(bodyStr).toContain('code');
    expect(bodyStr).toContain('thecode');
    expect(bodyStr).toContain('client_id');
    expect(bodyStr).toContain('cid');
    expect(bodyStr).toContain('client_secret');
    expect(bodyStr).toContain('clisec');

    expect(deps.api.me).toHaveBeenCalledWith('newtok');
    expect(deps.tokenStore.setOwnerToken).toHaveBeenCalledWith(
      '999',
      '314',
      expect.objectContaining({ token: 'newtok', userId: '314' })
    );
  });

  it('consumes state on first use: replaying the same callback returns 4xx and setOwnerToken stays at exactly one call', async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'newtok' }),
    });
    deps.api.me.mockResolvedValue({ id: 314, name: 'Owner' });
    const app = createApp(deps);

    const state = await startAndGrabState(app);
    const callbackPath = `/oauth/callback?code=thecode&state=${encodeURIComponent(state)}`;

    const first = await request(app).get(callbackPath);
    expect(first.status).toBe(200);

    const replay = await request(app).get(callbackPath);
    expect([400, 401]).toContain(replay.status);
    expect(deps.tokenStore.setOwnerToken).toHaveBeenCalledTimes(1);
  });
});
