// The cron tick runs a tenant at its EXACT sendHour and at no other hour
// (owner decision 2026-08-06 — reverses §7.4's catch-up, round348).
//
// WHY THE REVERSAL. Catch-up made every tick from sendHour to midnight
// re-attempt the tenant, with the per-slot marker keeping it safe. It was safe,
// and it was also noisy in a way the owner did not want: someone who became
// eligible AFTER the scheduled hour (a users-board row filled in, a task's date
// or status changed, a recipient-gate label flipped) got a digest an hour or two
// later, and every such tick mailed the operator another summary + CSV. Measured
// in production 2026-08-06: a 10:00 tick sent 4, and the 11:00 catch-up sent 1
// more and reported again. The owner's rule is simpler — the digest is a
// once-a-day event at a known hour, and whoever joined late waits for tomorrow.
//
// What this costs, stated plainly: a tick that never fires for a tenant's hour
// (platform hiccup, §7.1 stream-isolation surprise) costs that tenant the day
// again, recoverable only by the admin screen's resend. The platform's own retry
// (maxRetries 3, 60s backoff — §2) still covers a tick that FAILED; it is a tick
// that never ran at all that is now unrecoverable, as it was before round348.
//
// The per-slot marker (skipAlreadySent) stays exactly as it was: it is what makes
// the platform's retries safe, which is a different problem from catch-up.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { createRateLimiter } from '../src/helpers/rate-limit.js';

const ACCOUNT_A = '111';
const TODAY = '2026-07-19';
const HOUR_7 = new Date('2026-07-19T07:05:00+03:00'); // before sendHour 8
const HOUR_8 = new Date('2026-07-19T08:05:00+03:00'); // the tenant's own hour
const HOUR_10 = new Date('2026-07-19T10:05:00+03:00'); // sendHour 8 already passed
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

describe('cron tick — the hour gate is an EXACT match', () => {
  it('does NOT run a tenant configured for hour 8 when the tick fires at hour 10', async () => {
    const { app, send } = await harness({ now: HOUR_10 });

    const res = await tick(app);

    expect(res.status).toBe(200);
    expect(res.body.hour).toBe(10);
    // Not "ran and sent nobody" — not listed at all. A tenant whose hour is not
    // now is silent: no board reads, no summary audience, no report.
    expect(res.body.tenants.find((t) => t.accountId === ACCOUNT_A)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('runs the tenant at its own hour', async () => {
    const { app, send } = await harness({ now: HOUR_8 });

    const res = await tick(app);

    expect(res.status).toBe(200);
    expect(res.body.hour).toBe(8);
    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ sent: 1, failed: 0, slot: SLOT });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('dana@example.com');
  });

  it('stays silent before the hour arrives, exactly as it always did', async () => {
    const { app, send } = await harness({ now: HOUR_7 });

    const res = await tick(app);

    expect(res.body.hour).toBe(7);
    expect(res.body.tenants.find((t) => t.accountId === ACCOUNT_A)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('someone who becomes eligible after the hour waits for tomorrow — no later tick picks them up', async () => {
    // The production case that prompted the reversal: at the scheduled hour only
    // one person qualified; by hour 10 a second one does. The later tick must not
    // mail them (and must not report).
    const { app, send } = await harness({
      now: HOUR_10,
      marker: { slot: SLOT, personIds: ['501'] }, // דנה was mailed at hour 8
      api: { getBoardItems: boardItemsTwoDouble() }, // רון became eligible since
      operatorEmail: 'ops@twyst.co.il',
      senderAddress: 'sender-a@tenant.example',
    });

    const res = await tick(app);

    expect(send).not.toHaveBeenCalled(); // not the digest, not the summary, not the CSV
    expect(res.body.summarySent).toBe(false);
    expect(res.body.reportsSent).toBe(0);
    expect(res.body.tenants.find((t) => t.accountId === ACCOUNT_A)).toBeUndefined();
  });

  it('a tick that missed the hour does NOT recover it later in the day (the accepted cost)', async () => {
    // Nobody was mailed at hour 8 (no marker at all) and the tick fires at 10:
    // the day is simply lost for this tenant. Pinned so the cost is a decision on
    // the record, not a surprise the next time someone reads the hour filter.
    const { app, send } = await harness({ now: HOUR_10 });

    await tick(app);

    expect(send).not.toHaveBeenCalled();
  });

  it('still mails at the scheduled hour whoever a partial earlier run missed', async () => {
    // The marker keeps doing its job WITHIN the hour: a platform retry of a tick
    // that died mid-loop mails only the recipients still uncovered.
    const { app, send } = await harness({
      now: HOUR_8,
      marker: { slot: SLOT, personIds: ['501'] },
      api: { getBoardItems: boardItemsTwoDouble() },
    });

    const res = await tick(app);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('ron@example.com');
    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ sent: 1, failed: 0, alreadySent: 1 });
  });

  it('reports at the scheduled hour even when the marker already covered everyone', async () => {
    // At the tenant's OWN hour the summary is the expected reporting moment —
    // that is the one case §5.1's due-filter must keep answering true for.
    const { app, send } = await harness({
      now: HOUR_8,
      marker: { slot: SLOT, personIds: ['501'] },
      operatorEmail: 'ops@twyst.co.il',
    });

    const res = await tick(app);

    const tenant = res.body.tenants.find((t) => t.accountId === ACCOUNT_A);
    expect(tenant).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(res.body.summarySent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1); // the operator summary only
  });
});
