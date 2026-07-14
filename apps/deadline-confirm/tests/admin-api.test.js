// Integration tests for the admin API (spec §9, §13, §15.6, §15.9, §15.10).
// The REAL Express pipeline runs via createApp; auth uses REAL JWTs signed
// with the app client secret; the backend is inspected directly for persisted
// values. State responses are asserted with deep-equality (every field).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountId: '777',
  baseUrl: 'https://app.example',
};

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

const VALID_CONFIG = {
  boardId: '123',
  statusColumnId: 'color_x',
  fromIndex: 0,
  fromLabel: 'בעבודה',
  toIndex: 1,
  toLabel: 'בוצע',
  peopleColumnId: 'people_y',
  expiryDateColumnId: null,
  expiryGraceDays: 0,
};

function authHeader({ accountId = 777, userId = 1 } = {}) {
  return jwt.sign({ dat: { account_id: accountId, user_id: userId } }, 'cs-1');
}

function makeHarness({ seed = {} } = {}) {
  const backend = createMemoryBackend(seed);
  const storage = createAppStorage({ backend });
  const api = { fetchMe: vi.fn() };
  const app = createApp({
    storage,
    api,
    rateLimiter: { allow: () => true },
    env: ENV,
    fetchImpl: vi.fn(),
  });
  return { app, backend, api };
}

const ROUTES = [
  { method: 'get', path: '/api/state' },
  { method: 'put', path: '/api/config' },
  { method: 'post', path: '/api/secret/rotate' },
  { method: 'get', path: '/api/snippet' },
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

  it('masks a stored secret as exactly **** plus its last 4 characters', async () => {
    const { app } = makeHarness({ seed: { link_secret: 'abcdefgh1234' } });

    const res = await request(app).get('/api/state').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      config: null,
      secret: '****1234',
      oauth: { status: 'disconnected' },
      baseUrl: 'https://app.example',
    });
  });

  it('reports oauth connected with the live identity name when a token is stored and fetchMe succeeds', async () => {
    const { app, api } = makeHarness({ seed: { oauth_token: 'tok-live' } });
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
    const { app, api } = makeHarness({ seed: { oauth_token: 'tok-revoked' } });
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

describe('PUT /api/config', () => {
  it('accepts a valid config with fromIndex 0 (0 is a real label id), persists it verbatim, and returns ok', async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send(VALID_CONFIG);

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ ok: true });
    expect(await backend.get('config')).toStrictEqual(VALID_CONFIG);
  });

  const INVALID_CASES = [
    {
      name: 'boardId that is not all digits',
      body: { ...VALID_CONFIG, boardId: 'abc' },
      field: 'boardId',
    },
    {
      name: 'missing statusColumnId',
      body: (({ statusColumnId: _omitted, ...rest }) => rest)(VALID_CONFIG),
      field: 'statusColumnId',
    },
    {
      name: 'fromIndex given as the string "0" instead of a number',
      body: { ...VALID_CONFIG, fromIndex: '0' },
      field: 'fromIndex',
    },
    {
      name: 'negative fromIndex',
      body: { ...VALID_CONFIG, fromIndex: -1 },
      field: 'fromIndex',
    },
    {
      name: 'missing toIndex',
      body: (({ toIndex: _omitted, ...rest }) => rest)(VALID_CONFIG),
      field: 'toIndex',
    },
    {
      name: 'missing fromLabel',
      body: (({ fromLabel: _omitted, ...rest }) => rest)(VALID_CONFIG),
      field: 'fromLabel',
    },
    {
      name: 'negative expiryGraceDays',
      body: { ...VALID_CONFIG, expiryGraceDays: -1 },
      field: 'expiryGraceDays',
    },
    {
      name: 'non-integer expiryGraceDays (1.5)',
      body: { ...VALID_CONFIG, expiryGraceDays: 1.5 },
      field: 'expiryGraceDays',
    },
  ];

  it.each(INVALID_CASES)(
    'rejects $name with 400 invalid_config naming the field and persists nothing',
    async ({ body, field }) => {
      const { app, backend } = makeHarness();

      const res = await request(app)
        .put('/api/config')
        .set('Authorization', authHeader())
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: 'invalid_config', field });
      expect(await backend.get('config')).toBeNull();
    }
  );

  it('rejects fromIndex === toIndex with 400 invalid_config naming one of the index fields and persists nothing', async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send({ ...VALID_CONFIG, fromIndex: 1, toIndex: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_config');
    expect(['fromIndex', 'toIndex']).toContain(res.body.field);
    expect(await backend.get('config')).toBeNull();
  });
});

describe('POST /api/secret/rotate', () => {
  it('returns a 43-char base64url secret in full exactly once and persists it as link_secret', async () => {
    const { app, backend } = makeHarness();

    const res = await request(app)
      .post('/api/secret/rotate')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ secret: expect.stringMatching(BASE64URL_43) });
    expect(await backend.get('link_secret')).toBe(res.body.secret);
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
    expect(await backend.get('link_secret')).toBe(second.body.secret);
  });
});

describe('GET /api/snippet', () => {
  it('responds 409 no_secret when no link secret is stored', async () => {
    const { app } = makeHarness();

    const res = await request(app).get('/api/snippet').set('Authorization', authHeader());

    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: 'no_secret' });
  });

  it('renders the snippet with the confirm URL (literal {ITEM_ID}, &amp;, stored secret) and the button label', async () => {
    const seededSecret = 'SEC_abc12345_zzzz';
    const { app } = makeHarness({ seed: { link_secret: seededSecret } });

    const res = await request(app).get('/api/snippet').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.snippet).toContain(
      `https://app.example/confirm?itemId={ITEM_ID}&amp;k=${seededSecret}`
    );
    expect(res.body.snippet).toContain('✓ סמן כבוצע');
  });
});
