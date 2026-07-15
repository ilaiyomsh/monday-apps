// Integration tests for the admin API (contract: src/routes/admin-api.js
// module header). The REAL Express pipeline runs via createApp; auth uses REAL
// JWTs signed with the app client secret; the backend is inspected directly
// for persisted values. Response bodies the contract fixes are asserted with
// deep-equality (every field). v2 covers the multi-button config (server-side
// b_/t_ id generation), GET /api/snippet?btn= and GET /api/email-template?tpl=.
// v3 multi-tenant: every handler operates on the SESSION's account scope
// (storage.forAccount(req.session.accountId), backend keys `${accountId}:…`),
// and rendered hrefs carry a=<the session's accountId>.

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
const TEMPLATE_ID = /^t_[A-Za-z0-9_-]{4,16}$/;

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
    rateLimiter: { allow: () => true },
    env,
    fetchImpl: vi.fn(),
  });
  return { app, backend, api };
}

// ---------------------------------------------------------------------------
// v2 config builders — every call returns fresh objects (no shared mutation).
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

function validTextBlock(overrides = {}) {
  return {
    type: 'text',
    text: 'נא לאשר את המשימה',
    direction: 'rtl',
    font: 'Arial',
    fontSize: 16,
    align: 'right',
    ...overrides,
  };
}

function validButtonsBlock(overrides = {}) {
  return { type: 'buttons', buttonIds: ['b_done0001'], ...overrides };
}

function validTemplate(overrides = {}) {
  return {
    id: 't_remind001',
    name: 'תזכורת דדליין',
    blocks: [validTextBlock(), validButtonsBlock()],
    ...overrides,
  };
}

function validConfig(overrides = {}) {
  return {
    boardId: '123',
    peopleColumnId: 'people_y',
    buttons: [validButton()],
    templates: [validTemplate()],
    ...overrides,
  };
}

// Seedable stored config for the snippet / email-template routes.
const STORED_CONFIG = validConfig();

// ---------------------------------------------------------------------------
// Auth sweep — 5 routes (spec §15.10)
// ---------------------------------------------------------------------------

