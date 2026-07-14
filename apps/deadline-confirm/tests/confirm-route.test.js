// TDD red phase — GET/HEAD /confirm through the REAL app pipeline
// (createApp + createConfirmRouter), supertest end-to-end. Maps spec §15
// acceptance tests 1-5, 7, 8, 11 plus the §6 logging contract.
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
import getItemEmptyFx from './fixtures/get-item-empty.probe.json';
import getItemNotFoundFx from './fixtures/get-item-not-found.probe.json';

const STATUS_COL = 'color_mm58mbec';
const PEOPLE_COL = 'multiple_person_mm582h4p';
const DATE_COL = 'date_mm58ej61';
const ITEM_ID = getItemFx.data.items[0].id; // '12532634009'

const SECRET = 'wJalrXUtnFEMIK7MDENGbPxRfiCY_EXAMPLEKEY-43x';
const ENV = {
  clientId: 'ci',
  clientSecret: 'cs',
  allowedAccountId: '1',
  baseUrl: 'https://app.example',
};

const BASE_CONFIG = {
  boardId: '18422009734',
  statusColumnId: STATUS_COL,
  fromIndex: 0,
  fromLabel: 'בעבודה',
  toIndex: 1,
  toLabel: 'בוצע',
  peopleColumnId: PEOPLE_COL,
  expiryDateColumnId: null,
  expiryGraceDays: 0,
};

const SUCCESS_HEADING = 'המשימה עודכנה ✓';
const INVALID_HEADING = 'הקישור אינו בתוקף';
const BAD_REQUEST_HEADING = 'בקשה שגויה';

/** Derive an ItemState (the monday-api contract shape) from a probe fixture. */
function itemStateFrom(fixture, { withDeadline = false } = {}) {
  const item = fixture.data.items[0];
  if (!item) return { found: false };
  const col = (id) => item.column_values.find((c) => c.id === id);
  return {
    found: true,
    boardId: item.board.id,
    statusLabelId: col(STATUS_COL).index ?? null,
    peopleText: col(PEOPLE_COL).text ?? '',
    deadlineDate: withDeadline ? col(DATE_COL).date || null : null,
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
  config = BASE_CONFIG,
  secret = SECRET,
  oauthToken = 'tok-1',
  itemState,
  getItemError,
  allow = true,
  todayIso = '2026-07-14',
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
  const app = createApp({ storage, api, rateLimiter, env: ENV, todayIso });

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

describe('GET /confirm — acceptance 1: happy path', () => {
  it('returns the 200 success page with the target label, text/html and Cache-Control no-store', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-type']).toMatch(/charset=utf-8/i);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(SUCCESS_HEADING);
    expect(res.text).toContain('בוצע');
  });

  it("performs exactly one status mutation + one attribution update and logs outcome 'ok'", async () => {
    const { app, api } = buildApp();

    await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expect(api.changeStatus.mock.calls[0][0]).toEqual({
      token: 'tok-1',
      boardId: BASE_CONFIG.boardId,
      itemId: ITEM_ID,
      columnId: STATUS_COL,
      toLabelId: BASE_CONFIG.toIndex,
    });
    expect(api.createUpdate).toHaveBeenCalledTimes(1);
    expect(api.createUpdate.mock.calls[0][0]).toMatchObject({
      itemId: ITEM_ID,
      body: 'אושר במייל על ידי עילי שלם',
    });
    expectSingleAttempt({ outcome: 'ok' });
  });
});

describe('GET /confirm — acceptance 2+3: wrong status is idempotency', () => {
  it("second click (status already at toIndex) returns the generic invalid page, no mutation, outcome 'wrong_status'", async () => {
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemAfterFx) });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(res.text).not.toContain(SUCCESS_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'wrong_status' });
  });

  it("item whose status was never set (not the from label) → invalid page with no-store, no mutation, outcome 'wrong_status'", async () => {
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemEmptyFx) });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(INVALID_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'wrong_status' });
  });
});

describe('GET /confirm — acceptance 4: board scope guard', () => {
  it("item from another board (valid k) → invalid page, no mutation, outcome 'wrong_board'", async () => {
    const itemState = { ...itemStateFrom(getItemFx), boardId: '99999999999' };
    const { app, api } = buildApp({ itemState });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expect(api.createUpdate).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'wrong_board' });
  });
});

