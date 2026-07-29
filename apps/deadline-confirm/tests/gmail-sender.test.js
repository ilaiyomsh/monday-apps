// T9 — the Gmail send funnel. Implements the `emailSender` seam that
// digest-run/scheduler/admin-api already call. Per-tenant: the Google record
// lives under `${accountId}:google_sender` (owner decision 2026-07-29 — each
// organization sends from its OWN internal mailbox, so the sending identity
// can never be shared across tenants).

import { describe, it, expect } from 'vitest';
import { createGmailSender } from '../src/services/gmail-sender.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const CLIENT = { clientId: 'cid', clientSecret: 'csecret' };

/** Minimal storage double exposing only what the sender touches. */
function fakeStorage(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    records,
    forAccount(accountId) {
      return {
        getGoogleSender: async () => records.get(accountId) ?? null,
        setGoogleSender: async (record) => {
          records.set(accountId, record);
        },
      };
    },
  };
}

function connected(overrides = {}) {
  return {
    refreshToken: 'rt1',
    accessToken: 'at1',
    accessTokenExpiresAt: 10_000_000,
    senderAddress: 'digest@twyst.co.il',
    connectedAt: 1,
    ...overrides,
  };
}

const MIME = {
  contentType: 'multipart/alternative; boundary="bnd1"',
  body: '--bnd1\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nמשימות\r\n--bnd1--\r\n',
};

/** Decode the RFC822 message the sender handed to Gmail. */
function rawOf(call) {
  return Buffer.from(JSON.parse(call.init.body).raw, 'base64url').toString('utf8');
}