const ROUTES = [
  { method: 'get', path: '/api/state' },
  { method: 'put', path: '/api/config' },
  { method: 'post', path: '/api/secret/rotate' },
  { method: 'get', path: '/api/snippet' },
  { method: 'get', path: '/api/email-template' },
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
// PUT /api/config — v2 contract (admin-api.js module header)
// ---------------------------------------------------------------------------

describe('PUT /api/config (v2 shape, v3 scoping)', () => {
  it("accepts a full v2 config, generates b_/t_ ids for id-less entries, echoes the normalized config, and persists it identically under the SESSION account's key (targetIndex 0 stays 0)", async () => {
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
        templates: [
          {
            // no id — the SERVER must generate one
            name: 'תזכורת דדליין',
            blocks: [
              {
                type: 'text',
                text: 'נא לאשר את המשימה',
                direction: 'rtl',
                font: 'Arial',
                fontSize: 16,
                align: 'right',
              },
              { type: 'buttons', buttonIds: ['b_done0001'] },
            ],
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
        templates: [
          {
            id: expect.stringMatching(TEMPLATE_ID),
            name: 'תזכורת דדליין',
            blocks: [
              {
                type: 'text',
                text: 'נא לאשר את המשימה',
                direction: 'rtl',
                font: 'Arial',
                fontSize: 16,
                align: 'right',
              },
              { type: 'buttons', buttonIds: ['b_done0001'] },
            ],
          },
        ],
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
      body: omit(validConfig({ templates: [] }), 'buttons'),
      field: 'buttons',
    },
    {
      name: 'empty buttons array',
      body: validConfig({ buttons: [], templates: [] }),
      field: 'buttons',
    },
    {
      name: 'buttons array with 21 entries (max 20)',
      body: validConfig({
        buttons: Array.from({ length: 21 }, (_, i) =>
          validButton({ id: `b_x${String(i).padStart(4, '0')}` })
        ),
        templates: [],
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
        templates: [],
      }),
      field: 'buttons',
    },
    {
      name: 'button with a provided id "bad-id" that breaks the b_ pattern',
      body: validConfig({ buttons: [validButton({ id: 'bad-id' })], templates: [] }),
      field: 'id',
    },
    {
      name: 'templates array with 11 entries (max 10)',
      body: validConfig({
        templates: Array.from({ length: 11 }, (_, i) =>
          validTemplate({ id: `t_x${String(i).padStart(4, '0')}` })
        ),
      }),
      field: 'templates',
    },
    {
      name: 'template with an empty name',
      body: validConfig({ templates: [validTemplate({ name: '' })] }),
      field: 'name',
    },
    {
      name: 'template with an empty blocks array',
      body: validConfig({ templates: [validTemplate({ blocks: [] })] }),
      field: 'blocks',
    },
    {
      name: 'template with 31 blocks (max 30)',
      body: validConfig({
        templates: [
          validTemplate({ blocks: Array.from({ length: 31 }, () => validTextBlock()) }),
        ],
      }),
      field: 'blocks',
    },
    {
      name: 'text block with empty text',
      body: validConfig({ templates: [validTemplate({ blocks: [validTextBlock({ text: '' })] })] }),
      field: 'text',
    },
    {
      name: 'text block with 5001-char text (max 5000)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ text: 'א'.repeat(5001) })] })],
      }),
      field: 'text',
    },
    {
      name: 'text block direction "up" (not rtl|ltr)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ direction: 'up' })] })],
      }),
      field: 'direction',
    },
    {
      name: 'text block font "Comic Sans MS" (not in ALLOWED_FONTS)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ font: 'Comic Sans MS' })] })],
      }),
      field: 'font',
    },
    {
      name: 'text block fontSize 9 (below 10)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ fontSize: 9 })] })],
      }),
      field: 'fontSize',
    },
    {
      name: 'text block fontSize 33 (above 32)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ fontSize: 33 })] })],
      }),
      field: 'fontSize',
    },
    {
      name: 'text block fontSize 16.5 (not an integer)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ fontSize: 16.5 })] })],
      }),
      field: 'fontSize',
    },
    {
      name: 'text block align "justify" (not right|center|left)',
      body: validConfig({
        templates: [validTemplate({ blocks: [validTextBlock({ align: 'justify' })] })],
      }),
      field: 'align',
    },
    {
      name: 'buttons block with an empty buttonIds array',
      body: validConfig({
        templates: [validTemplate({ blocks: [validButtonsBlock({ buttonIds: [] })] })],
      }),
      field: 'buttonIds',
    },
    {
      name: 'buttons block referencing an id absent from buttons',
      body: validConfig({
        templates: [
          validTemplate({ blocks: [validButtonsBlock({ buttonIds: ['b_nosuch999'] })] }),
        ],
      }),
      field: 'buttonIds',
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
  it("returns a 43-char base64url secret in full exactly once and persists it under the SESSION account's link_secret key", async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ secret: expect.stringMatching(BASE64URL_43) });
    expect(await backend.get(scoped('link_secret'))).toBe(res.body.secret);
    expect(await backend.get('link_secret')).toBeNull();
  });

  it('returns a DIFFERENT secret on a second rotation and overwrites the stored one (spec §15.6)', async () => {
    const { app, backend } = makeHarness();

    const first = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());
    const second = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());

    expect(second.status).toBe(200);
    expect(second.body.secret).toMatch(BASE64URL_43);
    expect(second.body.secret).not.toBe(first.body.secret);
    expect(await backend.get(scoped('link_secret'))).toBe(second.body.secret);
  });
});

// ---------------------------------------------------------------------------
// GET /api/snippet?btn=<id> — v2
// ---------------------------------------------------------------------------

