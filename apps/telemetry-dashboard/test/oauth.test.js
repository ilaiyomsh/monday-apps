// Route-level tests for createOauthRouter — monday OAuth 2.1 (Change #144).
// A minimal express app wraps the REAL router mounted at /oauth (matching how
// app.js mounts it); storage is the REAL createStorageService over a plain
// in-memory backend fake so state + token-record writes are asserted through
// the actual read/cache path, not a mock; the monday OAuth client is the REAL
// createMondayOauthClient over an injected fetchImpl — zero network.
//
// Contract under test (OAuth 2.1):
//   /start    → 302 with response_type=code, a single-use CSRF state nonce and
//               a PKCE S256 code_challenge derived from a stored verifier.
//   /callback → consumes the state (replay/expiry → 400), exchanges at the NEW
//               oauth_ms token endpoint with grant_type + code_verifier, and
//               persists a v2 token RECORD (access + rotating refresh + exp).
// Privacy: no log call may ever contain the code, the state nonce, the PKCE
// verifier, or either token.

import crypto from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOauthRouter, AUTHORIZE_URL, ME_URL } from '../src/routes/oauth.js';
import { createMondayOauthClient, TOKEN_URL } from '../src/services/monday-oauth-client.js';
import { createStorageService, OWNER_TOKEN_KEY, OAUTH_STATE_PREFIX } from '../src/services/storage.js';

const ENV = {
  mondayClientId: 'cid-owner-1',
  clientSecret: 'cs-owner-1',
  baseUrl: 'https://dashboard.example',
  allowedAccountIds: [],
  oauthAppVersionId: '',
};

const REDIRECT_URI = 'https://dashboard.example/oauth/callback';
const CODE = 'code-super-secret-abc';

