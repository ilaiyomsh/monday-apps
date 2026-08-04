// T9b — the google{} block on GET /api/state. It is what the admin screen uses
// to tell three differently-fixed problems apart: the SERVER holds no OAuth
// client, nobody connected yet, or the grant died.
//
// The allowlist cross-check is the non-obvious one: a connected mailbox whose
// address is not on AMP_ALLOWED_SENDERS sends mail that looks perfect and whose
// every button fails with 403 at /amp/confirm. Surfacing it here is the
// difference between a one-line env fix and debugging from a recipient's inbox.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage, KEYS } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';
const SENDER = 'deadline@twyst.co.il';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [],
  googleOauthClientId: 'gcid',
  googleOauthClientSecret: 'gsecret',
};

function authHeader() {
  return jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');
}

function harness({ seed = {}, env = ENV } = {}) {
  const backend = createMemoryBackend(seed);
  const app = createApp({
    storage: createAppStorage({ backend }),
    api: { fetchMe: vi.fn() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env,
    fetchImpl: vi.fn(),
  });
  return app;
}

const senderKey = (accountId = ACCOUNT_ID) => `${accountId}:${KEYS.GOOGLE_SENDER}`;

function connectedRecord(overrides = {}) {
  return {
    refreshToken: 'rt1',
    accessToken: 'at1',
    accessTokenExpiresAt: 9_999_999,
    senderAddress: SENDER,
    connectedAt: 1,
    // The granted scope, as persisted by the callback since the 2026-08-04
    // scope change (findings §5) — SMTP XOAUTH2 needs the full-mailbox scope.
    scope: 'https://mail.google.com/ openid email',
    ...overrides,
  };
}

async function google(app) {
  const res = await request(app).get('/api/state').set('Authorization', authHeader());
  expect(res.status).toBe(200);
  return res.body.google;
}

describe('GET /api/state — google block', () => {
  it('reports configured:false when the platform holds no OAuth client', async () => {
    const app = harness({ env: { ...ENV, googleOauthClientId: '', googleOauthClientSecret: '' } });
    expect(await google(app)).toMatchObject({ configured: false, status: 'disconnected' });
  });

  it('reports configured:true with no sender connected yet', async () => {
    expect(await google(harness())).toStrictEqual({
      configured: true,
      status: 'disconnected',
      senderAddress: null,
      senderAllowedForAmp: null,
      lastError: null,
    });
  });

  it('reports the connected sender address', async () => {
    const app = harness({ seed: { [senderKey()]: connectedRecord() } });
    expect(await google(app)).toMatchObject({ status: 'connected', senderAddress: SENDER });
  });

  it('reports broken once the grant died', async () => {
    const app = harness({ seed: { [senderKey()]: connectedRecord({ disconnectedAt: 5 }) } });
    expect(await google(app)).toMatchObject({ status: 'broken' });
  });

  // Re-consent signaling (owner decision 2026-08-04, findings §5): the SMTP
  // XOAUTH2 send path needs https://mail.google.com/. A grant without it —
  // every pre-change grant has no scope field at all — must surface as
  // 'broken' so the admin's existing reconnect button drives re-consent.
  it('reports broken for a pre-change grant with no scope field', async () => {
    const record = connectedRecord();
    delete record.scope;
    const app = harness({ seed: { [senderKey()]: record } });
    expect(await google(app)).toMatchObject({ status: 'broken', senderAddress: SENDER });
  });

  it('reports broken for a grant whose scope lacks mail.google.com (old gmail.send consent)', async () => {
    const app = harness({
      seed: {
        [senderKey()]: connectedRecord({
          scope: 'https://www.googleapis.com/auth/gmail.send openid email',
        }),
      },
    });
    expect(await google(app)).toMatchObject({ status: 'broken' });
  });

  it('reports connected for a grant carrying the full-mailbox scope', async () => {
    const app = harness({ seed: { [senderKey()]: connectedRecord() } });
    expect(await google(app)).toMatchObject({ status: 'connected' });
  });

  it('surfaces lastError as a string when the record carries one', async () => {
    const app = harness({
      seed: {
        [senderKey()]: connectedRecord({ disconnectedAt: 5, lastError: 'google_invalid_grant' }),
      },
    });
    expect(await google(app)).toMatchObject({ status: 'broken', lastError: 'google_invalid_grant' });
  });

  it('reports lastError:null when the record carries none', async () => {
    const app = harness({ seed: { [senderKey()]: connectedRecord() } });
    expect(await google(app)).toMatchObject({ lastError: null });
  });

  it('never surfaces the refresh or access token', async () => {
    const app = harness({ seed: { [senderKey()]: connectedRecord() } });
    const body = JSON.stringify(await google(app));
    expect(body).not.toContain('rt1');
    expect(body).not.toContain('at1');
  });

  it('flags a connected sender that is NOT on the AMP allowlist', async () => {
    const app = harness({ seed: { [senderKey()]: connectedRecord() } });
    expect(await google(app)).toMatchObject({ senderAllowedForAmp: false });
  });

  it('clears the flag once the sender is on the AMP allowlist', async () => {
    const app = harness({
      seed: { [senderKey()]: connectedRecord() },
      env: { ...ENV, ampAllowedSenders: [SENDER] },
    });
    expect(await google(app)).toMatchObject({ senderAllowedForAmp: true });
  });

  it("does not report another tenant's sender", async () => {
    const app = harness({ seed: { [senderKey('888')]: connectedRecord() } });
    expect(await google(app)).toMatchObject({ status: 'disconnected', senderAddress: null });
  });
});
