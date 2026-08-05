// TDD — POST /api/digest/run-scheduled (round348, owner decisions 2026-08-05).
//
// The button the admin screen was missing: run the scheduled action by hand.
// It differs from `/api/digest/send` in exactly one way that matters — it also
// produces the per-employee CSV report (§5.2), which until now only a cron tick
// could make.
//
// The decision pinned here is the one most likely to be "improved" later: the
// button RE-SENDS TO EVERYONE, every time. A previously-marked slot must not
// suppress it, because the marker belongs to the cron alone (§4). The test
// seeds a marker covering both recipients and asserts they are mailed anyway —
// flip `skipAlreadySent` to true in the route and this goes red.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-08-05';
const ENV = {
  clientSecret: 'cs-1',
  clientId: 'ci-1',
  allowedAccountIds: [ACCOUNT_ID],
  baseUrl: 'https://app.example',
};

const scoped = (key) => `${ACCOUNT_ID}:${key}`;
const authHeader = () => jwt.sign({ dat: { account_id: 777, user_id: 1 } }, 'cs-1');

function boardItemsDouble() {
  const tasks = [
    {
      id: '9001',
      name: 'גיבוש תכנית עבודה',
      columns: {
        people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
        status_b: { text: 'לא התחיל', statusLabelId: 0, date: null, personIds: [] },
        date_due: { text: '2026-08-01', statusLabelId: null, date: '2026-08-01', personIds: [] },
      },
    },
    {
      id: '9002',
      name: 'תיאום ספק',
      columns: {
        people_t: { text: 'יוסי', statusLabelId: null, date: null, personIds: ['502'] },
        status_b: { text: 'לא התחיל', statusLabelId: 0, date: null, personIds: [] },
        date_due: { text: '2026-08-01', statusLabelId: null, date: '2026-08-01', personIds: [] },
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

function fullConfig() {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: [
      {
        id: 'b_done0001',
        name: 'עדכן: בוצע',
        statusColumnId: 'status_b',
        targetIndex: 1,
        targetLabel: 'בוצע',
        style: { color: '#00854d', icon: '✓', size: 'sm' },
      },
    ],
    digest: {
      usersBoardId: '222',
      usersPeopleColumnId: 'people_u',
      usersEmailColumnId: 'email_u',
      subject: 'המשימות שלך',
      sendHour: 8,
      sections: [
        {
          id: 's_done0001',
          title: 'לסיים:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          buttonId: 'b_done0001',
          includeStatusLabelIds: [0],
        },
      ],
    },
  };
}

function harness({ emailSender, extraSeed = {} } = {}) {
  const backend = createMemoryBackend({
    [scoped('config')]: fullConfig(),
    [scoped('link_secret')]: 'SECRET43',
    [scoped('oauth_token')]: 'tok-1',
    ...extraSeed,
  });
  const storage = createAppStorage({ backend });
  const app = createApp({
    storage,
    api: { fetchMe: vi.fn(), getBoardItems: boardItemsDouble() },
    rateLimiters: { perIp: { allow: () => true }, perAccount: { allow: () => true } },
    env: ENV,
    fetchImpl: vi.fn(),
    todayIso: TODAY,
    emailSender,
  });
  return { app, backend };
}

const post = (app) =>
  request(app).post('/api/digest/run-scheduled').set('Authorization', authHeader());

describe('POST /api/digest/run-scheduled', () => {
  it('answers 409 email_not_configured when no sender is wired', async () => {
    const { app } = harness({ emailSender: undefined });
    const res = await post(app);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_not_configured');
  });

  it('mails the recipients and reports durationMs + reportSent', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'm1' });
    const { app } = harness({
      emailSender: { send },
      extraSeed: { [scoped('google_sender')]: { senderAddress: 'ops@tenant.com' } },
    });

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.email).sort()).toEqual([
      'dana@example.com',
      'yossi@example.com',
    ]);
    expect(typeof res.body.durationMs).toBe('number');
    expect(res.body.reportSent).toBe(true);
  });

  it('sends the CSV report to the tenant OWN mailbox, as an attachment', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'm1' });
    const { app } = harness({
      emailSender: { send },
      extraSeed: { [scoped('google_sender')]: { senderAddress: 'ops@tenant.com' } },
    });

    await post(app);

    const report = send.mock.calls.map((c) => c[0]).find((m) => m.to === 'ops@tenant.com');
    expect(report).toBeDefined();
    expect(report.to).toBe('ops@tenant.com');
    expect(report.subject).toContain('דוח שליחה');
  });

  it('RE-SENDS to everyone even when this slot is already marked', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'm1' });
    // A marker covering both recipients for the slot this run will compute.
    // The cron would skip them; the manual button must not.
    const { app } = harness({
      emailSender: { send },
      extraSeed: {
        [scoped('google_sender')]: { senderAddress: 'ops@tenant.com' },
        [scoped('digest_sent')]: { slot: TODAY, personIds: ['501', '502'] },
      },
    });

    const res = await post(app);

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results.every((r) => r.ok)).toBe(true);
  });

  it('leaves the per-slot marker untouched, so the cron that follows still delivers', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'm1' });
    const { app, backend } = harness({
      emailSender: { send },
      extraSeed: { [scoped('google_sender')]: { senderAddress: 'ops@tenant.com' } },
    });

    await post(app);

    // Nothing was written: the marker is the cron's alone (§4).
    expect(await backend.get(scoped('digest_sent'))).toBeFalsy();
  });
});
