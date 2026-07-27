// Integration tests for the OAuth authorization-code flow (spec §8, §13) —
// v3 multi-tenant: /oauth/start is gated on a monday sessionToken passed as
// ?st= (verified with the client secret, optionally allowlist-checked); the
// state nonce records the accountId; the callback stores token+identity UNDER
// that account via storage.forAccount(accountId). The REAL Express pipeline
// runs via createApp with a memory backend and a captured fake fetch — the
// token-exchange request ARGUMENTS are asserted, not just call counts.
// Backend keys are inspected directly.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';
const OTHER_ACCOUNT_ID = '888';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};

const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
const TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const EXPECTED_SCOPE = 'me:read boards:read boards:write updates:write';
const REDIRECT_URI = 'https://app.example/oauth/callback';
const OAUTH_ERROR_HEADING = 'החיבור נכשל';

/** A real monday-style sessionToken signed with the app client secret. */
function signSt({ accountId = 777, userId = 12, secret = 'cs-1', payload } = {}) {
  return jwt.sign(payload ?? { dat: { account_id: accountId, user_id: userId } }, secret);
}

function makeHarness({ exchangeResponse, env } = {}) {
  const inner = createMemoryBackend();
  const setKeys = [];
  const backend = {
    get: (key) => inner.get(key),
    set: (key, value) => {
      setKeys.push(key);
      return inner.set(key, value);
    },
    delete: (key) => inner.delete(key),
  };
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
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: env ?? ENV,
    fetchImpl,
  });
  const issuedStateKeys = () => setKeys.filter((key) => key.startsWith('oauth_state:'));
  return { app, backend, storage, api, fetchImpl, exchangeCalls, issuedStateKeys };
}

/** Normalize the captured exchange body (URLSearchParams or string). */
function bodyParams(options) {
  const body = options.body;
  return body instanceof URLSearchParams ? body : new URLSearchParams(String(body));
}

