// TDD red phase (V5) — POST /amp/confirm, the Gmail dynamic-email endpoint.
//
// One request carries EVERY task the reader ticked in one section, so this is
// the app's only bulk mutation path. Ordered contract (a security contract —
// do not reorder):
//   1. AMP CORS gate (helpers/amp-cors.js) — FIRST, because it is pure header
//      work with no I/O: a caller that is not an allow-listed sender's email
//      never reaches storage, never learns whether a secret is valid, and gets
//      NO CORS headers back (the email client then discards the response).
//   2. parse+validate: a /^\d{1,20}$/, k non-empty, btn /^[A-Za-z0-9_-]{1,64}$/,
//      item[] all /^\d{1,20}$/, 1..MAX_ITEMS of them
//   3. secret gate (constant-time, ACCOUNT-scoped) → 403
//   4. rate limit, bucket `${a}:${ip}` → 429
//   5. performAction per item, reusing the v2/v3 engine verbatim (so
//      already-at-target stays a silent success and nothing is written twice)
//
// Every response from step 2 onwards carries the CORS headers (otherwise Gmail
// cannot render our message) and is application/json, which amp-form feeds to
// the <template type="amp-mustache"> blocks. A request that authorized cleanly
// but updated nothing answers 5xx so the reader sees the error template.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

import getItemFx from './fixtures/get-item.probe.json';
import getItemAfterFx from './fixtures/get-item-after-transition.probe.json';
import getItemNotFoundFx from './fixtures/get-item-not-found.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id;
const BOARD_ID = getItemFx.data.items[0].board.id;

const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ACCOUNT_ID = '777';
const SENDER = 'deadline@twyst.co.il';
const GMAIL_ORIGIN = 'https://mail.google.com';

const BTN_DONE = {
  id: 'b_done0001',
  name: 'בוצע',
  statusColumnId: STATUS_COL,
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const CONFIG = { boardId: BOARD_ID, peopleColumnId: PEOPLE_COL, buttons: [BTN_DONE], templates: [] };

const ENV = {
  clientId: 'ci',
  clientSecret: 'cs',
  allowedAccountIds: [],
  baseUrl: 'https://app.example',
  ampAllowedSenders: [SENDER],
};

function itemStateFrom(fixture) {
  const item = fixture.data.items[0];
  if (!item) return { found: false };
  const col = (id) => item.column_values.find((c) => c.id === id);
  return {
    found: true,
    boardId: item.board.id,
    statusLabelId: col(STATUS_COL).index ?? null,
    peopleText: col(PEOPLE_COL).text ?? '',
    deadlineDate: null,
  };
}

function buildApp({ itemState = itemStateFrom(getItemFx), secret = SECRET, allow = true, env = ENV } = {}) {
  const inner = createMemoryBackend({
    [`${ACCOUNT_ID}:config`]: CONFIG,
    [`${ACCOUNT_ID}:link_secret`]: secret,
    [`${ACCOUNT_ID}:oauth_token`]: 'tok-1',
  });
  let backendGets = 0;
  const backend = {
    get: async (key) => {
      backendGets += 1;
      return inner.get(key);
    },
    set: (key, value) => inner.set(key, value),
    delete: (key) => inner.delete(key),
  };
  const storage = createAppStorage({ backend });
  const api = {
    getItemState: vi.fn(async () => itemState),
    changeStatus: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {}),
    fetchMe: vi.fn(async () => ({ id: 'x', name: 'x' })),
  };
  const rateLimiter = { allow: vi.fn(() => allow) };
  return { app: createApp({ storage, api, rateLimiter, env }), api, rateLimiter, gets: () => backendGets };
}

/** POST as Gmail's CORS v2 client (AMP-Email-Sender) unless overridden. */
function postAmp(app, body, { sender = SENDER, origin, sourceOrigin } = {}) {
  let req = request(app).post(sourceOrigin ? `/amp/confirm?__amp_source_origin=${sourceOrigin}` : '/amp/confirm');
  if (sender) req = req.set('AMP-Email-Sender', sender);
  if (origin) req = req.set('Origin', origin);
  return req.type('form').send(body);
}

const GOOD_BODY = { a: ACCOUNT_ID, k: SECRET, btn: BTN_DONE.id, item: [ITEM_ID, '12532634010'] };

let logSpy;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  for (const call of logSpy.mock.calls) {
    expect(call.map(String).join(' ')).not.toContain(SECRET);
  }
  vi.restoreAllMocks();
});

