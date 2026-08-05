// TDD — how long a tick actually takes (docs/scheduling.md §7.3).
//
// The job as stored kills a tick at 300 seconds and retries it up to 3 times
// (§2). Whether 300s is enough was an OPEN question with no way to answer it:
// the send loop is serial — two board reads, then one SMTP connection per
// recipient in an `await` loop — and nothing anywhere recorded how long that
// took. A proposal to "measure it from the logs" is empty while the logs carry
// no timing, so the run's wall time is now part of both the log line and the
// tick response (`scheduler:run` prints the response, so one manual tick
// answers the question).
//
// The number is per TENANT on purpose: everything else in a tick is a cached
// config read, so the tenant runs are the tick, and a per-tenant figure also
// says WHICH tenant is the slow one.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { createRateLimiter } from '../src/helpers/rate-limit.js';
import { addSink } from '../src/helpers/logger.js';

const ACCOUNT_A = '111';
const ACCOUNT_B = '222';
const TODAY = '2026-07-19';
const BASE = new Date('2026-07-19T08:05:00+03:00').getTime(); // hour 8 Jerusalem
const STEP_MS = 750;

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
              status_a: { text: 'טרם', statusLabelId: 0, date: null, personIds: [] },
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

/**
 * A clock that moves STEP_MS on every read. The scheduler reads it once for the
 * hour and then once on each side of a tenant's run, and it hands the RUN a
 * frozen clock (the slot must not drift mid-run), so a tenant's measured
 * duration is exactly one step — an exact number, not "greater than zero".
 */
function steppingClock() {
  let reads = 0;
  return () => new Date(BASE + STEP_MS * reads++);
}

async function harness({ allowedAccountIds = [ACCOUNT_A], configs = { [ACCOUNT_A]: fullConfig(8) } } = {}) {
  const storage = createAppStorage({ backend: createMemoryBackend() });
  for (const [id, cfg] of Object.entries(configs)) {
    if (!cfg) continue;
    const scoped = storage.forAccount(id);
    await scoped.setConfig(cfg);
    await scoped.setLinkSecret('s'.repeat(32));
    await scoped.setOauthToken('tok');
  }
  const app = createApp({
    storage,
    api: { getBoardItems: boardItemsDouble() },
    rateLimiters: { perIp: createRateLimiter({ capacity: 120 }), perAccount: createRateLimiter() },
    env: {
      clientId: 'cid',
      clientSecret: 'cs',
      allowedAccountIds,
      baseUrl: 'https://app.example',
      operatorEmail: null,
    },
    emailSender: { send: vi.fn().mockResolvedValue({ id: 'em' }) },
    todayIso: TODAY,
    now: steppingClock(),
  });
  return { app };
}

describe('cron tick — run duration', () => {
  it('reports the wall time of a tenant run in the tick response', async () => {
    const { app } = await harness();
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.tenants[0].durationMs).toBe(STEP_MS);
  });

  it('times every due tenant separately, so the slow one is identifiable', async () => {
    const { app } = await harness({
      allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
      configs: { [ACCOUNT_A]: fullConfig(8), [ACCOUNT_B]: fullConfig(8) },
    });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.tenants.map((t) => t.durationMs)).toEqual([STEP_MS, STEP_MS]);
  });

  it('logs the duration per tenant, with the recipient count that explains it', async () => {
    const records = [];
    const unsubscribe = addSink((record) => records.push(record));
    try {
      const { app } = await harness();
      await request(app).post('/mndy-cronjob/digest-send');
      const line = records.find((r) => r.message === 'tenant run finished');
      expect(line).toBeTruthy();
      expect(line.context).toMatchObject({
        accountId: ACCOUNT_A,
        durationMs: STEP_MS,
        recipients: 1,
      });
    } finally {
      unsubscribe();
    }
  });

  it('leaves a tenant that never ran untimed — no run, no number to report', async () => {
    const { app } = await harness({ configs: { [ACCOUNT_A]: null } });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.tenants).toEqual([{ accountId: ACCOUNT_A, skip: 'digest_not_configured' }]);
  });

  it('does not freeze the run clock to the duration measurement — the slot still comes from the tick', async () => {
    // The run receives a FROZEN clock (`() => clock`) so every recipient in one
    // run signs the same slot. If the measurement calls leaked into the run, a
    // long batch could straddle a slot boundary and sign two different slots.
    const { app } = await harness();
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.tenants[0].slot).toBe('20260719');
    expect(res.body.hour).toBe(8);
  });
});
