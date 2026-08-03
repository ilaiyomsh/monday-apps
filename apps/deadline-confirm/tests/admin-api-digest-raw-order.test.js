// TDD — POST /api/digest/send-raw accepts a MIME part order, so the debug lane
// can send the SAME document in the three structures under dispute from the
// SAME mailbox. Without this the lane cannot test the order claim at all: it
// reuses buildMultipartAlternative, whose order was fixed in code.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { PART_ORDERS, DEFAULT_PART_ORDER } from '../src/helpers/mime-alternative.js';

const ACCOUNT_ID = '777';
const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};
const authHeader = () => jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');
const AMP = '<!doctype html>\n<html ⚡4email>\n<body>דינמי</body>\n</html>';

function harness() {
  const send = vi.fn().mockResolvedValue({ id: 'em_1' });
  const app = createApp({
    storage: createAppStorage({ backend: createMemoryBackend() }),
    api: { fetchMe: vi.fn(), getBoardItems: vi.fn() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    emailSender: { send },
  });
  return { app, send };
}

const post = (app, body) =>
  request(app).post('/api/digest/send-raw').set('Authorization', authHeader()).send(body);

/** Content-Types in the order they appear in the built body. */
const partTypesOf = (mime) =>
  mime.body
    .split(`--${/boundary="([^"]+)"/.exec(mime.contentType)[1]}`)
    .map((chunk) => /Content-Type: (\S+);/.exec(chunk)?.[1])
    .filter(Boolean);

describe('POST /api/digest/send-raw — part order', () => {
  it('omitting order keeps the production structure (plain → amp → html)', async () => {
    const { app, send } = harness();
    const res = await post(app, { amp: AMP, to: 'dev@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.order).toBe(DEFAULT_PART_ORDER);
    expect(partTypesOf(send.mock.calls[0][0].mime)).toEqual([
      'text/plain',
      'text/x-amp-html',
      'text/html',
    ]);
  });

  it('order plain-html-amp sends the AMP part LAST and echoes the variant back', async () => {
    const { app, send } = harness();
    const res = await post(app, { amp: AMP, to: 'dev@example.com', order: 'plain-html-amp' });

    expect(res.status).toBe(200);
    // Echoed so the operator can tell which variant an inbox message came from —
    // three near-identical emails are otherwise indistinguishable.
    expect(res.body.order).toBe('plain-html-amp');
    expect(partTypesOf(send.mock.calls[0][0].mime)).toEqual([
      'text/plain',
      'text/html',
      'text/x-amp-html',
    ]);
  });

  it('order plain-amp sends the 2-part control (no html fallback)', async () => {
    const { app, send } = harness();
    const res = await post(app, { amp: AMP, to: 'dev@example.com', order: 'plain-amp' });

    expect(res.status).toBe(200);
    expect(res.body.order).toBe('plain-amp');
    expect(partTypesOf(send.mock.calls[0][0].mime)).toEqual(['text/plain', 'text/x-amp-html']);
  });

  it('every supported order is accepted and ships the document unchanged', async () => {
    for (const order of PART_ORDERS) {
      const { app, send } = harness();
      const res = await post(app, { amp: AMP, to: 'dev@example.com', order });
      expect(res.status, order).toBe(200);
      expect(send.mock.calls[0][0].amp, order).toBe(AMP);
    }
  });

  it.each([
    ['an unknown order', 'amp-first'],
    ['a non-string order', 42],
    ['an empty order', ''],
  ])('400 invalid_order for %s — nothing is sent', async (_label, order) => {
    const { app, send } = harness();
    const res = await post(app, { amp: AMP, to: 'dev@example.com', order });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_order');
    // A silently-defaulted variant would make the experiment report a structure
    // it never actually sent.
    expect(send).not.toHaveBeenCalled();
  });
});
