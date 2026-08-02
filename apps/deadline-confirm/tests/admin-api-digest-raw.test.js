// TDD — POST /api/digest/send-raw: the AMP debug lane. The admin edits the
// rendered amp4email document in the preview box and sends THOSE bytes through
// the same Gmail funnel (same 3-part multipart/alternative) so a Gmail
// rendering failure can be bisected against a hand-edited document.
//
// The contract that matters: what the admin typed is what leaves the process,
// byte for byte. Any re-render, re-wrap or normalization here would defeat the
// entire purpose of the lane, so the decoded amp part is compared literally.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';
const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};

const scoped = (key) => `${ACCOUNT_ID}:${key}`;
const authHeader = () => jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');

const AMP = [
  '<!doctype html>',
  '<html ⚡4email data-css-strict>',
  '<head><meta charset="utf-8"><style amp4email-boilerplate>body{visibility:hidden}</style></head>',
  '<body>שלום — נערך ידנית</body>',
  '</html>',
].join('\n');

const CONFIG = {
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [
    {
      id: 'b_start001',
      name: 'עדכן: התחלתי',
      statusColumnId: 'status_a',
      targetIndex: 0,
      targetLabel: 'בעבודה',
      style: { color: '#0073ea', icon: '✓', size: 'sm' },
    },
  ],
  digest: {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'המשימות שלך — נדרש עדכון',
    sendHour: 8,
    sections: [
      {
        id: 's_start001',
        title: 'להתחיל:',
        dateColumnId: 'date_start',
        dateColumnTitle: 'תאריך התחלה מתוכנן',
        buttonId: 'b_start001',
        buttonIds: ['b_start001'],
        includeStatusLabelIds: [0],
      },
    ],
  },
};

function makeHarness({ emailSender, seed } = {}) {
  const backend = createMemoryBackend(
    seed ?? {
      [scoped('config')]: CONFIG,
      [scoped('link_secret')]: 'SECRET43',
      [scoped('oauth_token')]: 'tok-1',
    }
  );
  const app = createApp({
    storage: createAppStorage({ backend }),
    api: { fetchMe: vi.fn(), getBoardItems: vi.fn() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    emailSender,
  });
  return { app, backend };
}

const post = (app, body) =>
  request(app).post('/api/digest/send-raw').set('Authorization', authHeader()).send(body);

/** Decode the text/x-amp-html part out of a built multipart/alternative body. */
function decodeAmpPart(mime) {
  const boundary = /boundary="([^"]+)"/.exec(mime.contentType)[1];
  const part = mime.body
    .split(`--${boundary}`)
    .find((chunk) => chunk.includes('Content-Type: text/x-amp-html'));
  const payload = part.split('\r\n\r\n')[1].trim();
  return Buffer.from(payload.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

describe('POST /api/digest/send-raw', () => {
  it('401 without a session token (same gate as every other admin route)', async () => {
    const { app } = makeHarness({ emailSender: { send: vi.fn() } });
    const res = await request(app).post('/api/digest/send-raw').send({ amp: AMP, to: 'a@b.com' });
    expect(res.status).toBe(401);
  });

  it('409 email_not_configured when no sender is wired', async () => {
    const { app } = makeHarness({ emailSender: undefined });
    const res = await post(app, { amp: AMP, to: 'dev@example.com' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'email_not_configured' });
  });

  it('sends the EDITED amp byte-for-byte as the text/x-amp-html part', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_raw_1' });
    const { app } = makeHarness({ emailSender: { send } });
    // Surrounding whitespace is part of the fixture ON PURPOSE: a document that
    // survives a `.trim()` unnoticed is a document this lane cannot be trusted
    // with — the operator's bytes must arrive unchanged, edges included.
    const edited = `\n  ${AMP.replace('נערך ידנית', 'נערך ידנית פעמיים')}  \n`;

    const res = await post(app, { amp: edited, to: 'dev@example.com', subject: 'debug run' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      id: 'em_raw_1',
      to: 'dev@example.com',
      subject: 'debug run',
      ampBytes: Buffer.byteLength(edited, 'utf8'),
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [payload] = send.mock.calls[0];
    expect(payload.accountId).toBe(ACCOUNT_ID);
    expect(payload.to).toBe('dev@example.com');
    expect(payload.subject).toBe('debug run');
    expect(payload.amp).toBe(edited);
    expect(payload.mime.contentType).toMatch(/^multipart\/alternative/);
    expect(decodeAmpPart(payload.mime)).toBe(edited);
  });

  it('subject defaults to the saved digest subject when omitted', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_raw_2' });
    const { app } = makeHarness({ emailSender: { send } });
    const res = await post(app, { amp: AMP, to: 'dev@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe(CONFIG.digest.subject);
    expect(send.mock.calls[0][0].subject).toBe(CONFIG.digest.subject);
  });

  it('works with NO saved config — the lane never depends on digest wiring', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_raw_3' });
    const { app } = makeHarness({ emailSender: { send }, seed: {} });
    const res = await post(app, { amp: AMP, to: 'dev@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof send.mock.calls[0][0].subject).toBe('string');
    expect(send.mock.calls[0][0].subject.length).toBeGreaterThan(0);
  });

  it('a custom plain part is passed through; omitted → a non-empty default (MIME needs one)', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_raw_4' });
    const { app } = makeHarness({ emailSender: { send } });

    await post(app, { amp: AMP, to: 'dev@example.com', plain: 'טקסט חלופי' });
    expect(send.mock.calls[0][0].plain).toBe('טקסט חלופי');

    await post(app, { amp: AMP, to: 'dev@example.com' });
    expect(send.mock.calls[1][0].plain.length).toBeGreaterThan(0);
  });

  it.each([
    ['missing amp', { to: 'dev@example.com' }, 'invalid_amp'],
    ['empty amp', { amp: '   ', to: 'dev@example.com' }, 'invalid_amp'],
    ['non-string amp', { amp: 42, to: 'dev@example.com' }, 'invalid_amp'],
    ['missing recipient', { amp: AMP }, 'invalid_recipient'],
    ['recipient without @', { amp: AMP, to: 'not-an-email' }, 'invalid_recipient'],
    ['header break in recipient', { amp: AMP, to: 'a@b.com\r\nBcc: c@d.com' }, 'invalid_recipient'],
    ['header break in subject', { amp: AMP, to: 'a@b.com', subject: 'x\r\nBcc: c@d.com' }, 'invalid_subject'],
  ])('400 %s → %s (nothing is sent)', async (_label, body, error) => {
    const send = vi.fn();
    const { app } = makeHarness({ emailSender: { send } });
    const res = await post(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
    expect(send).not.toHaveBeenCalled();
  });

  it('413 amp_too_large above the hard cap (nothing is sent)', async () => {
    const send = vi.fn();
    const { app } = makeHarness({ emailSender: { send } });
    const res = await post(app, { amp: 'x'.repeat(1_000_001), to: 'dev@example.com' });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('amp_too_large');
    expect(send).not.toHaveBeenCalled();
  });

  it('Gmail rejection → 502 send_failed carrying the provider message (this IS the debug output)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('gmail send failed: 400'));
    const { app } = makeHarness({ emailSender: { send } });
    const res = await post(app, { amp: AMP, to: 'dev@example.com' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('send_failed');
    expect(res.body.message).toContain('gmail send failed: 400');
  });
});
