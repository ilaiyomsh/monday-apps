// The SMTP XOAUTH2 send funnel — the channel that replaced the Gmail API
// (docs/amp-email-verified-findings.md §2: users.messages.send strips the
// text/x-amp-html part on external delivery; the byte-identical message over
// raw SMTP smtp.gmail.com:465 keeps all three parts). Same `emailSender` seam,
// same {code, message} error contract as gmail-sender before it.

import { describe, it, expect } from 'vitest';
import { createSmtpSender } from '../src/services/smtp-sender.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLIENT = { clientId: 'cid', clientSecret: 'csecret' };
const BROAD_SCOPE = 'https://mail.google.com/ openid email';

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
    scope: BROAD_SCOPE,
    ...overrides,
  };
}

const MIME = {
  contentType: 'multipart/alternative; boundary="bnd1"',
  body: '--bnd1\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nמשימות\r\n--bnd1--\r\n',
};

const neverFetch = async (url) => {
  throw new Error(`unexpected fetch to ${url}`);
};

function refreshEndpoint() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url !== TOKEN_URL) throw new Error(`unexpected fetch to ${url}`);
    return { ok: true, status: 200, json: async () => ({ access_token: 'at2', expires_in: 3600 }), text: async () => '{}' };
  };
  return { calls, impl };
}

/**
 * Fake nodemailer transport factory. `script(n)` decides the outcome of the
 * n-th sendMail (1-based): return an info object or throw an SMTP-shaped error.
 */
function fakeTransports(script = () => ({ messageId: 'msg-77' })) {
  const created = [];
  const sends = [];
  const factory = (options) => {
    const transport = {
      options,
      closed: false,
      async sendMail(message) {
        sends.push({ options, message });
        return script(sends.length);
      },
      close() {
        transport.closed = true;
      },
    };
    created.push(transport);
    return transport;
  };
  return { created, sends, factory };
}

const smtpError = (code, responseCode, response) =>
  Object.assign(new Error(response ?? code), { code, responseCode, response });

function sender({ storage, transports, fetchImpl = neverFetch, now = () => 9_000_000 }) {
  return createSmtpSender({ storage, ...CLIENT, fetchImpl, now, transportFactory: transports.factory });
}

const SEND = { accountId: '111', to: 'bob@corp.co.il', subject: 'משימות להיום', mime: MIME };

describe('createSmtpSender — connection state and scope pre-flight', () => {
  it('refuses a tenant that never connected Google', async () => {
    const transports = fakeTransports();
    await expect(sender({ storage: fakeStorage(), transports }).send(SEND)).rejects.toMatchObject({
      code: 'google_not_connected',
    });
    expect(transports.sends).toHaveLength(0);
  });

  // The scope pre-flight is ADVISORY, not a gate (2026-08-04 incident): it
  // compares Google's echoed `scope` string, which we cannot observe from the
  // outside, and a mismatch there blocked a send that smtp.gmail.com had never
  // been asked to judge. SMTP AUTH is the authority.
  it('a record with NO scope field still attempts the send — the server decides', async () => {
    const storage = fakeStorage({ 111: connected({ scope: undefined }) });
    const transports = fakeTransports();
    await expect(sender({ storage, transports }).send(SEND)).resolves.toBeTruthy();
    expect(transports.sends).toHaveLength(1);
  });

  it('a gmail.send-only grant still attempts the send rather than pre-judging it', async () => {
    const storage = fakeStorage({
      111: connected({ scope: 'https://www.googleapis.com/auth/gmail.send openid email' }),
    });
    const transports = fakeTransports();
    await expect(sender({ storage, transports }).send(SEND)).resolves.toBeTruthy();
    expect(transports.sends).toHaveLength(1);
  });

  it('when SMTP then refuses the token, the error names the granted scope — the missing diagnostic', async () => {
    const storage = fakeStorage({
      111: connected({ scope: 'https://www.googleapis.com/auth/gmail.send openid email' }),
    });
    const { impl } = refreshEndpoint();
    const transports = fakeTransports(() => {
      throw smtpError('EAUTH', 535, '535-5.7.9 Application-specific password required');
    });
    await expect(sender({ storage, transports, fetchImpl: impl }).send(SEND)).rejects.toMatchObject({
      code: 'smtp_auth_failed',
      message: expect.stringContaining('https://www.googleapis.com/auth/gmail.send'),
    });
  });
});

describe('createSmtpSender — header-injection refusal', () => {
  it('rejects a CRLF in the recipient before touching the transport', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    await expect(
      sender({ storage, transports }).send({ ...SEND, to: 'a@b.co\r\nBcc: evil@x.co' })
    ).rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(transports.sends).toHaveLength(0);
  });

  it('rejects a CRLF in the subject before touching the transport', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    await expect(
      sender({ storage, transports }).send({ ...SEND, subject: 'x\r\nBcc: evil@x.co' })
    ).rejects.toMatchObject({ code: 'invalid_subject' });
    expect(transports.sends).toHaveLength(0);
  });
});

describe('createSmtpSender — token memo and reuse', () => {
  it('reuses a still-valid stored token across sends — no token endpoint call at all', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    const s = sender({ storage, transports });
    await s.send(SEND);
    await s.send({ ...SEND, to: 'c@d.co' });
    expect(transports.sends).toHaveLength(2);
    for (const { options } of transports.sends) {
      expect(options.auth.accessToken).toBe('at1');
    }
  });

  it('refreshes an expired token ONCE for a whole run — the memo carries the second send', async () => {
    const storage = fakeStorage({ 111: connected({ accessTokenExpiresAt: 0 }) });
    const { calls, impl } = refreshEndpoint();
    const transports = fakeTransports();
    const s = sender({ storage, transports, fetchImpl: impl, now: () => 1_000 });
    await s.send(SEND);
    await s.send({ ...SEND, to: 'c@d.co' });
    expect(calls).toHaveLength(1);
    expect(transports.sends).toHaveLength(2);
    expect(transports.sends[1].options.auth.accessToken).toBe('at2');
  });
});