function recorder(handlers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch to ${url}`);
    return handler(calls.filter((c) => c.url === url).length);
  };
  return { calls, impl };
}

const okSend = () => ({ ok: true, status: 200, json: async () => ({ id: 'msg-1' }), text: async () => '{}' });

describe('createGmailSender — connection state', () => {
  it('refuses to send for a tenant that never connected Google', async () => {
    const sender = createGmailSender({ storage: fakeStorage(), ...CLIENT, fetchImpl: async () => okSend() });
    await expect(
      sender.send({ accountId: '111', to: 'a@b.co', subject: 'נושא', mime: MIME })
    ).rejects.toMatchObject({ code: 'google_not_connected' });
  });

  it('refuses to send for a tenant whose connection was marked dead', async () => {
    const storage = fakeStorage({ 111: connected({ disconnectedAt: 5, lastError: 'google_invalid_grant' }) });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: async () => okSend() });
    await expect(
      sender.send({ accountId: '111', to: 'a@b.co', subject: 'נושא', mime: MIME })
    ).rejects.toMatchObject({ code: 'google_disconnected' });
  });

  it('never lets one tenant send through another tenant record', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl });
    await expect(
      sender.send({ accountId: '222', to: 'a@b.co', subject: 'x', mime: MIME })
    ).rejects.toMatchObject({ code: 'google_not_connected' });
  });
});

describe('createGmailSender — access token lifecycle', () => {
  it('uses a still-valid stored access token without calling the token endpoint', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 9_000_000 });
    await sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME });
    expect(calls.map((c) => c.url)).toEqual([SEND_URL]);
    expect(calls[0].init.headers.Authorization).toBe('Bearer at1');
  });

  it('refreshes inside the 60s cushion and persists the new token', async () => {
    const storage = fakeStorage({ 111: connected({ accessTokenExpiresAt: 100_000 }) });
    const { calls, impl } = recorder({
      'https://oauth2.googleapis.com/token': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'at2', expires_in: 3600 }),
        text: async () => '{}',
      }),
      [SEND_URL]: okSend,
    });
    // 50s before expiry — inside the cushion, so a refresh is due.
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 50_000 });
    await sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME });
    expect(calls.map((c) => c.url)).toEqual(['https://oauth2.googleapis.com/token', SEND_URL]);
    expect(calls[1].init.headers.Authorization).toBe('Bearer at2');
    expect(storage.records.get('111').accessToken).toBe('at2');
    expect(storage.records.get('111').refreshToken).toBe('rt1');
  });

  it('marks the connection dead on invalid_grant so the operator sees it', async () => {
    const storage = fakeStorage({ 111: connected({ accessTokenExpiresAt: 0 }) });
    const { impl } = recorder({
      'https://oauth2.googleapis.com/token': async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
        text: async () => '{"error":"invalid_grant"}',
      }),
    });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1_000 });
    await expect(
      sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME })
    ).rejects.toMatchObject({ code: 'google_disconnected' });
    expect(storage.records.get('111').disconnectedAt).toBe(1_000);
  });

  it('does NOT mark the connection dead on a transient refresh failure', async () => {
    const storage = fakeStorage({ 111: connected({ accessTokenExpiresAt: 0 }) });
    const { impl } = recorder({
      'https://oauth2.googleapis.com/token': async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'backend_error' }),
        text: async () => '{}',
      }),
    });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1_000 });
    await expect(sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME })).rejects.toMatchObject({
      code: 'google_refresh_failed',
    });
    expect(storage.records.get('111').disconnectedAt).toBeUndefined();
  });

  it('reuses the in-process token across recipients — one refresh, not one per message', async () => {
    const storage = fakeStorage({ 111: connected({ accessTokenExpiresAt: 0 }) });
    const { calls, impl } = recorder({
      'https://oauth2.googleapis.com/token': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'at2', expires_in: 3600 }),
        text: async () => '{}',
      }),
      [SEND_URL]: okSend,
    });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1_000 });
    await sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME });
    await sender.send({ accountId: '111', to: 'c@d.co', subject: 'x', mime: MIME });
    expect(calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token')).toHaveLength(1);
    expect(calls.filter((c) => c.url === SEND_URL)).toHaveLength(2);
  });
});

describe('createGmailSender — RFC822 assembly', () => {
  it('carries the AMP part through untouched under multipart/alternative', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await sender.send({ accountId: '111', to: 'bob@corp.co.il', subject: 'משימות להיום', mime: MIME });
    const raw = rawOf(calls[0]);
    expect(raw).toContain('From: digest@twyst.co.il');
    expect(raw).toContain('To: bob@corp.co.il');
    expect(raw).toContain('MIME-Version: 1.0');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="bnd1"');
    expect(raw).toContain(MIME.body);
  });

  it('RFC2047-encodes a Hebrew subject instead of emitting raw 8-bit header bytes', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await sender.send({ accountId: '111', to: 'a@b.co', subject: 'משימות להיום', mime: MIME });
    const raw = rawOf(calls[0]);
    const subjectLine = raw.split('\r\n').find((l) => l.startsWith('Subject:'));
    expect(subjectLine).toBe(`Subject: =?UTF-8?B?${Buffer.from('משימות להיום', 'utf8').toString('base64')}?=`);
    expect(subjectLine).not.toContain('משימות');
  });

  it('leaves a pure-ASCII subject unencoded', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await sender.send({ accountId: '111', to: 'a@b.co', subject: 'Daily digest', mime: MIME });
    expect(rawOf(calls[0])).toContain('Subject: Daily digest\r\n');
  });

  it('rejects header injection through the recipient address', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await expect(
      sender.send({ accountId: '111', to: 'a@b.co\r\nBcc: evil@x.co', subject: 'x', mime: MIME })
    ).rejects.toMatchObject({ code: 'invalid_recipient' });
  });

  it('rejects header injection through the subject', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await expect(
      sender.send({ accountId: '111', to: 'a@b.co', subject: 'x\r\nBcc: evil@x.co', mime: MIME })
    ).rejects.toMatchObject({ code: 'invalid_subject' });
  });

  it('returns the Gmail message id', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { impl } = recorder({ [SEND_URL]: okSend });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await expect(sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME })).resolves.toEqual({
      id: 'msg-1',
    });
  });

  it('surfaces a Gmail API rejection as a throw, never a silent success', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { impl } = recorder({
      [SEND_URL]: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Delegation denied' } }),
        text: async () => '{"error":{"message":"Delegation denied"}}',
      }),
    });
    const sender = createGmailSender({ storage, ...CLIENT, fetchImpl: impl, now: () => 1 });
    await expect(sender.send({ accountId: '111', to: 'a@b.co', subject: 'x', mime: MIME })).rejects.toMatchObject({
      code: 'gmail_send_failed',
      status: 403,
    });
  });
});
