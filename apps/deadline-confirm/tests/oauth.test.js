// Integration tests for the OAuth authorization-code flow (spec §8, §13).
// The REAL Express pipeline runs via createApp with a memory backend and a
// captured fake fetch — the token-exchange request ARGUMENTS are asserted,
// not just call counts. Backend keys are inspected directly.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountId: '777',
  baseUrl: 'https://app.example',
};

const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
const TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const EXPECTED_SCOPE = 'me:read boards:read boards:write updates:write';
const REDIRECT_URI = 'https://app.example/oauth/callback';

function makeHarness({ exchangeResponse } = {}) {
  const backend = createMemoryBackend();
  const storage = createAppStorage({ backend });
  const exchangeCalls = [];
  const fetchImpl = vi.fn(async (url, options = {}) => {
    exchangeCalls.push({ url: String(url), options });
    if (exchangeResponse) return exchangeResponse;
    return { ok: true, json: async () => ({ access_token: 'at-42' }) };
  });
  const api = { fetchMe: vi.fn(async () => ({ id: '9', name: 'דנה' })) };
  const app = createApp({
    storage,
    api,
    rateLimiter: { allow: () => true },
    env: ENV,
    fetchImpl,
  });
  return { app, backend, storage, api, fetchImpl, exchangeCalls };
}

/** Normalize the captured exchange body (URLSearchParams or string). */
function bodyParams(options) {
  const body = options.body;
  return body instanceof URLSearchParams ? body : new URLSearchParams(String(body));
}

describe('GET /oauth/start', () => {
  it('302-redirects to the monday authorize URL with client_id, redirect_uri, exact scope, and a persisted state nonce', async () => {
    const { app, backend } = makeHarness();

    const res = await request(app).get('/oauth/start');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZE_URL);
    expect(location.searchParams.get('client_id')).toBe('cid-1');
    expect(location.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(location.searchParams.get('scope')).toBe(EXPECTED_SCOPE);

    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    const persisted = await backend.get(`oauth_state:${state}`);
    expect(persisted).toBeDefined();
    expect(persisted).not.toBeNull();
  });

  it('generates a DIFFERENT state nonce on each start request', async () => {
    const { app } = makeHarness();

    const first = await request(app).get('/oauth/start');
    const second = await request(app).get('/oauth/start');

    const state1 = new URL(first.headers.location).searchParams.get('state');
    const state2 = new URL(second.headers.location).searchParams.get('state');
    expect(state1).toBeTruthy();
    expect(state2).toBeTruthy();
    expect(state1).not.toBe(state2);
  });
});

describe('GET /oauth/callback', () => {
  it('exchanges the code with the exact POST parameters, stores token+identity, deletes the state, and renders the done page', async () => {
    const { app, backend, storage, api, exchangeCalls } = makeHarness();
    await storage.issueOauthState('state-nonce-1');

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-nonce-1' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('החיבור הושלם ✓');

    expect(exchangeCalls).toHaveLength(1);
    const { url, options } = exchangeCalls[0];
    expect(url).toBe(TOKEN_URL);
    expect(String(options.method).toUpperCase()).toBe('POST');
    const params = bodyParams(options);
    expect(params.get('code')).toBe('code-abc');
    expect(params.get('client_id')).toBe('cid-1');
    expect(params.get('client_secret')).toBe('cs-1');
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);

    expect(await backend.get('oauth_token')).toBe('at-42');
    expect(api.fetchMe).toHaveBeenCalledWith({ token: 'at-42' });
    expect(await backend.get('oauth_identity')).toStrictEqual({ id: '9', name: 'דנה' });
    expect(await backend.get('oauth_state:state-nonce-1')).toBeNull();
  });

  it('rejects a REPLAYED state with 400 and performs no second token exchange (nonce is single-use)', async () => {
    const { app, storage, exchangeCalls } = makeHarness();
    await storage.issueOauthState('state-replay');

    const first = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-replay' });
    const second = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-replay' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(exchangeCalls).toHaveLength(1);
  });

  it('rejects an unknown state with 400 without calling the token endpoint', async () => {
    const { app, fetchImpl } = makeHarness();

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'never-issued' });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a callback missing the code with 400 without calling the token endpoint', async () => {
    const { app, storage, fetchImpl } = makeHarness();
    await storage.issueOauthState('state-no-code');

    const res = await request(app)
      .get('/oauth/callback')
      .query({ state: 'state-no-code' });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a callback missing the state with 400 without calling the token endpoint', async () => {
    const { app, fetchImpl } = makeHarness();

    const res = await request(app).get('/oauth/callback').query({ code: 'code-abc' });

    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('renders the failure page on a consent error (?error=access_denied) without calling the token endpoint', async () => {
    const { app, fetchImpl } = makeHarness();

    const res = await request(app)
      .get('/oauth/callback')
      .query({ error: 'access_denied' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('החיבור נכשל');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('responds 502 and stores NO oauth_token when the token exchange returns non-OK', async () => {
    const { app, backend, storage } = makeHarness({
      exchangeResponse: { ok: false, status: 400, text: async () => 'bad' },
    });
    await storage.issueOauthState('state-bad-exchange');

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-bad-exchange' });

    expect(res.status).toBe(502);
    expect(await backend.get('oauth_token')).toBeNull();
  });

  it('still completes the flow (done page + stored token, no identity) when fetchMe rejects', async () => {
    const { app, backend, storage, api } = makeHarness();
    api.fetchMe.mockRejectedValue(new Error('me endpoint down'));
    await storage.issueOauthState('state-me-fails');

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-me-fails' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('החיבור הושלם ✓');
    expect(await backend.get('oauth_token')).toBe('at-42');
    expect(await backend.get('oauth_identity')).toBeNull();
  });
});
