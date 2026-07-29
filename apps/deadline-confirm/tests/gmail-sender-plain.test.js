// T9 — the plain-text-only send path. The D8 operator summary takes it: it has
// no AMP part, so wrapping it in multipart/alternative would produce a
// single-part multipart, which some clients render as an attachment rather than
// a body. The digest path must be unaffected.

import { describe, it, expect } from 'vitest';
import { createGmailSender } from '../src/services/gmail-sender.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function fakeStorage(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    forAccount: (accountId) => ({
      getGoogleSender: async () => records.get(accountId) ?? null,
      setGoogleSender: async (r) => records.set(accountId, r),
    }),
  };
}

const CONNECTED = {
  refreshToken: 'rt1',
  accessToken: 'at1',
  accessTokenExpiresAt: 10_000_000,
  senderAddress: 'deadline@twyst.co.il',
  connectedAt: 1,
};

function recorder() {
  const calls = [];
  return {
    calls,
    impl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: 'm1' }), text: async () => '{}' };
    },
  };
}

const raw = (call) => Buffer.from(JSON.parse(call.init.body).raw, 'base64url').toString('utf8');

function sender(rec) {
  return createGmailSender({
    storage: fakeStorage({ 111: CONNECTED }),
    clientId: 'c',
    clientSecret: 's',
    fetchImpl: rec.impl,
    now: () => 1,
  });
}

describe('createGmailSender — plain-only messages', () => {
  it('sends text/plain when no mime part is supplied', async () => {
    const rec = recorder();
    await sender(rec).send({ accountId: '111', to: 'ops@twyst.co.il', subject: 'summary', plain: 'שורה' });
    const message = raw(rec.calls[0]);
    expect(message).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(message).not.toContain('multipart/alternative');
    expect(message).toContain('שורה');
  });

  it('still refuses a header break in a plain-only send', async () => {
    const rec = recorder();
    await expect(
      sender(rec).send({ accountId: '111', to: 'a@b.co\r\nBcc: x@y.co', subject: 's', plain: 'x' })
    ).rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(rec.calls).toHaveLength(0);
  });

  it('a mime part still wins — the digest path is unchanged', async () => {
    const rec = recorder();
    const mime = { contentType: 'multipart/alternative; boundary="b1"', body: '--b1\r\n\r\nx\r\n--b1--\r\n' };
    await sender(rec).send({ accountId: '111', to: 'a@b.co', subject: 's', plain: 'ignored', mime });
    const message = raw(rec.calls[0]);
    expect(message).toContain('Content-Type: multipart/alternative; boundary="b1"');
    expect(message).toContain(mime.body);
    expect(message).not.toContain('ignored');
  });

  it('an absent plain body yields an empty body, not the literal "undefined"', async () => {
    const rec = recorder();
    await sender(rec).send({ accountId: '111', to: 'a@b.co', subject: 's' });
    expect(raw(rec.calls[0])).not.toContain('undefined');
  });
});
