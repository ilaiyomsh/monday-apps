// v4 digest admin API — config validation extension (digest block) +
// GET /api/digest/preview + POST /api/digest/send. REAL Express pipeline via
// createApp; auth = real JWTs; api.getBoardItems + emailSender are injected
// doubles. Contract pinned here; see src/routes/admin-api.js header.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { MondayApiError } from '../src/services/monday-api.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};

const scoped = (key) => `${ACCOUNT_ID}:${key}`;

function authHeader() {
  return jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');
}

function buttons() {
  return [
    {
      id: 'b_start001',
      name: 'עדכן: התחלתי',
      statusColumnId: 'status_a',
      targetIndex: 0,
      targetLabel: 'בעבודה',
      style: { color: '#0073ea', icon: '✓', size: 'sm' },
    },
    {
      id: 'b_done0001',
      name: 'עדכן: בוצע',
      statusColumnId: 'status_b',
      targetIndex: 1,
      targetLabel: 'בוצע',
      style: { color: '#00854d', icon: '✓', size: 'sm' },
    },
  ];
}

function digestBlock(overrides = {}) {
  return {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'המשימות שלך — נדרש עדכון',
    sections: [
      { id: 's_start001', title: 'להתחיל:', dateColumnId: 'date_start', dateColumnTitle: 'תאריך התחלה', buttonId: 'b_start001', includeStatusLabelIds: [0] },
      { id: 's_done0001', title: 'לסיים:', dateColumnId: 'date_due', dateColumnTitle: 'תאריך סיום', buttonId: 'b_done0001', includeStatusLabelIds: [0] },
    ],
    ...overrides,
  };
}

function fullConfig(overrides = {}) {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: buttons(),
    digest: digestBlock(),
    ...overrides,
  };
}

/** Normalized users-board / tasks-board items the getBoardItems double serves. */
function boardItemsDouble() {
  const tasks = [
    {
      id: '9001',
      name: 'גיבוש תכנית עבודה',
      columns: {
        people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
        date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
        status_a: { text: 'בעבודה', statusLabelId: 0, date: null, personIds: [] },
        date_due: { text: '', statusLabelId: null, date: null, personIds: [] },
        status_b: { text: '', statusLabelId: null, date: null, personIds: [] },
      },
    },
    {
      id: '9002',
      name: 'הגשת דוח',
      columns: {
        people_t: { text: 'יוסי', statusLabelId: null, date: null, personIds: ['502'] },
        date_start: { text: '', statusLabelId: null, date: null, personIds: [] },
        status_a: { text: '', statusLabelId: null, date: null, personIds: [] },
        date_due: { text: '', statusLabelId: null, date: '2026-07-01', personIds: [] },
        status_b: { text: 'בעבודה', statusLabelId: 0, date: null, personIds: [] },
      },
    },
  ];
  const users = [
    {
      id: 'u1',
      name: 'דנה כהן',
      columns: {
        people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
        email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
      },
    },
    {
      id: 'u2',
      name: 'יוסי לוי',
      columns: {
        people_u: { text: 'יוסי', statusLabelId: null, date: null, personIds: ['502'] },
        email_u: { text: 'yossi@example.com', statusLabelId: null, date: null, personIds: [] },
      },
    },
  ];
  return vi.fn(async ({ boardId }) => {
    if (boardId === '111') return { items: tasks, truncated: false };
    if (boardId === '222') return { items: users, truncated: false };
    throw new Error(`unexpected boardId ${boardId}`);
  });
}

function makeHarness({ seed = {}, emailSender, getBoardItems } = {}) {
  const backend = createMemoryBackend(seed);
  const storage = createAppStorage({ backend });
  const api = { fetchMe: vi.fn(), getBoardItems: getBoardItems ?? boardItemsDouble() };
  const app = createApp({
    storage,
    api,
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    todayIso: TODAY,
    emailSender,
  });
  return { app, backend, api };
}

