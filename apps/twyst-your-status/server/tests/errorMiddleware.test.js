// test-guard gate for the terminal 4-arg error middleware wired in src/app.js
// (error-guard server contract). A body-parse failure reaches the terminal
// handler, which LOGS (so it ships) and answers a bare 500 — never leaking an
// error body. Exercised end-to-end via a malformed JSON POST, which express.json()
// rejects at the app level before any route runs.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

function makeDeps() {
  return {
    handleEvent: vi.fn(),
    tokenStore: { getReaderToken: vi.fn(), getOwnerToken: vi.fn(), setOwnerToken: vi.fn() },
    enrollmentStore: { get: vi.fn(), set: vi.fn() },
    api: { me: vi.fn() },
    oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
    env: { signingSecret: 's', clientSecret: 'c', clientId: 'cid', baseUrl: 'https://g', allowUnsignedWebhooks: false },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('terminal error middleware', () => {
  it('answers a bare 500 { error: internal_error } and LOGS when body parsing throws', async () => {
    const deps = makeDeps();
    const app = createApp(deps);

    const res = await request(app)
      .post('/api/guard/webhook')
      .set('Content-Type', 'application/json')
      .send('{ not valid json ');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
    expect(deps.logger.error).toHaveBeenCalledTimes(1);
    // Logged under the http tag, and the response body carries NO error detail.
    expect(deps.logger.error.mock.calls[0][1]).toBe('http');
    expect(JSON.stringify(res.body)).not.toMatch(/json/i);
  });
});
