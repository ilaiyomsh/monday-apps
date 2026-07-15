// TDD red phase (v2) — HEAD/GET/POST /confirm through the REAL app pipeline
// (createApp + createConfirmRouter), supertest end-to-end.
// v2 model (owner decisions 2026-07-15): GET serves a JS auto-confirm landing
// page and performs NO action and NO monday API call (mail-scanner
// protection); the page auto-POSTs {itemId,k,btn} to POST /confirm which
// performs the action via performAction. Shared ordered contract for both
// verbs: parse/validate → secret gate → rate limit.
// monday responses are ItemState fakes derived from the probe fixtures;
// storage is the real createAppStorage over the in-memory backend.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

import getItemFx from './fixtures/get-item.probe.json';
import getItemAfterFx from './fixtures/get-item-after-transition.probe.json';
import getItemNotFoundFx from './fixtures/get-item-not-found.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const ITEM_ID = getItemFx.data.items[0].id; // '12532634009'
const BOARD_ID = getItemFx.data.items[0].board.id; // '18422009734'

const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ENV = {
  clientId: 'ci',
  clientSecret: 'cs',
  allowedAccountId: '1',
  baseUrl: 'https://app.example',
};

const BTN_DONE = {
  id: 'b_done0001',
  name: 'בוצע',
  statusColumnId: STATUS_COL,
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};
// targetIndex 0 is a VALID label id — the falsy trap stays in the seed config.
const BTN_WORK = {
  id: 'b_work0002',
  name: 'בעבודה',
  statusColumnId: STATUS_COL,
  targetIndex: 0,
  targetLabel: 'בעבודה',
  style: { color: '#fdab3d', icon: '', size: 'sm' },
};

const V2_CONFIG = {
  boardId: BOARD_ID,
  peopleColumnId: PEOPLE_COL,
  buttons: [BTN_DONE, BTN_WORK],
  templates: [],
};

const SUCCESS_HEADING = 'המשימה עודכנה ✓';
const INVALID_HEADING = 'הקישור אינו בתוקף';
const BAD_REQUEST_HEADING = 'בקשה שגויה';
const NOSCRIPT_BUTTON_TEXT = 'המשך לאישור';
const LANDING_INTERIM_TEXT = 'מאשר את המשימה';

/** Derive an ItemState (the monday-api contract shape) from a probe fixture. */
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

function fakeApi({ itemState = itemStateFrom(getItemFx), getItemError } = {}) {
  return {
    getItemState: vi.fn(async () => {
      if (getItemError) throw getItemError;
      return itemState;
    }),
    changeStatus: vi.fn(async () => {}),
    createUpdate: vi.fn(async () => {}),
    fetchMe: vi.fn(async () => ({ id: 'unused', name: 'unused' })),
  };
}

function apiCallCount(api) {
  return (
    api.getItemState.mock.calls.length +
    api.changeStatus.mock.calls.length +
    api.createUpdate.mock.calls.length +
    api.fetchMe.mock.calls.length
  );
}

/**
 * Build the real app with fake api / counting backend / counting limiter.
 * Seeded keys: config, link_secret, oauth_token — pass null to omit one.
 */
function buildApp({
  config = V2_CONFIG,
  secret = SECRET,
  oauthToken = 'tok-1',
  itemState,
  getItemError,
  allow = true,
} = {}) {
  const seed = {};
  if (config !== null) seed.config = config;
  if (secret !== null) seed.link_secret = secret;
  if (oauthToken !== null) seed.oauth_token = oauthToken;

  const inner = createMemoryBackend(seed);
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
  const api = fakeApi({ itemState, getItemError });
  const rateLimiter = { allow: vi.fn(() => allow) };
  const app = createApp({ storage, api, rateLimiter, env: ENV });

  return {
    app,
    api,
    rateLimiter,
    backendGets: () => backendGets,
    resetBackendGets: () => {
      backendGets = 0;
    },
  };
}

const GOOD_QUERY = { itemId: ITEM_ID, k: SECRET, btn: BTN_DONE.id };

function postConfirm(app, body = GOOD_QUERY) {
  return request(app).post('/confirm').type('form').send(body);
}

let logSpy;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  // Security checklist §13: no secrets in logs — across EVERY test.
  for (const call of logSpy.mock.calls) {
    expect(call.map(String).join(' ')).not.toContain(SECRET);
  }
  vi.restoreAllMocks();
});

