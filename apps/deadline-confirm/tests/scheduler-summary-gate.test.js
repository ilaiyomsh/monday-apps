// TDD — the operator summary must fire only for tenants that were actually DUE
// this hour.
//
// Measured 2026-08-05 against the real router: an account in the roster that has
// merely not configured a digest yet is pushed onto the tenant list BEFORE the
// sendHour check, so it counted as "due" on every tick. With the cron now
// registered hourly (`0 * * * *`), that is a summary mail every hour, all day,
// for as long as one account is unconfigured — or, if the first such account has
// no connected mailbox, an hourly failed-send error in the log instead.
//
// The old filter said `!t.skip || t.skip !== 'wrong_hour'`, which is true for
// every possible value: `wrong_hour` is a skip reason NO code produces (the
// not-due branch `continue`s without pushing). It was dead, and the comment
// "Not due this hour — silent (no operator noise)" states the intent it missed.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { createRateLimiter } from '../src/helpers/rate-limit.js';

const CONFIGURED = '111';
const UNCONFIGURED = '999';
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00'); // hour 8 Jerusalem
const OPERATOR = 'ops@twyst.co.il';

const config = (sendHour) => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [
    {
      id: 'b1',
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
        id: 's1',
        title: 'להתחיל:',
        dateColumnId: 'date_start',
        dateColumnTitle: 'תאריך',
        buttonId: 'b1',
        includeStatusLabelIds: [0],
      },
    ],
  },
});

const boardItems = () =>
  vi.fn(async ({ boardId }) =>
    boardId === '111'
      ? {
          items: [
            {
              id: '9001',
              name: 'משימה',
              columns: {
                people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
                date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
                status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
              },
            },
          ],
          truncated: false,
        }
      : {
          items: [
            {
              id: 'u1',
              name: 'דנה',
              columns: {
                people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
                email_u: {
                  text: 'dana@example.com',
                  statusLabelId: null,
                  date: null,
                  personIds: [],
                },
              },
            },
          ],
          truncated: false,
        }
  );

async function harness({ configs, allowedAccountIds, operatorEmail = OPERATOR }) {
  const storage = createAppStorage({ backend: createMemoryBackend() });
  for (const [id, cfg] of Object.entries(configs)) {
    if (!cfg) continue;
    const scoped = storage.forAccount(id);
    await scoped.setConfig(cfg);
    await scoped.setLinkSecret('s'.repeat(32));
    await scoped.setOauthToken('tok');
  }
  const send = vi.fn().mockResolvedValue({ id: 'em' });
  const app = createApp({
    storage,
    api: { getBoardItems: boardItems() },
    rateLimiters: { perIp: createRateLimiter(), perAccount: createRateLimiter() },
    env: {
      clientId: 'c',
      clientSecret: 's',
      allowedAccountIds,
      baseUrl: 'https://app.example',
      operatorEmail,
    },
    emailSender: { send },
    todayIso: '2026-07-19',
    now: () => FIXED_NOW,
  });
  return { app, send };
}

const tick = (app) => request(app).post('/mndy-cronjob/digest-send');

describe('POST /mndy-cronjob/digest-send — who counts as due for the operator summary', () => {
  it('sends NO summary on an hour when only unconfigured tenants are in the roster', async () => {
    const { app, send } = await harness({
      // 111 is configured for 23:00, so at 08:00 it is not due. 999 has no config.
      configs: { [CONFIGURED]: config(23), [UNCONFIGURED]: null },
      allowedAccountIds: [CONFIGURED, UNCONFIGURED],
    });

    const res = await tick(app);

    expect(res.status).toBe(200);
    expect(res.body.summarySent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('still reports the unconfigured tenant in the response for diagnosis', async () => {
    const { app } = await harness({
      configs: { [UNCONFIGURED]: null },
      allowedAccountIds: [UNCONFIGURED],
    });

    const res = await tick(app);
    // The tick's own JSON keeps naming it — that costs nobody an email.
    expect(res.body.tenants).toEqual([
      { accountId: UNCONFIGURED, skip: 'digest_not_configured' },
    ]);
  });

  it('sends the summary when a tenant really was due this hour', async () => {
    const { app, send } = await harness({
      configs: { [CONFIGURED]: config(8) },
      allowedAccountIds: [CONFIGURED],
    });

    const res = await tick(app);

    expect(res.body.summarySent).toBe(true);
    // one digest + one summary
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].to).toBe(OPERATOR);
  });

  // The UNCONFIGURED account is deliberately FIRST in the roster. That ordering is
  // the whole point: it is the head of the raw tenant list but has no mailbox, so
  // a summary addressed as "the first tenant" instead of "the first DUE tenant"
  // would silently fail to send.
  it('summarises the due tenant even when an unconfigured one heads the roster', async () => {
    const { app, send } = await harness({
      configs: { [CONFIGURED]: config(8), [UNCONFIGURED]: null },
      allowedAccountIds: [UNCONFIGURED, CONFIGURED],
    });

    const res = await tick(app);

    expect(res.body.summarySent).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    // The summary must be sent AS a tenant that actually has a mailbox — the
    // unconfigured one has no sending identity at all.
    expect(send.mock.calls[1][0].accountId).toBe(CONFIGURED);
  });

  it('drops the dead wrong_hour filter — no code produces that skip reason', async () => {
    const { app } = await harness({
      configs: { [CONFIGURED]: config(23) },
      allowedAccountIds: [CONFIGURED],
    });

    const res = await tick(app);
    expect(res.body.tenants).toEqual([]); // not-due tenants are not listed at all
  });
});
