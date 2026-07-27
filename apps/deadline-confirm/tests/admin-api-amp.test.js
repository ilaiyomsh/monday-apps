// TDD red phase (V5) — GET /api/digest/preview also returns the amp4email part.
//
// The digest is a two-part email: the static `text/html` body (already pinned in
// admin-api-digest.test.js) and the `text/x-amp-html` dynamic-email part Gmail
// renders with checkboxes. The admin panel needs BOTH from one preview call —
// the AMP part is what the operator copies into the AMP playground while the
// sending path is still manual, and later what the sender attaches as a MIME
// part. Same recipient selection rules as `html` (?recipient= or the first).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';
const SECRET = 'SECRET43';
const BASE = 'https://app.example';

const ENV = {
  clientId: 'cid-1',
  clientSecret: 'cs-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: BASE,
  ampAllowedSenders: ['deadline@twyst.co.il'],
};

const scoped = (key) => `${ACCOUNT_ID}:${key}`;
const authHeader = () => jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');

const BUTTONS = [
  {
    id: 'b_start001',
    name: 'עדכן: התחלתי',
    statusColumnId: 'status_a',
    targetIndex: 1,
    targetLabel: 'בעבודה',
    style: { color: '#0073ea', icon: '✓', size: 'sm' },
  },
];

const CONFIG = {
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: BUTTONS,
  templates: [],
  digest: {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'המשימות שלך',
    sections: [
      {
        id: 's_start001',
        title: 'להתחיל:',
        dateColumnId: 'date_start',
        dateColumnTitle: 'תאריך התחלה מתוכנן',
        buttonId: 'b_start001',
        includeStatusLabelIds: [0],
      },
    ],
  },
};

const TASKS = [
  {
    id: '9001',
    name: 'גיבוש תכנית עבודה',
    columns: {
      people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
      date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
      status_a: { text: 'טרם החל', statusLabelId: 0, date: null, personIds: [] },
    },
  },
];

const USERS = [
  {
    id: 'u1',
    name: 'דנה כהן',
    columns: {
      people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
      email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
    },
  },
];

function harness() {
  const backend = createMemoryBackend({
    [scoped('config')]: CONFIG,
    [scoped('link_secret')]: SECRET,
    [scoped('oauth_token')]: 'tok-1',
  });
  const api = {
    fetchMe: vi.fn(),
    getBoardItems: vi.fn(async ({ boardId }) =>
      boardId === '111' ? { items: TASKS, truncated: false } : { items: USERS, truncated: false }
    ),
  };
  return createApp({
    storage: createAppStorage({ backend }),
    api,
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    todayIso: TODAY,
  });
}

const preview = (app, query = '') =>
  request(app).get(`/api/digest/preview${query}`).set('Authorization', authHeader());

describe('GET /api/digest/preview — amp4email part', () => {
  it('returns a complete amp4email document alongside the html body', async () => {
    const res = await preview(harness());

    expect(res.status).toBe(200);
    expect(typeof res.body.html).toBe('string');
    expect(typeof res.body.amp).toBe('string');
    expect(res.body.amp.startsWith('<!doctype html>')).toBe(true);
    expect(res.body.amp).toContain('<html amp4email');
  });

  it('wires the forms to this deployment’s /amp/confirm with the real credentials', async () => {
    const res = await preview(harness());

    expect(res.body.amp).toContain(`action-xhr="${BASE}/amp/confirm"`);
    expect(res.body.amp).toContain(`name="a" value="${ACCOUNT_ID}"`);
    expect(res.body.amp).toContain(`name="k" value="${SECRET}"`);
    expect(res.body.amp).toContain('name="btn" value="b_start001"');
  });

  it('renders a checkbox for each pending task of the previewed recipient', async () => {
    const res = await preview(harness());

    expect(res.body.amp).toContain('name="item" value="9001"');
    expect(res.body.amp).toContain('גיבוש תכנית עבודה');
    expect(res.body.amp).toContain('תאריך התחלה מתוכנן');
  });

  it('keeps the secret out of every URL in the AMP part', async () => {
    const res = await preview(harness());

    expect(res.body.amp).not.toContain('/confirm?itemId=');
    expect(res.body.amp).not.toMatch(new RegExp(`href="[^"]*${SECRET}`));
  });

  it('is null — like html — when the requested recipient has nothing pending', async () => {
    const res = await preview(harness(), '?recipient=nobody@example.com');

    expect(res.status).toBe(200);
    expect(res.body.html).toBeNull();
    expect(res.body.amp).toBeNull();
  });
});