/** A structurally valid JWT whose payload carries the given claims. */
function fakeJwt(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

const ACCESS_EXP_S = 2_000_000_000;
const ACCESS_TOKEN = fakeJwt({ exp: ACCESS_EXP_S });
const REFRESH_TOKEN = 'rt-owner-super-secret';

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
      if (typeof tokenResponse === 'function') return tokenResponse();
      if (tokenResponse) return tokenResponse;
      return {
        ok: true,
        json: async () => ({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN }),
      };
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

function makeHarness({ env = ENV, fetchOpts = {}, now } = {}) {
  const logger = makeLogger();
  const backend = makeBackend();
  const storage = createStorageService({ backend, logger, ...(now ? { now } : {}) });
  const { calls, fetchImpl } = makeFetch(fetchOpts);
  const oauthClient = createMondayOauthClient({
    clientId: env.mondayClientId,
    clientSecret: env.clientSecret,
    fetchImpl,
  });
  const app = express();
  app.use('/oauth', createOauthRouter({ env, storage, logger, fetchImpl, oauthClient }));
  return { app, logger, backend, storage, calls, fetchImpl };
}

/** Run /oauth/start and return the redirect's parsed search params. */
async function start(app) {
  const res = await request(app).get('/oauth/start');
  expect(res.status).toBe(302);
  return new URL(res.headers.location);
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

describe('GET /oauth/start — OAuth 2.1 authorize redirect', () => {
  it('302-redirects with client_id, redirect_uri, scope, response_type=code, state and an S256 PKCE challenge', async () => {
    const { app } = makeHarness();

    const location = await start(app);

    expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZE_URL);
    expect(location.searchParams.get('client_id')).toBe('cid-owner-1');
    expect(location.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(location.searchParams.get('scope')).toBe('boards:read boards:write me:read');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('app_version_id')).toBeNull(); // env has none
  });

  it('stores a single-use state record whose PKCE verifier derives EXACTLY the redirected code_challenge', async () => {
    const { app, backend } = makeHarness();

    const location = await start(app);
    const state = location.searchParams.get('state');

    const entry = backend.map.get(`${OAUTH_STATE_PREFIX}${state}`);
    expect(entry).toBeTruthy();
    expect(typeof entry.verifier).toBe('string');
    expect(entry.verifier.length).toBeGreaterThanOrEqual(43);

    const derived = crypto.createHash('sha256').update(entry.verifier).digest('base64url');
    expect(location.searchParams.get('code_challenge')).toBe(derived);
  });

  it('issues DISTINCT state nonces and verifiers across two starts', async () => {
    const { app, backend } = makeHarness();

    const first = await start(app);
    const second = await start(app);

    const s1 = first.searchParams.get('state');
    const s2 = second.searchParams.get('state');
    expect(s1).not.toBe(s2);
    const v1 = backend.map.get(`${OAUTH_STATE_PREFIX}${s1}`).verifier;
    const v2 = backend.map.get(`${OAUTH_STATE_PREFIX}${s2}`).verifier;
    expect(v1).not.toBe(v2);
  });

  it('includes app_version_id when env.oauthAppVersionId is set (draft testing)', async () => {
    const { app } = makeHarness({ env: { ...ENV, oauthAppVersionId: '16200000' } });

    const location = await start(app);

    expect(location.searchParams.get('app_version_id')).toBe('16200000');
  });
});

describe('GET /oauth/callback — state gate (CSRF + PKCE binding)', () => {
  it('rejects a callback missing the code with 400 and calls no fetch at all', async () => {
    const { app, calls } = makeHarness();
    const res = await request(app).get('/oauth/callback').query({ state: 'st-1' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects a callback missing the state with 400 and calls no fetch at all', async () => {
    const { app, calls } = makeHarness();
    const res = await request(app).get('/oauth/callback').query({ code: CODE });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects an UNKNOWN state with 400 without exchanging', async () => {
    const { app, calls } = makeHarness();
    const res = await request(app).get('/oauth/callback').query({ code: CODE, state: 'forged' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects a REPLAYED state: the first callback succeeds, the second 400s with no second exchange', async () => {
    const { app, calls } = makeHarness();
    const location = await start(app);
    const state = location.searchParams.get('state');

    const first = await request(app).get('/oauth/callback').query({ code: CODE, state });
    expect(first.status).toBe(200);
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);

    const replay = await request(app).get('/oauth/callback').query({ code: CODE, state });
    expect(replay.status).toBe(400);
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('rejects an EXPIRED state (>10 min on the consent screen) with 400', async () => {
    let nowMs = 1_784_700_000_000;
    const { app, calls } = makeHarness({ now: () => nowMs });
    const location = await start(app);
    const state = location.searchParams.get('state');

    nowMs += 10 * 60_000 + 1; // past the 10-minute TTL

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('renders a failure response on a consent error (?error=access_denied) without calling fetch', async () => {
    const { app, calls } = makeHarness();
    const res = await request(app).get('/oauth/callback').query({ error: 'access_denied' });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /oauth/callback — token exchange + record persistence', () => {
  it('exchanges at the oauth_ms endpoint with grant_type, code_verifier and the exact params, then persists the v2 record', async () => {
    const { app, backend, storage, calls } = makeHarness();
    const location = await start(app);
    const state = location.searchParams.get('state');
    const verifier = backend.map.get(`${OAUTH_STATE_PREFIX}${state}`).verifier;

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Authorized');

    const exchange = tokenCall(calls);
    expect(exchange).toBeTruthy();
    expect(String(exchange.init.method).toUpperCase()).toBe('POST');
    const params = new URLSearchParams(exchange.init.body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe(CODE);
    expect(params.get('code_verifier')).toBe(verifier);
    expect(params.get('client_id')).toBe('cid-owner-1');
    expect(params.get('client_secret')).toBe('cs-owner-1');
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);

    const record = backend.map.get(OWNER_TOKEN_KEY);
    expect(record).toMatchObject({
      v: 2,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: ACCESS_EXP_S * 1000, // decoded from the JWT exp claim
      status: 'active',
    });
    expect(typeof record.obtainedAt).toBe('number');
    await expect(storage.getOwnerTokenRecord()).resolves.toMatchObject({ accessToken: ACCESS_TOKEN });
    // No allowlist configured → the `me` identity check is never called.
    expect(meCall(calls)).toBeUndefined();
  });

  it('responds 502 and stores NO record when the token exchange returns non-OK', async () => {
    const { app, backend } = makeHarness({
      fetchOpts: { tokenResponse: { ok: false, status: 400, text: async () => 'bad request' } },
    });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(502);
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
  });

  it('responds 502 and stores NO record when the exchange body carries no access_token', async () => {
    const { app, backend } = makeHarness({
      fetchOpts: { tokenResponse: { ok: true, json: async () => ({}) } },
    });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(502);
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
  });

  it('responds 502 and stores NO record when the token endpoint rejects (network failure)', async () => {
    const { app, backend } = makeHarness({
      fetchOpts: {
        tokenResponse: () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(502);
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
  });
});

describe('GET /oauth/callback — account allowlist', () => {
  const ALLOWLISTED_ENV = { ...ENV, allowedAccountIds: ['555'] };
  const OTHER_ENV = { ...ENV, allowedAccountIds: ['999', '111'] };

  it('IS in the allowlist → fetches me with the new access token, stores the record, 200', async () => {
    const { app, backend, calls } = makeHarness({ env: ALLOWLISTED_ENV });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(200);
    const identity = meCall(calls);
    expect(identity).toBeTruthy();
    expect(new Headers(identity.init.headers).get('authorization')).toBe(ACCESS_TOKEN);
    expect(backend.map.get(OWNER_TOKEN_KEY)).toMatchObject({ accessToken: ACCESS_TOKEN });
  });

  it('is NOT in the allowlist → 403 and does NOT store the record', async () => {
    const { app, backend } = makeHarness({ env: OTHER_ENV });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(403);
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
  });

  it('fails closed (403, no store) when the identity check itself fails (me endpoint down)', async () => {
    const { app, backend } = makeHarness({
      env: ALLOWLISTED_ENV,
      fetchOpts: {
        meImpl: () => {
          throw new Error('me endpoint unreachable');
        },
      },
    });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(403);
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
  });

  it('fails closed (403, no store) when `me` returns a GraphQL soft error', async () => {
    const { app, backend } = makeHarness({
      env: ALLOWLISTED_ENV,
      fetchOpts: {
        meResponse: { ok: true, json: async () => ({ errors: [{ message: 'Not authenticated' }] }) },
      },
    });
    const location = await start(app);
    const state = location.searchParams.get('state');

    const res = await request(app).get('/oauth/callback').query({ code: CODE, state });

    expect(res.status).toBe(403);
    expect(backend.map.has(OWNER_TOKEN_KEY)).toBe(false);
  });
});

describe('privacy — never log the code, state, verifier or either token', () => {
  it('no logger call ever contains secret material, on success or failure', async () => {
    const { app, logger, backend } = makeHarness();
    const okLocation = await start(app);
    const okState = okLocation.searchParams.get('state');
    const okVerifier = backend.map.get(`${OAUTH_STATE_PREFIX}${okState}`).verifier;
    await request(app).get('/oauth/callback').query({ code: CODE, state: okState });

    const failing = makeHarness({
      fetchOpts: { tokenResponse: { ok: false, status: 401, text: async () => 'bad' } },
    });
    const failLocation = await start(failing.app);
    const failState = failLocation.searchParams.get('state');
    await request(failing.app).get('/oauth/callback').query({ code: CODE, state: failState });

    for (const [l, state, verifier] of [
      [logger, okState, okVerifier],
      [failing.logger, failState, null],
    ]) {
      const logged = allLoggerArgs(l);
      expect(logged).not.toContain(CODE);
      expect(logged).not.toContain(ACCESS_TOKEN);
      expect(logged).not.toContain(REFRESH_TOKEN);
      expect(logged).not.toContain(state);
      if (verifier) expect(logged).not.toContain(verifier);
    }
  });
});
