// Integration tests for the admin API (contract: src/routes/admin-api.js
// module header). The REAL Express pipeline runs via createApp; auth uses REAL
// JWTs signed with the app client secret; the backend is inspected directly
// for persisted values. Response bodies the contract fixes are asserted with
// deep-equality (every field).
// v3 multi-tenant: every handler operates on the SESSION's account scope
// (storage.forAccount(req.session.accountId), backend keys `${accountId}:…`).
// V6: GET /api/snippet and GET /api/email-template are DELETED (D4) and the
// `templates` config field died with them (a legacy client still sending it
// is silently ignored).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

const ACCOUNT_ID = '777';
const OTHER_ACCOUNT_ID = '888';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};

/** Backend key inside the session account's namespace. */
const scoped = (key, accountId = ACCOUNT_ID) => `${accountId}:${key}`;

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const BUTTON_ID = /^b_[A-Za-z0-9_-]{4,16}$/;

function authHeader({ accountId = 777, userId = 1 } = {}) {
  return jwt.sign({ dat: { account_id: accountId, user_id: userId } }, 'cs-1');
}

function makeHarness({ seed = {}, env = ENV } = {}) {
  const backend = createMemoryBackend(seed);
  const storage = createAppStorage({ backend });
  const api = { fetchMe: vi.fn() };
  const app = createApp({
    storage,
    api,
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env,
    fetchImpl: vi.fn(),
  });
  return { app, backend, api };
}

// ---------------------------------------------------------------------------
// config builders — every call returns fresh objects (no shared mutation).
// ---------------------------------------------------------------------------

function omit(obj, key) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

function validStyle(overrides = {}) {
  return { color: '#00c875', icon: '✓', size: 'md', ...overrides };
}

function validButton(overrides = {}) {
  return {
    id: 'b_done0001',
    name: 'סמן כבוצע',
    statusColumnId: 'color_x',
    targetIndex: 1,
    targetLabel: 'בוצע',
    style: validStyle(),
    ...overrides,
  };
}

