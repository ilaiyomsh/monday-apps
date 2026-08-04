// ON-THE-WIRE proof for the channel swap (findings §2): the Gmail API strips
// the text/x-amp-html part on external delivery, so the whole point of the
// SMTP channel is that the DATA payload the server receives still carries all
// three MIME parts under OUR dc_ boundary. A fake SMTP server on node:net
// records exactly what a real nodemailer transport (no fakes here) puts on the
// socket. Plaintext only — the transport is created with secure:false +
// ignoreTLS through the injected smtp options; production keeps 465/TLS.

import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';
import { createSmtpSender } from '../src/services/smtp-sender.js';
import { buildMultipartAlternative } from '../src/helpers/mime-alternative.js';

/**
 * Minimal SMTP server: 220 banner, EHLO advertising AUTH XOAUTH2, then a
 * happy-path 235/250/250/354/250 dialogue. Records every command line and the
 * full DATA payload.
 */
function startFakeSmtp() {
  const transcript = { commands: [], data: '' };
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    socket.write('220 fake.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          transcript.data = buffer.slice(0, end + 2);
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write('250 2.0.0 OK queued as WIRE1\r\n');
          continue;
        }
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        transcript.commands.push(line);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') {
          socket.write('250-fake.test\r\n250-8BITMIME\r\n250 AUTH XOAUTH2\r\n');
        } else if (verb === 'AUTH') {
          socket.write('235 2.7.0 Accepted\r\n');
        } else if (verb === 'MAIL') {
          socket.write('250 2.1.0 OK\r\n');
        } else if (verb === 'RCPT') {
          socket.write('250 2.1.5 OK\r\n');
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 Go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, transcript });
    });
  });
}

function fakeStorage(record) {
  const records = new Map([['111', record]]);
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
  senderAddress: 'digest@twyst.co.il',
  connectedAt: 1,
  scope: 'https://mail.google.com/ openid email',
};

const closers = [];
afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

describe('createSmtpSender — real nodemailer transport against a fake SMTP server', () => {
  it('the DATA payload on the wire carries all three MIME parts under our dc_ boundary', async () => {
    const { server, port, transcript } = await startFakeSmtp();
    closers.push(() => new Promise((resolve) => server.close(resolve)));

    const amp = [
      '<!doctype html>',
      '<html ⚡4email data-css-strict><head><meta charset="utf-8">',
      '<script async src="https://cdn.ampproject.org/v0.js"></script>',
      '<style amp4email-boilerplate>body{visibility:hidden}</style>',
      '</head><body>משימות להיום</body></html>',
    ].join('\n');
    const plain = 'משימות להיום\n- משימה אחת';
    const mime = buildMultipartAlternative({ plain, amp });

    const sender = createSmtpSender({
      storage: fakeStorage({ ...CONNECTED }),
      clientId: 'c',
      clientSecret: 's',
      fetchImpl: async (url) => {
        throw new Error(`unexpected fetch to ${url}`);
      },
      now: () => 9_000_000,
      // Plaintext to the fake server; production default stays smtp.gmail.com:465.
      smtp: { host: '127.0.0.1', port, secure: false, ignoreTLS: true },
    });

    await sender.send({ accountId: '111', to: 'bob@corp.co.il', subject: 'משימות להיום', mime, plain });

    // The auth actually went over the wire as XOAUTH2 with our token.
    const authLine = transcript.commands.find((l) => l.toUpperCase().startsWith('AUTH XOAUTH2'));
    expect(authLine).toBeDefined();
    const decoded = Buffer.from(authLine.split(' ')[2], 'base64').toString('utf8');
    expect(decoded).toContain('user=digest@twyst.co.il');
    expect(decoded).toContain('auth=Bearer at1');

    // Envelope on the wire.
    expect(transcript.commands.some((l) => l.toUpperCase().startsWith('MAIL FROM:<DIGEST@TWYST.CO.IL'.toUpperCase()))).toBe(true);
    expect(transcript.commands.some((l) => l.toUpperCase().startsWith('RCPT TO:<BOB@CORP.CO.IL'.toUpperCase()))).toBe(true);

    // THE point: all three parts and OUR boundary survive to the DATA payload.
    expect(transcript.data).toContain('Content-Type: multipart/alternative; boundary="dc_');
    expect(transcript.data).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(transcript.data).toContain('Content-Type: text/x-amp-html; charset=UTF-8');
    expect(transcript.data).toContain('Content-Type: text/html; charset=UTF-8');
    const boundary = mime.contentType.match(/boundary="(dc_[0-9a-f]+)"/)[1];
    expect(transcript.data).toContain(`--${boundary}--`);
    // The exact multipart body we built went through byte-for-byte (modulo the
    // SMTP dot-stuffing nodemailer applies, which this body never triggers).
    expect(transcript.data).toContain(mime.body.trimEnd());
  });
});