/** All console.log lines that parse as JSON attempt entries ({...outcome}). */
function attemptLines() {
  return logSpy.mock.calls
    .map((args) => args.map(String).join(' '))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry === 'object' && 'outcome' in entry);
}

/** Exactly ONE attempt line, exactly the {ts, ip, itemId, outcome} shape. */
function expectSingleAttempt({ outcome, itemId = ITEM_ID }) {
  const lines = attemptLines();
  expect(lines).toHaveLength(1);
  const entry = lines[0];
  expect(Object.keys(entry).sort()).toEqual(['ip', 'itemId', 'outcome', 'ts']);
  expect(entry.outcome).toBe(outcome);
  expect(entry.itemId).toBe(itemId);
  expect(typeof entry.ip).toBe('string');
  expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
  return entry;
}

/** Assert a hidden input named `name` carrying exactly `value` in the html. */
function expectHiddenInput(html, name, value) {
  const match = html.match(new RegExp(`<input\\b[^>]*name="${name}"[^>]*>`, 'i'));
  expect(match, `hidden input "${name}" missing from the landing page`).toBeTruthy();
  expect(match[0]).toContain('type="hidden"');
  expect(match[0]).toContain(`value="${value}"`);
}

describe('HEAD /confirm — mail-scanner first line (unchanged from v1)', () => {
  it('returns 200 with an empty body, ZERO backend reads and ZERO api calls', async () => {
    const { app, api, backendGets, resetBackendGets } = buildApp();
    resetBackendGets(); // ignore any reads during app construction

    const res = await request(app).head('/confirm');

    expect(res.status).toBe(200);
    expect(res.text ?? '').toBe('');
    expect(backendGets()).toBe(0);
    expect(apiCallCount(api)).toBe(0);
  });
});

describe('GET /confirm — auto-confirm landing page (scanner protection)', () => {
  it('serves 200 text/html with Cache-Control no-store and a POST form targeting /confirm', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/confirm').query(GOOD_QUERY);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-type']).toMatch(/charset=utf-8/i);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toMatch(/<form\b[^>]*action="\/confirm"/i);
    expect(res.text).toMatch(/method="post"/i);
    expect(res.text).toContain(LANDING_INTERIM_TEXT);
  });

  it('echoes the exact itemId/k/btn as hidden inputs, with an inline auto-submit script and a noscript fallback', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/confirm').query(GOOD_QUERY);

    expectHiddenInput(res.text, 'itemId', ITEM_ID);
    expectHiddenInput(res.text, 'k', SECRET);
    expectHiddenInput(res.text, 'btn', BTN_DONE.id);
    expect(res.text).toMatch(/<script\b/i);
    expect(res.text).toMatch(/\.submit\s*\(/);
    expect(res.text).toMatch(/<noscript\b/i);
    expect(res.text).toContain(NOSCRIPT_BUTTON_TEXT);
  });

  it("THE SCANNER TEST: a plain GET (no JS) performs ZERO monday api calls, mutates nothing, and logs outcome 'page_served'", async () => {
    const { app, api, backendGets, resetBackendGets } = buildApp();
    resetBackendGets();

    const res = await request(app).get('/confirm').query(GOOD_QUERY);

    expect(res.status).toBe(200);
    expect(apiCallCount(api)).toBe(0);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
    // NO config load beyond the secret: the single request reads only link_secret.
    expect(backendGets()).toBe(1);
    expectSingleAttempt({ outcome: 'page_served' });
  });

  it("serves the landing page even for an unknown 64-char btn (ON the length boundary) — resolution is POST-side only, outcome 'page_served'", async () => {
    const { app, api } = buildApp();
    const btn64 = 'a'.repeat(64);

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: ITEM_ID, k: SECRET, btn: btn64 });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<form\b[^>]*action="\/confirm"/i);
    expectHiddenInput(res.text, 'btn', btn64);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'page_served' });
  });
});