function validConfig(overrides = {}) {
  return {
    boardId: '123',
    peopleColumnId: 'people_y',
    buttons: [validButton()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Auth sweep (spec §15.10)
// ---------------------------------------------------------------------------

const ROUTES = [
  { method: 'get', path: '/api/state' },
  { method: 'put', path: '/api/config' },
  { method: 'post', path: '/api/secret/rotate' },
];

describe('admin API auth (spec §15.10)', () => {
  it.each(ROUTES)(
    'responds 401 invalid_session_token to $method $path without an Authorization header',
    async ({ method, path }) => {
      const { app } = makeHarness();

      const res = await request(app)[method](path);

      expect(res.status).toBe(401);
      expect(res.body).toStrictEqual({ error: 'invalid_session_token' });
    }
  );

  it.each(ROUTES)(
    'responds 403 forbidden_account to $method $path for a session token from another account',
    async ({ method, path }) => {
      const { app } = makeHarness();

      const res = await request(app)
        [method](path)
        .set('Authorization', authHeader({ accountId: 888 }));

      expect(res.status).toBe(403);
      expect(res.body).toStrictEqual({ error: 'forbidden_account' });
    }
  );
});

// ---------------------------------------------------------------------------
// V6 route deletion (D2/D4) — the retired surfaces must be GONE
// ---------------------------------------------------------------------------

describe('V6 deleted routes answer 404', () => {
  it.each([
    ['get', '/confirm?itemId=1&a=777&k=x&btn=b_x'],
    ['post', '/confirm'],
    ['head', '/confirm'],
    ['get', '/api/snippet?btn=b_done0001'],
    ['get', '/api/email-template?tpl=t_x'],
  ])('%s %s no longer exists', async (method, path) => {
    const { app } = makeHarness();
    const res = await request(app)[method](path).set('Authorization', authHeader());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/state', () => {
  it('returns null config/secret, disconnected oauth, and the base URL on a fresh app WITHOUT calling fetchMe', async () => {
    const { app, api } = makeHarness();

    const res = await request(app).get('/api/state').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      config: null,
      secret: null,
      oauth: { status: 'disconnected' },
      baseUrl: 'https://app.example',
    });
    expect(api.fetchMe).not.toHaveBeenCalled();
  });

  it("masks the SESSION account's stored secret as exactly **** plus its last 4 characters", async () => {
    const { app } = makeHarness({ seed: { [scoped('link_secret')]: 'abcdefgh1234' } });

    const res = await request(app).get('/api/state').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      config: null,
      secret: '****1234',
      oauth: { status: 'disconnected' },
      baseUrl: 'https://app.example',
    });
  });

  it("reports oauth connected with the live identity name when the SESSION account's token is stored and fetchMe succeeds", async () => {
    const { app, api } = makeHarness({ seed: { [scoped('oauth_token')]: 'tok-live' } });
    api.fetchMe.mockResolvedValue({ id: '9', name: 'דנה' });

    const res = await request(app).get('/api/state').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      config: null,
      secret: null,
      oauth: { status: 'connected', name: 'דנה' },
      baseUrl: 'https://app.example',
    });
    expect(api.fetchMe).toHaveBeenCalledWith({ token: 'tok-live' });
  });

  it('reports oauth broken when a token is stored but fetchMe throws an unauthorized MondayApiError (spec §15.9)', async () => {
    const { app, api } = makeHarness({ seed: { [scoped('oauth_token')]: 'tok-revoked' } });
    api.fetchMe.mockRejectedValue(new MondayApiError('x', { status: 401, unauthorized: true }));

    const res = await request(app).get('/api/state').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      config: null,
      secret: null,
      oauth: { status: 'broken' },
      baseUrl: 'https://app.example',
    });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/config — contract (admin-api.js module header)
// ---------------------------------------------------------------------------

describe('PUT /api/config (v6 shape, v3 scoping)', () => {
  it("accepts a full config, generates b_ ids for id-less entries, echoes the normalized config, and persists it identically under the SESSION account's key (targetIndex 0 stays 0)", async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send({
        boardId: '123',
        peopleColumnId: 'people_y',
        buttons: [
          {
            id: 'b_done0001',
            name: 'סמן כבוצע',
            statusColumnId: 'color_x',
            targetIndex: 0,
            targetLabel: 'בוצע',
            style: { color: '#00c875', icon: '✓', size: 'md' },
          },
          {
            // no id — the SERVER must generate one
            name: 'דחייה',
            statusColumnId: 'color_x',
            targetIndex: 3,
            targetLabel: 'נדחה',
            style: { color: '#e2445c', size: 'sm' }, // icon omitted → defaults to ''
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      ok: true,
      config: {
        boardId: '123',
        peopleColumnId: 'people_y',
        buttons: [
          {
            id: 'b_done0001',
            name: 'סמן כבוצע',
            statusColumnId: 'color_x',
            targetIndex: 0,
            targetLabel: 'בוצע',
            style: { color: '#00c875', icon: '✓', size: 'md' },
          },
          {
            id: expect.stringMatching(BUTTON_ID),
            name: 'דחייה',
            statusColumnId: 'color_x',
            targetIndex: 3,
            targetLabel: 'נדחה',
            style: { color: '#e2445c', icon: '', size: 'sm' },
          },
        ],
        // v4: a config sent without a digest block normalizes to digest: null
        // (the digest contract itself is pinned in admin-api-digest.test.js).
        digest: null,
      },
    });
    // Generated id must not collide with the pre-generated one.
    expect(res.body.config.buttons[1].id).not.toBe('b_done0001');
    // 0 is a REAL label id — it must survive as the number 0, never dropped.
    expect(res.body.config.buttons[0].targetIndex).toBe(0);
    // The backend copy deep-equals the response config (client re-syncs from
    // it) — persisted under the SESSION account's namespace, not the bare key.
    expect(await backend.get(scoped('config'))).toStrictEqual(res.body.config);
    expect(await backend.get('config')).toBeNull();
  });

  it('silently ignores a legacy `templates` field: 200, and the normalized config carries NO templates key', async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send(
        validConfig({
          templates: [{ id: 't_remind001', name: 'ישן', blocks: [{ type: 'buttons', buttonIds: ['b_done0001'] }] }],
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.config).not.toHaveProperty('templates');
    expect(await backend.get(scoped('config'))).not.toHaveProperty('templates');
  });

  const INVALID_CASES = [
    {
      name: 'boardId that is not all digits',
      body: validConfig({ boardId: 'abc' }),
      field: 'boardId',
    },
    {
      name: 'numeric peopleColumnId (must be a non-empty string or null)',
      body: validConfig({ peopleColumnId: 7 }),
      field: 'peopleColumnId',
    },
    {
      name: 'missing buttons array',
      body: omit(validConfig(), 'buttons'),
      field: 'buttons',
    },
    {
      name: 'empty buttons array',
      body: validConfig({ buttons: [] }),
      field: 'buttons',
    },
    {
      name: 'buttons array with 21 entries (max 20)',
      body: validConfig({
        buttons: Array.from({ length: 21 }, (_, i) =>
          validButton({ id: `b_x${String(i).padStart(4, '0')}` })
        ),
      }),
      field: 'buttons',
    },
    {
      name: 'button with an empty name',
      body: validConfig({ buttons: [validButton({ name: '' })] }),
      field: 'name',
    },
    {
      name: 'button with a 41-char name (max 40)',
      body: validConfig({ buttons: [validButton({ name: 'x'.repeat(41) })] }),
      field: 'name',
    },
    {
      name: 'button missing statusColumnId',
      body: validConfig({ buttons: [omit(validButton(), 'statusColumnId')] }),
      field: 'statusColumnId',
    },
    {
      name: 'button targetIndex given as the string "1" instead of a number',
      body: validConfig({ buttons: [validButton({ targetIndex: '1' })] }),
      field: 'targetIndex',
    },
    {
      name: 'button with a negative targetIndex',
      body: validConfig({ buttons: [validButton({ targetIndex: -1 })] }),
      field: 'targetIndex',
    },
    {
      name: 'button missing targetIndex',
      body: validConfig({ buttons: [omit(validButton(), 'targetIndex')] }),
      field: 'targetIndex',
    },
    {
      name: 'button missing targetLabel',
      body: validConfig({ buttons: [omit(validButton(), 'targetLabel')] }),
      field: 'targetLabel',
    },
    {
      name: 'button style.color "green" (not #rrggbb)',
      body: validConfig({ buttons: [validButton({ style: validStyle({ color: 'green' }) })] }),
      field: 'style.color',
    },
    {
      name: 'button style.color "#12345" (5 hex digits)',
      body: validConfig({ buttons: [validButton({ style: validStyle({ color: '#12345' }) })] }),
      field: 'style.color',
    },
    {
      name: 'button style missing color',
      body: validConfig({ buttons: [validButton({ style: omit(validStyle(), 'color') })] }),
      field: 'style.color',
    },
    {
      name: 'button style.size "xl" (not sm|md|lg)',
      body: validConfig({ buttons: [validButton({ style: validStyle({ size: 'xl' }) })] }),
      field: 'style.size',
    },
    {
      name: 'button style.icon of 5 chars (max 4)',
      body: validConfig({ buttons: [validButton({ style: validStyle({ icon: 'abcde' }) })] }),
      field: 'style.icon',
    },
    {
      name: 'two buttons sharing the same id',
      body: validConfig({
        buttons: [validButton(), validButton({ name: 'אחר' })],
      }),
      field: 'buttons',
    },
    {
      name: 'button with a provided id "bad-id" that breaks the b_ pattern',
      body: validConfig({ buttons: [validButton({ id: 'bad-id' })] }),
      field: 'id',
    },
  ];

  it.each(INVALID_CASES)(
    'rejects $name with 400 invalid_config naming field "$field" and persists nothing',
    async ({ body, field }) => {
      const { app, backend } = makeHarness();

      const res = await request(app)
        .put('/api/config')
        .set('Authorization', authHeader())
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: 'invalid_config', field });
      expect(await backend.get(scoped('config'))).toBeNull();
    }
  );
});

describe('POST /api/secret/rotate', () => {
  it("persists a 43-char base64url secret under the SESSION account's link_secret key but returns only { ok: true } (V6: secret is write-only)", async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ ok: true });
    const stored = await backend.get(scoped('link_secret'));
    expect(stored).toMatch(BASE64URL_43);
    expect(await backend.get('link_secret')).toBeNull();
  });

  it('returns a DIFFERENT secret on a second rotation and overwrites the stored one (spec §15.6)', async () => {
    const { app, backend } = makeHarness();

    await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());
    const firstStored = await backend.get(scoped('link_secret'));
    const second = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());

    expect(second.status).toBe(200);
    expect(second.body).toStrictEqual({ ok: true });
    const secondStored = await backend.get(scoped('link_secret'));
    expect(secondStored).toMatch(BASE64URL_43);
    expect(secondStored).not.toBe(firstStored);
  });
});

