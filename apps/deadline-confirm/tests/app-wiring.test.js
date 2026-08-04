// createApp wiring facts that no route suite pins on its own, and that a
// mutation run showed the suite could not see.
//
// The urlencoded parser is the load-bearing one: amp-form posts
// `application/x-www-form-urlencoded` (Gmail always does — it is documented, not
// a choice), so dropping that parser makes every confirmation arrive with an
// empty body. The route would then answer 400 bad_fields for a perfectly valid
// submission, which reads like a signature bug and is not one.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const SENDER = 'deadline@twyst.co.il';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: ['777'],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [SENDER],
  googleOauthClientId: 'gcid',
  googleOauthClientSecret: 'gsecret',
  version: 'test',
};

function makeApp(env = ENV) {
  return createApp({
    storage: createAppStorage({ backend: createMemoryBackend() }),
    api: { fetchMe: vi.fn() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env,
    fetchImpl: vi.fn(),
  });
}

/** Well-shaped wire fields — enough to pass step 3 and reach the secret lookup. */
const WIRE = {
  a: '777',
  p: '42',
  s: '20260729',
  sig: 'c2ln',
  m: '100:b_done0001',
  item_100: 'b_done0001',
};

describe('createApp — body parsing', () => {
  it('parses an application/x-www-form-urlencoded AMP submission', async () => {
    const res = await request(makeApp())
      .post('/amp/confirm')
      .set('AMP-Email-Sender', SENDER)
      .type('form')
      .send(WIRE);

    // Reaching the per-account secret lookup (403 no_config) proves the fields
    // were parsed. An unparsed body would stop at 400 bad_fields.
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_config');
  });

  it('still answers 400 bad_fields for a form submission that really is malformed', async () => {
    const res = await request(makeApp())
      .post('/amp/confirm')
      .set('AMP-Email-Sender', SENDER)
      .type('form')
      .send({ a: 'not-numeric', p: '42', s: '20260729', sig: 'x', m: '100:b_x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_fields');
  });

  it('parses a JSON AMP submission too', async () => {
    const res = await request(makeApp())
      .post('/amp/confirm')
      .set('AMP-Email-Sender', SENDER)
      .send(WIRE);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_config');
  });
});

// The AMP debug lane POSTs a whole amp4email document as JSON. Express's
// default 100kb JSON limit is BELOW a realistic digest, so the ceiling here is
// a product requirement, not tuning: at the default the send-raw route would
// answer "too large" for exactly the documents worth debugging.
describe('createApp — JSON body ceiling', () => {
  const jsonPost = (bytes) =>
    request(makeApp())
      .post('/api/digest/send-raw')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ amp: 'x'.repeat(bytes) }));

  it('accepts a JSON body well above express default 100kb (reaches the route, not the parser)', async () => {
    // 401 = the session gate, i.e. the body WAS parsed and routing happened.
    expect((await jsonPost(500_000)).status).toBe(401);
  });

  it('refuses a body past the ceiling with 413, never a 500', async () => {
    const res = await jsonPost(2_500_000);
    expect(res.status).toBe(413);
    expect(res.body).toStrictEqual({ error: 'payload_too_large' });
  });
});

describe('createApp — mounted surfaces', () => {
  it('mounts the Google OAuth router', async () => {
    // No sessionToken → 401 from the route's own gate. A 404 would mean the
    // router is not mounted at all and no mailbox could ever be connected.
    expect((await request(makeApp()).get('/oauth/google/start')).status).toBe(401);
  });

  it('does not advertise Express in the response headers', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers /health with the configured version', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ ok: true, version: 'test' });
  });
});