describe('POST /amp/confirm — CORS v2 happy path', () => {
  it('updates every ticked item and reports the count', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, GOOD_BODY);

    expect(res.status).toBe(200);
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(2);
    expect(res.body.message).toContain('2');
    expect(api.changeStatus).toHaveBeenCalledTimes(2);
    expect(api.createUpdate).toHaveBeenCalledTimes(2);
  });

  it('accepts a single ticked item sent as a scalar field', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, { ...GOOD_BODY, item: ITEM_ID });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
  });

  it('counts an already-at-target item as done without writing', async () => {
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemAfterFx) });
    const res = await postAmp(app, { ...GOOD_BODY, item: ITEM_ID });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.already).toBe(1);
    expect(api.changeStatus).not.toHaveBeenCalled();
  });
});

describe('POST /amp/confirm — CORS v1 (Origin + __amp_source_origin)', () => {
  it('answers with all three legacy headers', async () => {
    const { app } = buildApp();
    const res = await postAmp(app, GOOD_BODY, { sender: null, origin: GMAIL_ORIGIN, sourceOrigin: SENDER });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(GMAIL_ORIGIN);
    expect(res.headers['amp-access-control-allow-source-origin']).toBe(SENDER);
    expect(res.headers['access-control-expose-headers']).toBe('AMP-Access-Control-Allow-Source-Origin');
  });
});

describe('POST /amp/confirm — the CORS gate runs before anything else', () => {
  it('rejects an unlisted sender with no CORS headers, no storage read and no API call', async () => {
    const { app, api, gets } = buildApp();
    const res = await postAmp(app, GOOD_BODY, { sender: 'attacker@evil.example' });

    expect(res.status).toBe(403);
    expect(res.headers['amp-email-allow-sender']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(gets()).toBe(0);
    expect(api.getItemState).not.toHaveBeenCalled();
  });

  it('rejects a plain request that carries neither CORS mechanism', async () => {
    const { app, gets } = buildApp();
    const res = await postAmp(app, GOOD_BODY, { sender: null });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_amp_headers');
    expect(gets()).toBe(0);
  });

  it('rejects every sender while the allowlist is empty', async () => {
    const { app, gets } = buildApp({ env: { ...ENV, ampAllowedSenders: [] } });
    const res = await postAmp(app, GOOD_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_configured');
    expect(gets()).toBe(0);
  });
});

describe('POST /amp/confirm — validation, secret and rate limit', () => {
  it('rejects a submission with nothing ticked, before touching monday', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, { ...GOOD_BODY, item: undefined });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_items');
    expect(res.body.message).toBeTruthy();
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
    expect(api.getItemState).not.toHaveBeenCalled();
  });

  it('rejects a malformed button id', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, { ...GOOD_BODY, btn: 'bad btn!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
    expect(api.getItemState).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric item id', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, { ...GOOD_BODY, item: [ITEM_ID, 'DROP TABLE'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
    expect(api.getItemState).not.toHaveBeenCalled();
  });

  it('caps the number of items in one submission', async () => {
    const { app, api } = buildApp();
    const item = Array.from({ length: 51 }, (_, i) => String(1000 + i));
    const res = await postAmp(app, { ...GOOD_BODY, item });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('too_many_items');
    expect(api.getItemState).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret without calling monday', async () => {
    const { app, api } = buildApp();
    const res = await postAmp(app, { ...GOOD_BODY, k: 'not-the-secret' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid');
    expect(api.getItemState).not.toHaveBeenCalled();
  });

  it('answers 429 when the account+ip bucket is empty', async () => {
    const { app, api, rateLimiter } = buildApp({ allow: false });
    const res = await postAmp(app, GOOD_BODY);

    expect(res.status).toBe(429);
    expect(rateLimiter.allow).toHaveBeenCalled();
    expect(api.getItemState).not.toHaveBeenCalled();
  });
});

describe('POST /amp/confirm — partial and total failure', () => {
  it('answers 502 when every ticked item failed', async () => {
    const { app } = buildApp({ itemState: itemStateFrom(getItemNotFoundFx) });
    const res = await postAmp(app, { ...GOOD_BODY, item: ITEM_ID });

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.failed).toBe(1);
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
  });

  it('leaks no item or account data in any response body', async () => {
    const { app } = buildApp({ itemState: itemStateFrom(getItemNotFoundFx) });
    const res = await postAmp(app, { ...GOOD_BODY, item: ITEM_ID });

    expect(JSON.stringify(res.body)).not.toContain(BOARD_ID);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});

describe('OPTIONS /amp/confirm', () => {
  it('answers the preflight with the CORS headers and the allowed method', async () => {
    const { app } = buildApp();
    const res = await request(app).options('/amp/confirm').set('AMP-Email-Sender', SENDER);

    expect(res.status).toBe(200);
    expect(res.headers['amp-email-allow-sender']).toBe(SENDER);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('refuses the preflight of an unlisted sender', async () => {
    const { app } = buildApp();
    const res = await request(app).options('/amp/confirm').set('AMP-Email-Sender', 'attacker@evil.example');

    expect(res.status).toBe(403);
    expect(res.headers['amp-email-allow-sender']).toBeUndefined();
  });
});