describe('GET /api/snippet (v2 shape, v3 a= param)', () => {
  const SECRET = 'SEC_abc12345_zzzz';

  it('responds 400 when the btn query param is missing, even with secret and config stored', async () => {
    const { app } = makeHarness({
      seed: { [scoped('link_secret')]: SECRET, [scoped('config')]: STORED_CONFIG },
    });

    const res = await request(app).get('/api/snippet').set('Authorization', authHeader());

    expect(res.status).toBe(400);
  });

  it('responds 404 for a btn id that does not exist in the stored config', async () => {
    const { app } = makeHarness({
      seed: { [scoped('link_secret')]: SECRET, [scoped('config')]: STORED_CONFIG },
    });

    const res = await request(app)
      .get('/api/snippet?btn=b_nosuch999')
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
  });

  it("responds 409 no_secret when the SESSION account has no link secret, even for a known button", async () => {
    const { app } = makeHarness({ seed: { [scoped('config')]: STORED_CONFIG } });

    const res = await request(app)
      .get('/api/snippet?btn=b_done0001')
      .set('Authorization', authHeader());

    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: 'no_secret' });
  });

  it("renders the button snippet whose confirm URL carries a=<the session's accountId> in the pinned order (itemId, a, k, btn) plus the button name", async () => {
    const { app } = makeHarness({
      seed: { [scoped('link_secret')]: SECRET, [scoped('config')]: STORED_CONFIG },
    });

    const res = await request(app)
      .get('/api/snippet?btn=b_done0001')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ snippet: expect.any(String) });
    expect(res.body.snippet).toContain(
      `https://app.example/confirm?itemId={ITEM_ID}&amp;a=${ACCOUNT_ID}&amp;k=${SECRET}&amp;btn=b_done0001`
    );
    expect(res.body.snippet).toContain('סמן כבוצע');
  });
});

// ---------------------------------------------------------------------------
// GET /api/email-template?tpl=<id> — v2
// ---------------------------------------------------------------------------

describe('GET /api/email-template (v2 shape, v3 a= param)', () => {
  const SECRET = 'SEC_abc12345_zzzz';

  it('responds 400 when the tpl query param is missing, even with secret and config stored', async () => {
    const { app } = makeHarness({
      seed: { [scoped('link_secret')]: SECRET, [scoped('config')]: STORED_CONFIG },
    });

    const res = await request(app)
      .get('/api/email-template')
      .set('Authorization', authHeader());

    expect(res.status).toBe(400);
  });

  it('responds 404 for a tpl id that does not exist in the stored config', async () => {
    const { app } = makeHarness({
      seed: { [scoped('link_secret')]: SECRET, [scoped('config')]: STORED_CONFIG },
    });

    const res = await request(app)
      .get('/api/email-template?tpl=t_nosuch999')
      .set('Authorization', authHeader());

    expect(res.status).toBe(404);
  });

  it("responds 409 no_secret when the SESSION account has no link secret, even for a known template", async () => {
    const { app } = makeHarness({ seed: { [scoped('config')]: STORED_CONFIG } });

    const res = await request(app)
      .get('/api/email-template?tpl=t_remind001')
      .set('Authorization', authHeader());

    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: 'no_secret' });
  });

  it("renders the full email HTML whose button href carries a=<the session's accountId>, plus the text block content and the literal {ITEM_ID}", async () => {
    const { app } = makeHarness({
      seed: { [scoped('link_secret')]: SECRET, [scoped('config')]: STORED_CONFIG },
    });

    const res = await request(app)
      .get('/api/email-template?tpl=t_remind001')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ html: expect.any(String) });
    expect(res.body.html).toContain('נא לאשר את המשימה');
    expect(res.body.html).toContain(
      `https://app.example/confirm?itemId={ITEM_ID}&amp;a=${ACCOUNT_ID}&amp;k=${SECRET}&amp;btn=b_done0001`
    );
    expect(res.body.html).toContain('{ITEM_ID}');
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

    expect(await backend.get(scoped('link_secret', ACCOUNT_ID))).toBe(rotate.body.secret);
    expect(await backend.get(scoped('link_secret', OTHER_ACCOUNT_ID))).toBeNull();

    const stateB = await request(app)
      .get('/api/state')
      .set('Authorization', authHeader({ accountId: 888 }));
    expect(stateB.body.secret).toBeNull();
  });

  it("account 888's session renders ITS OWN a= in the snippet href, from ITS OWN stored secret/config", async () => {
    const SECRET_B = 'SEC_of_888_only_x';
    const { app } = makeHarness({
      env: TWO_ACCOUNT_ENV,
      seed: {
        [scoped('link_secret', OTHER_ACCOUNT_ID)]: SECRET_B,
        [scoped('config', OTHER_ACCOUNT_ID)]: STORED_CONFIG,
      },
    });

    const res = await request(app)
      .get('/api/snippet?btn=b_done0001')
      .set('Authorization', authHeader({ accountId: 888 }));

    expect(res.status).toBe(200);
    expect(res.body.snippet).toContain(
      `https://app.example/confirm?itemId={ITEM_ID}&amp;a=${OTHER_ACCOUNT_ID}&amp;k=${SECRET_B}&amp;btn=b_done0001`
    );
  });
});
