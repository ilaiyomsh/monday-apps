// The plain-text-only path over the SMTP channel — mirror of
// gmail-sender-plain.test.js. The D8 operator summary has no AMP part, so
// wrapping it in multipart/alternative would produce a single-part multipart,
// which some clients render as an attachment rather than a body. The digest
// path must be unaffected.

import { describe, it, expect } from 'vitest';
import { createSmtpSender } from '../src/services/smtp-sender.js';

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
  scope: 'https://mail.google.com/ openid email',
};

function recorder() {
  const sends = [];
  const factory = (options) => ({
    sendMail: async (message) => {
      sends.push({ options, message });
      return { messageId: 'm1' };
    },
    close() {},
  });
  return { sends, factory };
}

function sender(rec) {
  return createSmtpSender({
    storage: fakeStorage({ 111: CONNECTED }),
    clientId: 'c',
    clientSecret: 's',
    fetchImpl: async (url) => {
      throw new Error(`unexpected fetch to ${url}`);
    },
    now: () => 1,
    transportFactory: rec.factory,
  });
}

describe('createSmtpSender — plain-only messages', () => {
  it('sends text/plain when no mime part is supplied', async () => {
    const rec = recorder();
    await sender(rec).send({ accountId: '111', to: 'ops@twyst.co.il', subject: 'summary', plain: 'שורה' });
    const { raw } = rec.sends[0].message;
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(raw).not.toContain('multipart/alternative');
    expect(raw).toContain('שורה');
  });

  it('still refuses a header break in a plain-only send', async () => {
    const rec = recorder();
    await expect(
      sender(rec).send({ accountId: '111', to: 'a@b.co\r\nBcc: x@y.co', subject: 's', plain: 'x' })
    ).rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(rec.sends).toHaveLength(0);
  });

  it('a mime part still wins — the digest path is unchanged', async () => {
    const rec = recorder();
    const mime = { contentType: 'multipart/alternative; boundary="b1"', body: '--b1\r\n\r\nx\r\n--b1--\r\n' };
    await sender(rec).send({ accountId: '111', to: 'a@b.co', subject: 's', plain: 'ignored', mime });
    const { raw } = rec.sends[0].message;
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="b1"');
    expect(raw).toContain(mime.body);
    expect(raw).not.toContain('ignored');
  });

  it('an absent plain body yields an empty body, not the literal "undefined"', async () => {
    const rec = recorder();
    await sender(rec).send({ accountId: '111', to: 'a@b.co', subject: 's' });
    expect(rec.sends[0].message.raw).not.toContain('undefined');
  });
});
