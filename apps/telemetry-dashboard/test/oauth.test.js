// Route-level tests for createOauthRouter (Change #143 continuation —
// app-identity OAuth). A minimal express app wraps the REAL router mounted
// at /oauth (matching how app.js mounts it); storage is the REAL
// createStorageService over a plain in-memory backend fake so writes are
// asserted through the actual read/cache path, not a mock. All monday
// traffic (token exchange + `me { account { id } }`) goes through an
// injected fetchImpl — zero network. Privacy: no test log call may ever
// contain the raw code or the exchanged access token.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOauthRouter, AUTHORIZE_URL, TOKEN_URL, ME_URL } from '../src/routes/oauth.js';
import { createStorageService } from '../src/services/storage.js';

const ENV = {
  mondayClientId: 'cid-owner-1',
  clientSecret: 'cs-owner-1',
  baseUrl: 'https://dashboard.example',
  allowedAccountIds: [],
};

const REDIRECT_URI = 'https://dashboard.example/oauth/callback';
const CODE = 'code-super-secret-abc';
const ACCESS_TOKEN = 'at-owner-super-secret-xyz';

function makeLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function makeBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    map,
  };
}

/** Fetch fake dispatching by URL: token exchange vs. `me` identity lookup. */
function makeFetch({ tokenResponse, meResponse, meImpl } = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === TOKEN_URL) {
      if (tokenResponse) return tokenResponse;
      return { ok: true, json: async () => ({ access_token: ACCESS_TOKEN }) };
    }
    if (String(url) === ME_URL) {
      if (meImpl) return meImpl();
      if (meResponse) return meResponse;
      return { ok: true, json: async () => ({ data: { me: { account: { id: 555 } } } }) };
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  return { calls, fetchImpl };
}

function makeHarness({ env = ENV, fetchOpts = {}, storage: injectedStorage } = {}) {
  const logger = makeLogger();
  const backend = makeBackend();
  const storage = injectedStorage ?? createStorageService({ backend, logger });
  const { calls, fetchImpl } = makeFetch(fetchOpts);
  const app = express();
  app.use('/oauth', createOauthRouter({ env, storage, logger, fetchImpl }));
  return { app, logger, backend, storage, calls, fetchImpl };
}

function tokenCall(calls) {
  return calls.find((c) => c.url === TOKEN_URL);
}

function meCall(calls) {
  return calls.find((c) => c.url === ME_URL);
}

/** Every argument ever passed to any logger method, flattened to one string. */
function allLoggerArgs(logger) {
  return ['error', 'warn', 'info', 'debug']
    .flatMap((method) => logger[method].mock.calls)
    .map((args) => JSON.stringify(args))
    .join('\n');
}

describe('GET /oauth/start', () => {
  it('302-redirects to the monday authorize URL with client_id, redirect_uri and the exact scope', async () => {
    const { app } = makeHarness();

    const res = await request(app).get('/oauth/start');

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZE_URL);
    expect(location.searchParams.get('client_id')).toBe('cid-owner-1');
    expect(location.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(location.searchParams.get('scope')).toBe('boards:read boards:write me:read');
  });
});