describe('GET /confirm — input validation (parse step 1, before the secret gate)', () => {
  it("missing itemId → 400 bad-request page (html, no-store), zero api calls, outcome 'bad_request' with itemId null", async () => {
    const { app, api } = buildApp();

    const res = await request(app).get('/confirm').query({ k: SECRET, btn: BTN_DONE.id });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request', itemId: null });
  });

  it("non-numeric itemId 'abc' → 400, zero api calls, itemId logged as null", async () => {
    const { app, api } = buildApp();

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: 'abc', k: SECRET, btn: BTN_DONE.id });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request', itemId: null });
  });

  it('21-digit itemId (one past the /^\\d{1,20}$/ boundary) → 400, zero api calls', async () => {
    const { app, api } = buildApp();

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: '1'.repeat(21), k: SECRET, btn: BTN_DONE.id });

    expect(res.status).toBe(400);
    expect(apiCallCount(api)).toBe(0);
  });

  it("missing k → 400 bad-request page, zero api calls, outcome 'bad_request'", async () => {
    const { app, api } = buildApp();

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, btn: BTN_DONE.id });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request' });
  });

  it("missing btn → 400 bad-request page, zero api calls, outcome 'bad_request'", async () => {
    const { app, api } = buildApp();

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request' });
  });

  it("btn with a space ('x y', outside /^[A-Za-z0-9_-]{1,64}$/) → 400, zero api calls", async () => {
    const { app, api } = buildApp();

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: ITEM_ID, k: SECRET, btn: 'x y' });

    expect(res.status).toBe(400);
    expect(apiCallCount(api)).toBe(0);
  });

  it('65-char btn (one past the length boundary) → 400, zero api calls', async () => {
    const { app, api } = buildApp();

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: ITEM_ID, k: SECRET, btn: 'a'.repeat(65) });

    expect(res.status).toBe(400);
    expect(apiCallCount(api)).toBe(0);
  });
});

describe('GET /confirm — secret gate (step 2)', () => {
  it("wrong k → 200 invalid page, ZERO api calls, outcome 'bad_key'", async () => {
    const { app, api } = buildApp();

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: ITEM_ID, k: 'not-the-secret', btn: BTN_DONE.id });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(res.text).not.toContain(LANDING_INTERIM_TEXT);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_key' });
  });

  it("no stored link_secret → 200 invalid page (no 500), zero api calls, outcome 'no_config'", async () => {
    const { app, api } = buildApp({ secret: null });

    const res = await request(app).get('/confirm').query(GOOD_QUERY);

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'no_config' });
  });
});

describe('GET /confirm — rate limit (step 3, after the secret gate)', () => {
  it("over-limit request with a VALID k → plain 429, zero api calls, outcome 'rate_limited'", async () => {
    const { app, api, rateLimiter } = buildApp({ allow: false });

    const res = await request(app).get('/confirm').query(GOOD_QUERY);

    expect(res.status).toBe(429);
    expect(res.text).not.toContain(INVALID_HEADING);
    expect(res.text).not.toContain(LANDING_INTERIM_TEXT);
    expect(rateLimiter.allow).toHaveBeenCalledTimes(1);
    expect(typeof rateLimiter.allow.mock.calls[0][0]).toBe('string');
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'rate_limited' });
  });

  it("wrong k while rate-limited → 'bad_key' invalid page, NOT 429 — the secret gate precedes the rate limit", async () => {
    const { app, api, rateLimiter } = buildApp({ allow: false });

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: ITEM_ID, k: 'not-the-secret', btn: BTN_DONE.id });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(rateLimiter.allow).not.toHaveBeenCalled();
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_key' });
  });
});

describe('POST /confirm — happy path (urlencoded body from the landing page)', () => {
  it("returns the 200 success page with the button's target label, text/html and no-store", async () => {
    const { app } = buildApp(); // item at label 0, button target 1

    const res = await postConfirm(app);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-type']).toMatch(/charset=utf-8/i);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(SUCCESS_HEADING);
    expect(res.text).toContain('בוצע');
  });

  it("mutates EXACTLY once with the button's column+target, creates the attribution update, logs outcome 'ok'", async () => {
    const { app, api } = buildApp();

    await postConfirm(app);

    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: 1,
    });
    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'סומן "בוצע" במייל על ידי עילי שלם',
    });
    expectSingleAttempt({ outcome: 'ok' });
  });
});

describe('POST /confirm — already at target = SILENT success', () => {
  it("item already at the button's target → 200 success page, NO mutation, NO update, outcome 'already_done'", async () => {
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemAfterFx) }); // status 1 === target 1

    const res = await postConfirm(app);

    expect(res.status).toBe(200);
    expect(res.text).toContain(SUCCESS_HEADING);
    expect(res.text).not.toContain(INVALID_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'already_done' });
  });
});