describe('createSmtpSender — EAUTH retry (mirror of the Gmail 401-retry)', () => {
  it('an EAUTH triggers exactly one forced refresh and one retry, then succeeds', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = refreshEndpoint();
    const transports = fakeTransports((n) => {
      if (n === 1) throw smtpError('EAUTH', 535, '535-5.7.8 Username and Password not accepted');
      return { messageId: 'msg-77' };
    });
    await expect(sender({ storage, transports, fetchImpl: impl }).send(SEND)).resolves.toEqual({ id: 'msg-77' });
    expect(calls).toHaveLength(1);
    expect(transports.sends).toHaveLength(2);
    expect(transports.sends[1].options.auth.accessToken).toBe('at2');
  });

  it('a 535 AFTER the retry marks the sender disconnected and throws smtp_auth_failed', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { calls, impl } = refreshEndpoint();
    const transports = fakeTransports(() => {
      throw smtpError('EAUTH', 535, '535-5.7.8 Username and Password not accepted');
    });
    await expect(sender({ storage, transports, fetchImpl: impl }).send(SEND)).rejects.toMatchObject({
      code: 'smtp_auth_failed',
      status: 535,
    });
    // Exactly ONE forced refresh — never a loop.
    expect(calls).toHaveLength(1);
    expect(transports.sends).toHaveLength(2);
    expect(storage.records.get('111').disconnectedAt).toBeDefined();
    expect(storage.records.get('111').lastError).toBe('smtp_auth_failed');
  });

  it('a 4xx auth failure after the retry is TRANSIENT — the kill switch stays untripped', async () => {
    const storage = fakeStorage({ 111: connected() });
    const { impl } = refreshEndpoint();
    const transports = fakeTransports(() => {
      throw smtpError('EAUTH', 454, '454 4.7.0 Temporary authentication failure');
    });
    await expect(sender({ storage, transports, fetchImpl: impl }).send(SEND)).rejects.toMatchObject({
      code: 'smtp_auth_transient',
    });
    expect(storage.records.get('111').disconnectedAt).toBeUndefined();
  });
});

describe('createSmtpSender — non-auth error classification', () => {
  it.each(['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'])('%s maps to smtp_connect_failed', async (code) => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports(() => {
      throw smtpError(code, undefined, undefined);
    });
    await expect(sender({ storage, transports }).send(SEND)).rejects.toMatchObject({
      code: 'smtp_connect_failed',
    });
    expect(transports.sends).toHaveLength(1);
  });

  it('a 4xx server response maps to smtp_transient', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports(() => {
      throw smtpError('EENVELOPE', 450, '450 4.2.1 mailbox busy');
    });
    await expect(sender({ storage, transports }).send(SEND)).rejects.toMatchObject({
      code: 'smtp_transient',
      status: 450,
    });
  });

  it('a 5xx rejection maps to smtp_rejected and carries the server response text', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports(() => {
      throw smtpError('EMESSAGE', 550, '550 5.7.1 message blocked by policy');
    });
    const err = await sender({ storage, transports }).send(SEND).then(
      () => {
        throw new Error('expected rejection');
      },
      (e) => e
    );
    expect(err.code).toBe('smtp_rejected');
    expect(err.status).toBe(550);
    expect(err.message).toContain('550 5.7.1 message blocked by policy');
  });
});

describe('createSmtpSender — message and transport assembly', () => {
  it('hands nodemailer the RFC822 message with the MIME body byte-for-byte, plus a Date header', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    await sender({ storage, transports }).send(SEND);
    const { raw } = transports.sends[0].message;
    expect(raw).toContain('From: digest@twyst.co.il');
    expect(raw).toContain('To: bob@corp.co.il');
    expect(raw).toContain('MIME-Version: 1.0');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="bnd1"');
    expect(raw).toContain(MIME.body);
    expect(raw).toMatch(/\r\nDate: [A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000\r\n/);
  });

  it('sets the SMTP envelope explicitly — sender address out, one recipient in', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    await sender({ storage, transports }).send(SEND);
    expect(transports.sends[0].message.envelope).toEqual({
      from: 'digest@twyst.co.il',
      to: ['bob@corp.co.il'],
    });
  });

  it('authenticates as OAuth2 with the access token only — we own refresh, nodemailer must not', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    await sender({ storage, transports }).send(SEND);
    const { options } = transports.sends[0];
    expect(options.host).toBe('smtp.gmail.com');
    expect(options.port).toBe(465);
    expect(options.secure).toBe(true);
    expect(options.auth).toEqual({ type: 'OAuth2', user: 'digest@twyst.co.il', accessToken: 'at1' });
  });

  it('creates one non-pooled transport per send and closes it', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    const s = sender({ storage, transports });
    await s.send(SEND);
    await s.send({ ...SEND, to: 'c@d.co' });
    expect(transports.created).toHaveLength(2);
    expect(transports.created.every((t) => t.closed)).toBe(true);
  });

  it('returns the transport message id', async () => {
    const storage = fakeStorage({ 111: connected() });
    const transports = fakeTransports();
    await expect(sender({ storage, transports }).send(SEND)).resolves.toEqual({ id: 'msg-77' });
  });
});