describe('GET /oauth/callback — no allowlist', () => {
  it('exchanges the code with the exact POST parameters and stores the token via storage.setOwnerToken', async () => {
    const { app, backend, storage, calls } = makeHarness();

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Authorized');

    const exchange = tokenCall(calls);
    expect(exchange).toBeTruthy();
    expect(String(exchange.init.method).toUpperCase()).toBe('POST');
    const params = new URLSearchParams(exchange.init.body);
    expect(params.get('code')).toBe(CODE);
    expect(params.get('client_id')).toBe('cid-owner-1');
    expect(params.get('client_secret')).toBe('cs-owner-1');
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);

    expect(backend.map.get('owner:oauth_token')).toBe(ACCESS_TOKEN);
    await expect(storage.getOwnerToken()).resolves.toBe(ACCESS_TOKEN);
    // No allowlist configured → the `me` identity check is never called.
    expect(meCall(calls)).toBeUndefined();
  });

  it('rejects a callback missing the code with 400 and calls no fetch at all', async () => {
    const { app, calls } = makeHarness();

    const res = await request(app).get('/oauth/callback');

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('renders a failure response on a consent error (?error=access_denied) without calling fetch', async () => {
    const { app, calls } = makeHarness();

    const res = await request(app).get('/oauth/callback').query({ error: 'access_denied' });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('responds 502 and stores NO token when the token exchange returns non-OK', async () => {
    const { app, backend } = makeHarness({
      fetchOpts: { tokenResponse: { ok: false, status: 400, text: async () => 'bad request' } },
    });

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(502);
    expect(backend.map.has('owner:oauth_token')).toBe(false);
  });

  it('responds 502 and stores NO token when the exchange body carries no access_token', async () => {
    const { app, backend } = makeHarness({
      fetchOpts: { tokenResponse: { ok: true, json: async () => ({}) } },
    });

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(502);
    expect(backend.map.has('owner:oauth_token')).toBe(false);
  });

  it('responds 502 and stores NO token when the token endpoint rejects (network failure)', async () => {
    const { app, backend, logger } = makeHarness({
      fetchOpts: { tokenResponse: undefined },
    });
    // Override with a rejecting fetchImpl.
    const rejecting = vi.fn(async (url) => {
      if (String(url) === TOKEN_URL) throw new Error('ECONNREFUSED');
      throw new Error('unexpected');
    });
    const backend2 = makeBackend();
    const storage2 = createStorageService({ backend: backend2, logger });
    const app2 = express();
    app2.use('/oauth', createOauthRouter({ env: ENV, storage: storage2, logger, fetchImpl: rejecting }));

    const res = await request(app2).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(502);
    expect(backend2.map.has('owner:oauth_token')).toBe(false);
    expect(backend.map.has('owner:oauth_token')).toBe(false); // untouched first harness
  });
});

describe('GET /oauth/callback — account allowlist', () => {
  const ALLOWLISTED_ENV = { ...ENV, allowedAccountIds: ['555'] };
  const OTHER_ENV = { ...ENV, allowedAccountIds: ['999', '111'] };

  it('IS in the allowlist → fetches me, stores the token, 200', async () => {
    const { app, backend, calls } = makeHarness({ env: ALLOWLISTED_ENV });

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(200);
    const identity = meCall(calls);
    expect(identity).toBeTruthy();
    expect(new Headers(identity.init.headers).get('authorization')).toBe(ACCESS_TOKEN);
    expect(backend.map.get('owner:oauth_token')).toBe(ACCESS_TOKEN);
  });

  it('is NOT in the allowlist → 403 and does NOT store the token', async () => {
    const { app, backend } = makeHarness({ env: OTHER_ENV });

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(403);
    expect(backend.map.has('owner:oauth_token')).toBe(false);
  });

  it('fails closed (403, no store) when the identity check itself fails (me endpoint down)', async () => {
    const { app, backend } = makeHarness({
      env: ALLOWLISTED_ENV,
      fetchOpts: { meImpl: () => { throw new Error('me endpoint unreachable'); } },
    });

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(403);
    expect(backend.map.has('owner:oauth_token')).toBe(false);
  });

  it('fails closed (403, no store) when `me` returns a GraphQL soft error', async () => {
    const { app, backend } = makeHarness({
      env: ALLOWLISTED_ENV,
      fetchOpts: {
        meResponse: { ok: true, json: async () => ({ errors: [{ message: 'Not authenticated' }] }) },
      },
    });

    const res = await request(app).get('/oauth/callback').query({ code: CODE });

    expect(res.status).toBe(403);
    expect(backend.map.has('owner:oauth_token')).toBe(false);
  });
});

describe('privacy — never log the code or the access token', () => {
  it('no logger call ever contains the raw code or the exchanged access token, on success or failure', async () => {
    const { app, logger } = makeHarness();
    await request(app).get('/oauth/callback').query({ code: CODE });

    const { app: app2, logger: logger2 } = makeHarness({
      fetchOpts: { tokenResponse: { ok: false, status: 401, text: async () => 'bad' } },
    });
    await request(app2).get('/oauth/callback').query({ code: CODE });

    for (const l of [logger, logger2]) {
      const logged = allLoggerArgs(l);
      expect(logged).not.toContain(CODE);
      expect(logged).not.toContain(ACCESS_TOKEN);
    }
  });
});