describe('POST /confirm — per-button routing', () => {
  it("clicking b_work0002 drives toward ITS target: toLabelId 0 (falsy label id), success page shows 'בעבודה'", async () => {
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemAfterFx) }); // status 1 ≠ target 0

    const res = await postConfirm(app, { itemId: ITEM_ID, k: SECRET, btn: BTN_WORK.id });

    expect(res.status).toBe(200);
    expect(res.text).toContain(SUCCESS_HEADING);
    expect(res.text).toContain('בעבודה');
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BOARD_ID,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: 0,
    });
    expect(api.createUpdate.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      itemId: ITEM_ID,
      body: 'סומן "בעבודה" במייל על ידי עילי שלם',
    });
    expectSingleAttempt({ outcome: 'ok' });
  });
});

describe('POST /confirm — unknown button', () => {
  it("well-formed btn id on no configured button → 200 invalid page, ZERO api calls, outcome 'unknown_button'", async () => {
    const { app, api } = buildApp();

    const res = await postConfirm(app, { itemId: ITEM_ID, k: SECRET, btn: 'b_nope9999' });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(res.text).not.toContain(SUCCESS_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'unknown_button' });
  });
});

describe('POST /confirm — validation, secret gate and rate limit mirror GET', () => {
  it("missing btn in the body → 400 bad-request page, zero api calls, outcome 'bad_request'", async () => {
    const { app, api } = buildApp();

    const res = await postConfirm(app, { itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request' });
  });

  it("non-numeric itemId → 400, zero api calls, outcome 'bad_request' with itemId null", async () => {
    const { app, api } = buildApp();

    const res = await postConfirm(app, { itemId: 'abc', k: SECRET, btn: BTN_DONE.id });

    expect(res.status).toBe(400);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request', itemId: null });
  });

  it("wrong k → 200 invalid page, zero api calls, outcome 'bad_key'", async () => {
    const { app, api } = buildApp();

    const res = await postConfirm(app, { itemId: ITEM_ID, k: 'not-the-secret', btn: BTN_DONE.id });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_key' });
  });

  it("over-limit POST with a VALID k → plain 429, zero api calls, outcome 'rate_limited'", async () => {
    const { app, api, rateLimiter } = buildApp({ allow: false });

    const res = await postConfirm(app);

    expect(res.status).toBe(429);
    expect(res.text).not.toContain(SUCCESS_HEADING);
    expect(res.text).not.toContain(INVALID_HEADING);
    expect(rateLimiter.allow).toHaveBeenCalledTimes(1);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'rate_limited' });
  });

  it("wrong k while rate-limited → 'bad_key', NOT 429 — secret gate precedes rate limit on POST too", async () => {
    const { app, rateLimiter } = buildApp({ allow: false });

    const res = await postConfirm(app, { itemId: ITEM_ID, k: 'not-the-secret', btn: BTN_DONE.id });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(rateLimiter.allow).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'bad_key' });
  });
});

describe('POST /confirm — service outcomes render the generic invalid page (HTTP 200)', () => {
  it("item from another board → invalid page, no mutation, outcome 'wrong_board'", async () => {
    const itemState = { ...itemStateFrom(getItemFx), boardId: '99999999999' };
    const { app, api } = buildApp({ itemState });

    const res = await postConfirm(app);

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'wrong_board' });
  });

  it("missing item → invalid page, no mutation, outcome 'not_found'", async () => {
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemNotFoundFx) });

    const res = await postConfirm(app);

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'not_found' });
  });

  it("monday API throwing → invalid page with no error/stack leak, outcome 'api_error'", async () => {
    const { app, api } = buildApp({
      getItemError: new MondayApiError('boom-internal-detail', { status: 500 }),
    });

    const res = await postConfirm(app);

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(res.text).not.toContain('Error');
    expect(res.text).not.toContain('boom-internal-detail');
    expect(api.changeStatus).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'api_error' });
  });

  it("missing config (valid secret) → invalid page, zero api calls, outcome 'no_config'", async () => {
    const { app, api } = buildApp({ config: null });

    const res = await postConfirm(app);

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'no_config' });
  });
});