describe('GET /confirm — acceptance 5: secret gate and input validation', () => {
  it("wrong k → 200 invalid page, ZERO monday api calls, outcome 'bad_key'", async () => {
    const { app, api } = buildApp();

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: 'not-the-secret' });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_key' });
  });

  it("missing k → 400 bad-request page, zero api calls, outcome 'bad_request'", async () => {
    const { app, api } = buildApp();

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_request' });
  });

  it("non-numeric itemId 'abc' → 400, zero api calls", async () => {
    const { app, api } = buildApp();

    const res = await request(app).get('/confirm').query({ itemId: 'abc', k: SECRET });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
    expect(apiCallCount(api)).toBe(0);
  });

  it('21-digit itemId (one past the /^\\d{1,20}$/ boundary) → 400, zero api calls', async () => {
    const { app, api } = buildApp();

    const res = await request(app)
      .get('/confirm')
      .query({ itemId: '1'.repeat(21), k: SECRET });

    expect(res.status).toBe(400);
    expect(apiCallCount(api)).toBe(0);
  });

  it('missing itemId → 400 bad-request page', async () => {
    const { app } = buildApp();

    const res = await request(app).get('/confirm').query({ k: SECRET });

    expect(res.status).toBe(400);
    expect(res.text).toContain(BAD_REQUEST_HEADING);
  });

  it("20-digit itemId (exactly ON the regex boundary) passes validation; missing item → invalid page, outcome 'not_found'", async () => {
    const twentyDigits = '12345678901234567890';
    const { app, api } = buildApp({ itemState: itemStateFrom(getItemNotFoundFx) });

    const res = await request(app).get('/confirm').query({ itemId: twentyDigits, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(api.getItemState).toHaveBeenCalledTimes(1);
    expect(api.getItemState.mock.calls[0][0]).toMatchObject({ itemId: twentyDigits });
    expect(api.changeStatus).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'not_found', itemId: twentyDigits });
  });
});

describe('HEAD /confirm — acceptance 7: mail-scanner no-op', () => {
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

describe('GET /confirm — acceptance 8: rate limit (after the secret gate)', () => {
  it("over-limit request with a VALID k → plain 429, zero api calls, outcome 'rate_limited'", async () => {
    const { app, api, rateLimiter } = buildApp({ allow: false });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(429);
    expect(res.text).not.toContain(INVALID_HEADING);
    expect(res.text).not.toContain(SUCCESS_HEADING);
    expect(rateLimiter.allow).toHaveBeenCalledTimes(1);
    expect(typeof rateLimiter.allow.mock.calls[0][0]).toBe('string');
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'rate_limited' });
  });

  it("wrong k while rate-limited → invalid page (bad_key), NOT 429 — §6 order: secret check (3) precedes rate limit (4)", async () => {
    const { app, api, rateLimiter } = buildApp({ allow: false });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: 'not-the-secret' });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(rateLimiter.allow).not.toHaveBeenCalled();
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'bad_key' });
  });
});

describe('GET /confirm — acceptance 11: expiry', () => {
  const expiryConfig = { ...BASE_CONFIG, expiryDateColumnId: DATE_COL, expiryGraceDays: 2 };

  it("today past deadline+grace (2026-07-20 + 2 < 2026-07-23) → invalid page, no mutation, outcome 'expired'", async () => {
    const { app, api } = buildApp({
      config: expiryConfig,
      itemState: itemStateFrom(getItemFx, { withDeadline: true }),
      todayIso: '2026-07-23',
    });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(api.changeStatus).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'expired' });
  });

  it('today exactly ON deadline+grace (2026-07-22) is still valid → success page, outcome ok', async () => {
    const { app, api } = buildApp({
      config: expiryConfig,
      itemState: itemStateFrom(getItemFx, { withDeadline: true }),
      todayIso: '2026-07-22',
    });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(SUCCESS_HEADING);
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
    expectSingleAttempt({ outcome: 'ok' });
  });
});

describe('GET /confirm — unconfigured app and API failure never leak', () => {
  it("missing link_secret in storage → 200 invalid page (no 500), zero api calls, outcome 'no_config'", async () => {
    const { app, api } = buildApp({ secret: null });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'no_config' });
  });

  it("missing config (secret valid) → 200 invalid page, zero api calls, outcome 'no_config'", async () => {
    const { app, api } = buildApp({ config: null });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(apiCallCount(api)).toBe(0);
    expectSingleAttempt({ outcome: 'no_config' });
  });

  it("monday API throwing → 200 invalid page with no error/stack leak, outcome 'api_error'", async () => {
    const { app, api } = buildApp({
      getItemError: new MondayApiError('boom-internal-detail', { status: 500 }),
    });

    const res = await request(app).get('/confirm').query({ itemId: ITEM_ID, k: SECRET });

    expect(res.status).toBe(200);
    expect(res.text).toContain(INVALID_HEADING);
    expect(res.text).not.toContain('Error');
    expect(res.text).not.toContain('boom-internal-detail');
    expect(api.changeStatus).not.toHaveBeenCalled();
    expectSingleAttempt({ outcome: 'api_error' });
  });
});
