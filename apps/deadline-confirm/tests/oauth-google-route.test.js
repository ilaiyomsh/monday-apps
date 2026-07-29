// T9b/T9c — /oauth/google/start + /oauth/google/callback through the REAL
// Express pipeline (createApp), real JWTs, a memory backend inspected directly.
//
// The two properties that carry security weight:
//  - ADMIT: sessionToken + tenant roster, same gate as the monday flow. A
//    per-tenant sending identity is what retires D13's operator-only gate — a
//    tenant can only ever rebind its OWN sender.
//  - FLOW SEPARATION: the Google state nonce lives in its own key namespace, so
//    a monday-issued nonce cannot be redeemed at the Google callback.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage, KEYS } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [],
  googleOauthClientId: 'gcid',
  googleOauthClientSecret: 'gsecret',
};

function authHeader({ accountId = 777, userId = 1 } = {}) {
  return jwt.sign({ dat: { account_id: accountId, user_id: userId } }, 'cs-1');
}

/** id_token payload carrying the sender address. */
function idToken(email) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ email })}.sig`;
}

function makeHarness({ seed = {}, env = ENV, tokenResponse } = {}) {
  const backend = createMemoryBackend(seed);
  const storage = createAppStorage({ backend });
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () =>
      tokenResponse ?? {
        access_token: 'at1',
        refresh_token: 'rt1',
        expires_in: 3600,
        id_token: idToken('deadline@twyst.co.il'),
      },
    text: async () => '{}',
  }));
  const app = createApp({
    storage,
    api: { fetchMe: vi.fn() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env,
    fetchImpl,
  });
  return { app, backend, storage, fetchImpl };
}

/** Mint a real Google-flow state nonce the way /start would. */
async function issueGoogleState(storage, nonce, accountId = ACCOUNT_ID) {
  await storage.issueGoogleOauthState(nonce, accountId);
}

describe('GET /oauth/google/start — admit gate', () => {
  it('refuses with 409 when the server holds no OAuth client', async () => {
    const { app } = makeHarness({
      env: { ...ENV, googleOauthClientId: '', googleOauthClientSecret: '' },
    });
    const res = await request(app).get(`/oauth/google/start?st=${authHeader()}`);
    expect(res.status).toBe(409);
  });

  it('refuses with 401 without a sessionToken', async () => {
    const { app } = makeHarness();
    expect((await request(app).get('/oauth/google/start')).status).toBe(401);
  });

  it('refuses with 401 for a sessionToken signed with the wrong secret', async () => {
    const { app } = makeHarness();
    const forged = jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'not-the-secret');
    expect((await request(app).get(`/oauth/google/start?st=${forged}`)).status).toBe(401);
  });

  it('refuses with 403 for an account off the tenant roster', async () => {
    const { app } = makeHarness();
    const res = await request(app).get(`/oauth/google/start?st=${authHeader({ accountId: 888 })}`);
    expect(res.status).toBe(403);
  });

  it('refuses every account when the roster is empty (default deny)', async () => {
    const { app } = makeHarness({ env: { ...ENV, allowedAccountIds: [] } });
    const res = await request(app).get(`/oauth/google/start?st=${authHeader()}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /oauth/google/start — consent redirect', () => {
  it('redirects to Google asking for offline access, and persists the state under the GOOGLE namespace', async () => {
    const { app, backend } = makeHarness();
    const res = await request(app).get(`/oauth/google/start?st=${authHeader()}`);

    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('gcid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/oauth/google/callback');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('gmail.send');

    const nonce = url.searchParams.get('state');
    expect(await backend.get(`${KEYS.GOOGLE_OAUTH_STATE_PREFIX}${nonce}`)).toMatchObject({
      accountId: ACCOUNT_ID,
    });
    // Must NOT land in the monday flow's namespace.
    expect(await backend.get(`${KEYS.OAUTH_STATE_PREFIX}${nonce}`)).toBeNull();
  });

  it('never leaks the client secret into the redirect', async () => {
    const { app } = makeHarness();
    const res = await request(app).get(`/oauth/google/start?st=${authHeader()}`);
    expect(res.headers.location).not.toContain('gsecret');
  });
});

describe('GET /oauth/google/callback', () => {
  it('stores the sender record for the account the STATE was issued to', async () => {
    const { app, storage, backend } = makeHarness();
    await issueGoogleState(storage, 'nonce1');

    const res = await request(app).get('/oauth/google/callback?code=authcode&state=nonce1');

    expect(res.status).toBe(200);
    const record = await backend.get(`${ACCOUNT_ID}:${KEYS.GOOGLE_SENDER}`);
    expect(record).toMatchObject({
      refreshToken: 'rt1',
      accessToken: 'at1',
      senderAddress: 'deadline@twyst.co.il',
    });
  });

  it('a reconnect clears a previous disconnectedAt, or sending would stay refused', async () => {
    const { app, storage, backend } = makeHarness({
      seed: {
        [`${ACCOUNT_ID}:${KEYS.GOOGLE_SENDER}`]: {
          refreshToken: 'old',
          disconnectedAt: 5,
          lastError: 'google_invalid_grant',
        },
      },
    });
    await issueGoogleState(storage, 'nonce2');

    await request(app).get('/oauth/google/callback?code=c&state=nonce2');

    const record = await backend.get(`${ACCOUNT_ID}:${KEYS.GOOGLE_SENDER}`);
    expect(record.disconnectedAt).toBeUndefined();
    expect(record.refreshToken).toBe('rt1');
  });

  it('refuses a monday-issued nonce — flow separation by key namespace', async () => {
    const { app, storage, backend } = makeHarness();
    await storage.issueOauthState('mondaynonce', ACCOUNT_ID);

    const res = await request(app).get('/oauth/google/callback?code=c&state=mondaynonce');

    expect(res.status).toBe(400);
    expect(await backend.get(`${ACCOUNT_ID}:${KEYS.GOOGLE_SENDER}`)).toBeNull();
  });

  it('refuses an unknown state', async () => {
    const { app } = makeHarness();
    expect((await request(app).get('/oauth/google/callback?code=c&state=nope')).status).toBe(400);
  });

  it('burns the state — a replay of the same nonce is refused', async () => {
    const { app, storage } = makeHarness();
    await issueGoogleState(storage, 'nonce3');

    expect((await request(app).get('/oauth/google/callback?code=c&state=nonce3')).status).toBe(200);
    expect((await request(app).get('/oauth/google/callback?code=c&state=nonce3')).status).toBe(400);
  });

  it('refuses a denied consent without touching storage', async () => {
    const { app, backend } = makeHarness();
    const res = await request(app).get('/oauth/google/callback?error=access_denied');
    expect(res.status).toBe(400);
    expect(await backend.get(`${ACCOUNT_ID}:${KEYS.GOOGLE_SENDER}`)).toBeNull();
  });

  it('refuses a callback with no code', async () => {
    const { app, storage } = makeHarness();
    await issueGoogleState(storage, 'nonce4');
    expect((await request(app).get('/oauth/google/callback?state=nonce4')).status).toBe(400);
  });

  it('stores nothing when Google returns no refresh token', async () => {
    const { app, storage, backend } = makeHarness({
      tokenResponse: { access_token: 'at1', expires_in: 3600, id_token: idToken('a@b.co') },
    });
    await issueGoogleState(storage, 'nonce5');

    const res = await request(app).get('/oauth/google/callback?code=c&state=nonce5');

    expect(res.status).toBe(500);
    expect(await backend.get(`${ACCOUNT_ID}:${KEYS.GOOGLE_SENDER}`)).toBeNull();
  });
});