function seededHarness(opts = {}) {
  return makeHarness({
    seed: {
      [scoped('config')]: fullConfig(opts.config ?? {}),
      [scoped('link_secret')]: 'SECRET43',
      [scoped('oauth_token')]: 'tok-1',
      ...(opts.seed ?? {}),
    },
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// PUT /api/config — digest block validation
// ---------------------------------------------------------------------------

describe('PUT /api/config with digest', () => {
  it('valid digest persists normalized; missing section ids are server-generated (s_…)', async () => {
    const { app, backend } = makeHarness();
    const payload = fullConfig();
    delete payload.digest.sections[0].id;
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.config.digest.sendHour).toBe(8);
    expect(res.body.config.digest.sections[0].id).toMatch(/^s_[A-Za-z0-9_-]{4,16}$/);
    expect(res.body.config.digest.sections[1].id).toBe('s_done0001');
    const stored = await backend.get(scoped('config'));
    expect(stored.digest).toEqual(res.body.config.digest);
  });

  it('sendHour is persisted when explicitly provided', async () => {
    const { app, backend } = makeHarness();
    const payload = fullConfig({ digest: digestBlock({ sendHour: 15 }) });
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.config.digest.sendHour).toBe(15);
    expect((await backend.get(scoped('config'))).digest.sendHour).toBe(15);
  });

  it('config WITHOUT digest stays valid — digest normalized to null (nothing existing breaks)', async () => {
    const { app, backend } = makeHarness();
    const payload = fullConfig();
    delete payload.digest;
    const res = await request(app).put('/api/config').set('Authorization', authHeader()).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.config.digest).toBeNull();
    expect((await backend.get(scoped('config'))).digest).toBeNull();
  });

  it.each([
    ['usersBoardId not digits', { usersBoardId: 'abc' }, 'digest.usersBoardId'],
    ['empty usersPeopleColumnId', { usersPeopleColumnId: '' }, 'digest.usersPeopleColumnId'],
    ['empty usersEmailColumnId', { usersEmailColumnId: '' }, 'digest.usersEmailColumnId'],
    ['missing subject', { subject: '' }, 'digest.subject'],
    ['subject over 120 chars', { subject: 'א'.repeat(121) }, 'digest.subject'],
    ['empty sections', { sections: [] }, 'digest.sections'],
    [
      'unknown buttonId in a section',
      { sections: [{ id: 's_x00001', title: 'א', dateColumnId: 'd', dateColumnTitle: 'ת', buttonId: 'b_nope0001', includeStatusLabelIds: [0] }] },
      'digest.sections',
    ],
    [
      'section missing dateColumnTitle',
      { sections: [{ id: 's_x00001', title: 'א', dateColumnId: 'd', dateColumnTitle: '', buttonId: 'b_start001', includeStatusLabelIds: [0] }] },
      'digest.sections',
    ],
    [
      'section with empty includeStatusLabelIds',
      { sections: [{ id: 's_x00001', title: 'א', dateColumnId: 'd', dateColumnTitle: 'ת', buttonId: 'b_start001', includeStatusLabelIds: [] }] },
      'digest.sections',
    ],
    [
      'section with a non-integer includeStatusLabelId',
      { sections: [{ id: 's_x00001', title: 'א', dateColumnId: 'd', dateColumnTitle: 'ת', buttonId: 'b_start001', includeStatusLabelIds: ['x'] }] },
      'digest.sections',
    ],
    ['sendHour out of range (24)', { sendHour: 24 }, 'digest.sendHour'],
    ['sendHour not an integer', { sendHour: 8.5 }, 'digest.sendHour'],
    ['sendHour negative', { sendHour: -1 }, 'digest.sendHour'],
  ])('invalid digest — %s → 400 naming the field', async (_name, patch, field) => {
    const { app } = makeHarness();
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send(fullConfig({ digest: digestBlock(patch) }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_config', field });
  });

  it('digest present but peopleColumnId null → 400 (matching column is required)', async () => {
    const { app } = makeHarness();
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', authHeader())
      .send(fullConfig({ peopleColumnId: null }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_config', field: 'peopleColumnId' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/digest/preview
// ---------------------------------------------------------------------------

describe('GET /api/digest/preview', () => {
  it('409 digest_not_configured / no_secret / not_connected in that order of absence', async () => {
    const noDigest = seededHarness({ config: { digest: null } });
    let res = await request(noDigest.app).get('/api/digest/preview').set('Authorization', authHeader());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'digest_not_configured' });

    const noSecret = makeHarness({
      seed: { [scoped('config')]: fullConfig(), [scoped('oauth_token')]: 'tok-1' },
    });
    res = await request(noSecret.app).get('/api/digest/preview').set('Authorization', authHeader());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'no_secret' });

    const noToken = makeHarness({
      seed: { [scoped('config')]: fullConfig(), [scoped('link_secret')]: 'SECRET43' },
    });
    res = await request(noToken.app).get('/api/digest/preview').set('Authorization', authHeader());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_connected' });
  });

  it('happy: recipient summaries + first recipient plain text (no credentials); reads BOTH boards', async () => {
    const { app, api } = seededHarness();
    const res = await request(app).get('/api/digest/preview').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.recipients).toEqual([
      { email: 'dana@example.com', name: 'דנה כהן', taskCount: 1 },
      { email: 'yossi@example.com', name: 'יוסי לוי', taskCount: 1 },
    ]);
    expect(res.body.skippedUsers).toEqual([]);
    expect(res.body.truncated).toBe(false);
    expect(res.body.plain).toContain('שלום דנה כהן');
    expect(res.body.plain).toContain('גיבוש תכנית עבודה');
    expect(res.body.plain).not.toContain('/confirm');
    expect(res.body.plain).not.toContain('http');
    expect(res.body).not.toHaveProperty('html');
    const calledBoards = api.getBoardItems.mock.calls.map(([p]) => p.boardId).sort();
    expect(calledBoards).toEqual(['111', '222']);
  });

  it('?recipient=<email> returns THAT recipient plain text', async () => {
    const { app } = seededHarness();
    const res = await request(app)
      .get('/api/digest/preview?recipient=yossi@example.com')
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.plain).toContain('יוסי לוי');
    expect(res.body.plain).toContain('הגשת דוח');
    expect(res.body.plain).not.toContain('/confirm');
  });

  it('monday API failure → 502 monday_api_failed (never a stack)', async () => {
    const { app } = seededHarness({
      getBoardItems: vi.fn().mockRejectedValue(new MondayApiError('boom', { status: 200 })),
    });
    const res = await request(app).get('/api/digest/preview').set('Authorization', authHeader());
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'monday_api_failed' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/digest/send
// ---------------------------------------------------------------------------

describe('POST /api/digest/send', () => {
  it('409 email_not_configured when no sender is wired (V6: the Gmail-send seam is empty)', async () => {
    const { app } = seededHarness({ emailSender: undefined });
    const res = await request(app).post('/api/digest/send').set('Authorization', authHeader());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'email_not_configured' });
  });

  it('happy: one send per recipient with the configured subject; per-recipient results', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em_1' });
    const { app } = seededHarness({ emailSender: { send } });
    const res = await request(app).post('/api/digest/send').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results).toEqual([
      { email: 'dana@example.com', name: 'דנה כהן', taskCount: 1, ok: true },
      { email: 'yossi@example.com', name: 'יוסי לוי', taskCount: 1, ok: true },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [payload] of send.mock.calls) {
      expect(payload.subject).toBe('המשימות שלך — נדרש עדכון');
      expect(payload.html).toContain('/confirm?itemId=');
    }
  });

  it('one failing recipient → its result carries ok:false + error; the OTHER recipient is still sent; overall ok:false', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Invalid `to`'))
      .mockResolvedValueOnce({ id: 'em_2' });
    const { app } = seededHarness({ emailSender: { send } });
    const res = await request(app).post('/api/digest/send').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect(res.body.results[0]).toMatchObject({ email: 'dana@example.com', ok: false });
    expect(res.body.results[0].error).toContain('Invalid');
    expect(res.body.results[1]).toEqual({
      email: 'yossi@example.com',
      name: 'יוסי לוי',
      taskCount: 1,
      ok: true,
    });
  });

  it('no pending tasks → 200 ok with empty results (nothing sent)', async () => {
    const send = vi.fn();
    const emptyBoards = vi.fn(async () => ({ items: [], truncated: false }));
    const { app } = seededHarness({ emailSender: { send }, getBoardItems: emptyBoards });
    const res = await request(app).post('/api/digest/send').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
