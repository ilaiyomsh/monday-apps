// TDD — §7.4: catch up a missed cron hour (owner decision 2026-08-05).
//
// Today the hour filter is an exact match (`sendHour !== hour` -> skip). A tick
// that never fires for a tenant's hour (platform hiccup, a retry landing an
// hour late, §7.1's stream-isolation surprise) means that tenant gets nothing
// for the WHOLE day: every later tick that hour also fails the exact match, and
// no tick ever re-checks a past hour. Fix: once a tenant's hour has passed
// today, every later tick is a catch-up candidate. Safety comes from the
// EXISTING per-slot marker (skipAlreadySent, digest-run.js) — a catch-up
// attempt against someone already fully sent mails nobody twice, and must not
// re-appear in the operator summary / CSV report either (that noise is exactly
// what §5.1's due-tenant fix already closed once, for a different cause).

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { createRateLimiter } from '../src/helpers/rate-limit.js';

const ACCOUNT_A = '111';
const TODAY = '2026-07-19';
const HOUR_10 = new Date('2026-07-19T10:05:00+03:00'); // sendHour 8 already passed today
const SLOT = '20260719';

function fullConfig(sendHour = 8) {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: [
      {
        id: 'b_start',
        name: 'עדכן',
        statusColumnId: 'status_a',
        targetIndex: 0,
        targetLabel: 'בעבודה',
        style: { color: '#0073ea' },
      },
    ],
    digest: {
      usersBoardId: '222',
      usersPeopleColumnId: 'people_u',
      usersEmailColumnId: 'email_u',
      subject: 'digest',
      sendHour,
      sections: [
        {
          id: 's_start',
          title: 'להתחיל:',
          dateColumnId: 'date_start',
          dateColumnTitle: 'תאריך',
          buttonId: 'b_start',
          includeStatusLabelIds: [0],
        },
      ],
    },
  };
}

/** One pending recipient: דנה (personId 501). */
function boardItemsDouble() {
  return vi.fn(async ({ boardId }) => {
    if (boardId === '111') {
      return {
        items: [
          {
            id: '9001',
            name: 'משימה',
            columns: {
              people_t: { text: '', statusLabelId: null, date: null, personIds: ['501'] },
              date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
              status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
            },
          },
        ],
        truncated: false,
      };
    }
    return {
      items: [
        {
          id: 'u1',
          name: 'דנה',
          columns: {
            people_u: { text: '', statusLabelId: null, date: null, personIds: ['501'] },
            email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
          },
        },
      ],
      truncated: false,
    };
  });
}

/** Two pending recipients: דנה (501) and רון (502). */
function boardItemsTwoDouble() {
  return vi.fn(async ({ boardId }) => {
    if (boardId === '111') {
      return {
        items: [
          {
            id: '9001',
            name: 'משימה 1',
            columns: {
              people_t: { text: '', statusLabelId: null, date: null, personIds: ['501'] },
              date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
              status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
            },
          },
          {
            id: '9002',
            name: 'משימה 2',
            columns: {
              people_t: { text: '', statusLabelId: null, date: null, personIds: ['502'] },
              date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
              status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
            },
          },
        ],
        truncated: false,
      };
    }
    return {
      items: [
        {
          id: 'u1',
          name: 'דנה',
          columns: {
            people_u: { text: '', statusLabelId: null, date: null, personIds: ['501'] },
            email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
          },
        },
        {
          id: 'u2',
          name: 'רון',
          columns: {
            people_u: { text: '', statusLabelId: null, date: null, personIds: ['502'] },
            email_u: { text: 'ron@example.com', statusLabelId: null, date: null, personIds: [] },
          },
        },
      ],
      truncated: false,
    };
  });
}

async function harness({
  now = HOUR_10,
  marker,
  operatorEmail = null,
  senderAddress,
  api = { getBoardItems: boardItemsDouble() },
} = {}) {
  const seed = {};
  if (marker) seed[`${ACCOUNT_A}:digest_sent`] = marker;
  const storage = createAppStorage({ backend: createMemoryBackend(seed) });
  const scoped = storage.forAccount(ACCOUNT_A);
  await scoped.setConfig(fullConfig(8));
  await scoped.setLinkSecret('s'.repeat(32));
  await scoped.setOauthToken('tok');
  if (senderAddress) {
    await scoped.setGoogleSender({
      senderAddress,
      refreshToken: 'r',
      accessToken: 'a',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'https://mail.google.com/',
    });
  }
  const send = vi.fn().mockResolvedValue({ id: 'em' });
  const app = createApp({
    storage,
    api,
    rateLimiters: { perIp: createRateLimiter({ capacity: 120 }), perAccount: createRateLimiter() },
    env: {
      clientId: 'cid',
      clientSecret: 'cs',
      allowedAccountIds: [ACCOUNT_A],
      baseUrl: 'https://app.example',
      operatorEmail,
    },
    emailSender: { send },
    todayIso: TODAY,
    now: () => now,
  });
  return { app, send, storage };
}

const tick = (app) => request(app).post('/mndy-cronjob/digest-send');

describe('cron tick — §7.4 catch-up for a missed hour', () => {
  it('sends the digest at hour 10 for a tenant configured for hour 8 whose tick never ran', async () => {
    const { app, send } = await harness({ now: HOUR_10 });

    const res = await tick(app);

    expect(res.status).toBe(200);
    expect(res.body.hour).toBe(10);
    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ sent: 1, failed: 0, slot: SLOT });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('dana@example.com');
  });

  it('does not re-mail a tenant already fully sent earlier today — the marker makes catch-up safe', async () => {
    const { app, send } = await harness({
      now: HOUR_10,
      marker: { slot: SLOT, personIds: ['501'] }, // דנה already got it, e.g. at hour 8
    });

    const res = await tick(app);

    expect(res.status).toBe(200);
    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ sent: 0, failed: 0, alreadySent: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a fully-caught-up tenant OUT of the operator summary — no hourly "nothing to do" noise', async () => {
    const { app, send } = await harness({
      now: HOUR_10,
      marker: { slot: SLOT, personIds: ['501'] },
      operatorEmail: 'ops@twyst.co.il',
    });

    const res = await tick(app);

    // The tick DID attempt this tenant (proves catch-up ran — not "never touched",
    // which would make the assertions below true for a reason that has nothing to
    // do with the noise fix).
    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ alreadySent: 1 });
    // ...but nothing NEW happened this tick, so no operator summary either.
    expect(res.body.summarySent).toBe(false);
    expect(send).not.toHaveBeenCalled(); // neither the digest nor the operator summary
  });

  it('sends no per-employee CSV report for a catch-up tick that found nothing new', async () => {
    const { app, send } = await harness({
      now: HOUR_10,
      marker: { slot: SLOT, personIds: ['501'] },
      senderAddress: 'sender-a@tenant.example',
    });

    const res = await tick(app);

    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ alreadySent: 1 });
    expect(res.body.reportsSent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('catches up a PARTIAL prior run — mails only whoever the marker does not already cover', async () => {
    // A tick that died mid-loop at the scheduled hour (digest-run.js writes the
    // marker after EVERY successful send, not once at the end) leaves exactly
    // this shape: one recipient already covered, one not.
    const { app, send } = await harness({
      now: HOUR_10,
      marker: { slot: SLOT, personIds: ['501'] },
      api: { getBoardItems: boardItemsTwoDouble() },
    });

    const res = await tick(app);

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('ron@example.com');
    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ sent: 1, failed: 0, alreadySent: 1 });
  });
});