// ---------------------------------------------------------------------------
// v3 per-session account scoping — isolation invariants
// ---------------------------------------------------------------------------

describe('per-session account scoping (v3 isolation)', () => {
  const TWO_ACCOUNT_ENV = { ...ENV, allowedAccountIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] };

  it("account 777's PUT /api/config is INVISIBLE in account 888's GET /api/state and visible in its own", async () => {
    const { app } = makeHarness({ env: TWO_ACCOUNT_ENV });

    const put = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader({ accountId: 777 }))
      .send(validConfig());
    expect(put.status).toBe(200);

    const stateB = await request(app)
      .get('/api/state')
      .set('Authorization', authHeader({ accountId: 888 }));
    expect(stateB.status).toBe(200);
    expect(stateB.body).toStrictEqual({
      config: null,
      secret: null,
      oauth: { status: 'disconnected' },
      baseUrl: 'https://app.example',
    });

    const stateA = await request(app)
      .get('/api/state')
      .set('Authorization', authHeader({ accountId: 777 }));
    expect(stateA.body.config).toStrictEqual(put.body.config);
  });

  it("account 777's rotated secret lands under its OWN scoped key, stays null for account 888, and never leaks into 888's state mask", async () => {
    const { app, backend } = makeHarness({ env: TWO_ACCOUNT_ENV });

    const rotate = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader({ accountId: 777 }));
    expect(rotate.status).toBe(200);
    expect(rotate.body).toStrictEqual({ ok: true });

    const storedSecret = await backend.get(scoped('link_secret', ACCOUNT_ID));
    expect(storedSecret).toMatch(BASE64URL_43);
    expect(await backend.get(scoped('link_secret', OTHER_ACCOUNT_ID))).toBeNull();

    const stateB = await request(app)
      .get('/api/state')
      .set('Authorization', authHeader({ accountId: 888 }));
    expect(stateB.body.secret).toBeNull();
  });
});