describe('GET /oauth/start — sessionToken gate (v3)', () => {
  it("302-redirects a VALID st to the monday authorize URL with client_id, redirect_uri, exact scope, and a persisted state record carrying the token's accountId", async () => {
    const { app, backend } = makeHarness();

    const res = await request(app).get('/oauth/start').query({ st: signSt() });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZE_URL);
    expect(location.searchParams.get('client_id')).toBe('cid-1');
    expect(location.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(location.searchParams.get('scope')).toBe(EXPECTED_SCOPE);

    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    const persisted = await backend.get(`oauth_state:${state}`);
    expect(persisted).not.toBeNull();
    expect(persisted.accountId).toBe(ACCOUNT_ID);
  });

  it('targets the draft version with app_version_id when env.oauthAppVersionId is set (per-version OAuth config)', async () => {
    const { app } = makeHarness({ env: { ...ENV, oauthAppVersionId: '16075522' } });

    const res = await request(app).get('/oauth/start').query({ st: signSt() });

    const location = new URL(res.headers.location);
    expect(location.searchParams.get('app_version_id')).toBe('16075522');
  });

  it('omits app_version_id from the authorize URL when env.oauthAppVersionId is unset (production default)', async () => {
    const { app } = makeHarness();

    const res = await request(app).get('/oauth/start').query({ st: signSt() });

    const location = new URL(res.headers.location);
    expect(location.searchParams.get('app_version_id')).toBeNull();
  });

  it('generates a DIFFERENT state nonce on each start request', async () => {
    const { app } = makeHarness();

    const first = await request(app).get('/oauth/start').query({ st: signSt() });
    const second = await request(app).get('/oauth/start').query({ st: signSt() });

    const state1 = new URL(first.headers.location).searchParams.get('state');
    const state2 = new URL(second.headers.location).searchParams.get('state');
    expect(state1).toBeTruthy();
    expect(state2).toBeTruthy();
    expect(state1).not.toBe(state2);
  });

  it('responds 401 with the oauthErrorPage — no redirect, NO state issued — when st is missing', async () => {
    const { app, issuedStateKeys } = makeHarness();

    const res = await request(app).get('/oauth/start');

    expect(res.status).toBe(401);
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(res.headers.location).toBeUndefined();
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it('responds 401 with the oauthErrorPage and issues no state when st is the empty string', async () => {
    const { app, issuedStateKeys } = makeHarness();

    const res = await request(app).get('/oauth/start').query({ st: '' });

    expect(res.status).toBe(401);
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it('responds 401 and issues no state for an st signed with the WRONG secret', async () => {
    const { app, issuedStateKeys } = makeHarness();

    const res = await request(app)
      .get('/oauth/start')
      .query({ st: signSt({ secret: 'not-the-client-secret' }) });

    expect(res.status).toBe(401);
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(res.headers.location).toBeUndefined();
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it('responds 401 and issues no state for a malformed st', async () => {
    const { app, issuedStateKeys } = makeHarness();

    const res = await request(app).get('/oauth/start').query({ st: 'not-a-jwt' });

    expect(res.status).toBe(401);
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it('responds 401 and issues no state for a validly-signed st without a dat identity', async () => {
    const { app, issuedStateKeys } = makeHarness();

    const res = await request(app)
      .get('/oauth/start')
      .query({ st: signSt({ payload: { account_id: 777, user_id: 12 } }) });

    expect(res.status).toBe(401);
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it("responds 403 with the oauthErrorPage and issues no state when the token's account is OUTSIDE a non-empty allowlist", async () => {
    const { app, issuedStateKeys } = makeHarness({
      env: { ...ENV, allowedAccountIds: [OTHER_ACCOUNT_ID] },
    });

    const res = await request(app).get('/oauth/start').query({ st: signSt({ accountId: 777 }) });

    expect(res.status).toBe(403);
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(res.headers.location).toBeUndefined();
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it('responds 403 and issues no state when allowedAccountIds is EMPTY (D15 default-deny)', async () => {
    const { app, issuedStateKeys } = makeHarness({
      env: { ...ENV, allowedAccountIds: [] },
    });

    const res = await request(app).get('/oauth/start').query({ st: signSt({ accountId: 777 }) });

    expect(res.status).toBe(403);
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(res.headers.location).toBeUndefined();
    expect(issuedStateKeys()).toHaveLength(0);
  });

  it("302-redirects when the token's account IS in a non-empty allowlist", async () => {
    const { app } = makeHarness({
      env: { ...ENV, allowedAccountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] },
    });

    const res = await request(app).get('/oauth/start').query({ st: signSt({ accountId: 777 }) });

    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get('state')).toBeTruthy();
  });
});

describe('GET /oauth/callback', () => {
  it("exchanges the code with the exact POST parameters, stores token+identity UNDER THE STATE'S ACCOUNT, deletes the state, and renders the done page", async () => {
    const { app, backend, storage, api, exchangeCalls } = makeHarness();
    await storage.issueOauthState('state-nonce-1', ACCOUNT_ID);

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

    // Scoped persistence: the 777-prefixed keys hold the data…
    expect(await backend.get(`${ACCOUNT_ID}:oauth_token`)).toBe('at-42');
    expect(api.fetchMe).toHaveBeenCalledWith({ token: 'at-42' });
    expect(await backend.get(`${ACCOUNT_ID}:oauth_identity`)).toStrictEqual({
      id: '9',
      name: 'דנה',
    });
    // …readable back through the same account's scope…
    await expect(storage.forAccount(ACCOUNT_ID).getOauthToken()).resolves.toBe('at-42');
    // …and INVISIBLE to a different account.
    await expect(storage.forAccount(OTHER_ACCOUNT_ID).getOauthToken()).resolves.toBeNull();
    await expect(storage.forAccount(OTHER_ACCOUNT_ID).getOauthIdentity()).resolves.toBeNull();

    expect(await backend.get('oauth_state:state-nonce-1')).toBeNull();
  });

  it('rejects a REPLAYED state with 400 and performs no second token exchange (nonce is single-use)', async () => {
    const { app, storage, exchangeCalls } = makeHarness();
    await storage.issueOauthState('state-replay', ACCOUNT_ID);

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

  it("rejects an unknown state with the 400 'הקישור פג תוקף' page without calling the token endpoint", async () => {
    const { app, fetchImpl } = makeHarness();

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'never-issued' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('הקישור פג תוקף');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a callback missing the code with 400 without calling the token endpoint', async () => {
    const { app, storage, fetchImpl } = makeHarness();
    await storage.issueOauthState('state-no-code', ACCOUNT_ID);

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
    expect(res.text).toContain(OAUTH_ERROR_HEADING);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("responds 502 and stores NO oauth_token under the account when the token exchange returns non-OK", async () => {
    const { app, backend, storage } = makeHarness({
      exchangeResponse: { ok: false, status: 400, text: async () => 'bad' },
    });
    await storage.issueOauthState('state-bad-exchange', ACCOUNT_ID);

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-bad-exchange' });

    expect(res.status).toBe(502);
    expect(await backend.get(`${ACCOUNT_ID}:oauth_token`)).toBeNull();
  });

  it('still completes the flow (done page + account-scoped token, no identity) when fetchMe rejects', async () => {
    const { app, backend, storage, api } = makeHarness();
    api.fetchMe.mockRejectedValue(new Error('me endpoint down'));
    await storage.issueOauthState('state-me-fails', ACCOUNT_ID);

    const res = await request(app)
      .get('/oauth/callback')
      .query({ code: 'code-abc', state: 'state-me-fails' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('החיבור הושלם ✓');
    expect(await backend.get(`${ACCOUNT_ID}:oauth_token`)).toBe('at-42');
    expect(await backend.get(`${ACCOUNT_ID}:oauth_identity`)).toBeNull();
  });
});
