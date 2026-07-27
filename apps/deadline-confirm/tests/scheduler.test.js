// Integration tests for the digest scheduler (T10) + operator summary (T11).
// Dual path /mndy-cronjob/digest-send + /scheduler/digest-send. Iterates
// allowedAccountIds; silent-skips wrong_hour and incomplete tenants; sends
// D8 operator summary when OPERATOR_EMAIL + emailSender are present.

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { createRateLimiter } from '../src/helpers/rate-limit.js';

const ACCOUNT_A = '111';
const ACCOUNT_B = '222';
const TODAY = '2026-07-19';
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00'); // hour 8 Jerusalem

function buttons() {
  return [
    {
      id: 'b_start001',
      name: 'עדכן',
      statusColumnId: 'status_a',
      targetIndex: 0,
      targetLabel: 'בעבודה',
      style: { color: '#0073ea', icon: '✓', size: 'sm' },
    },
  ];
}

function fullConfig(sendHour = 8) {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: buttons(),
    digest: {
      usersBoardId: '222',
      usersPeopleColumnId: 'people_u',
      usersEmailColumnId: 'email_u',
      subject: 'digest',
      sendHour,
      sections: [
        {
          id: 's_start001',
          title: 'להתחיל:',
          dateColumnId: 'date_start',
          dateColumnTitle: 'תאריך',
          buttonId: 'b_start001',
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

async function harness({
  allowedAccountIds = [ACCOUNT_A, ACCOUNT_B],
  operatorEmail = 'ops@twyst.co.il',
  emailSender,
  configs = {},
} = {}) {
  const storage = createAppStorage({ backend: createMemoryBackend() });
  for (const [id, cfg] of Object.entries(configs)) {
    const scoped = storage.forAccount(id);
    if (cfg) {
      await scoped.setConfig(cfg);
      await scoped.setLinkSecret('s'.repeat(32));
      await scoped.setOauthToken('tok');
    }
  }
  const send = emailSender?.send ?? vi.fn().mockResolvedValue({ id: 'em' });
  const sender = emailSender === null ? undefined : { send };
  const app = createApp({
    storage,
    api: { getBoardItems: boardItemsDouble() },
    rateLimiters: { perIp: createRateLimiter({ capacity: 120 }), perAccount: createRateLimiter() },
    env: {
      clientId: 'cid',
      clientSecret: 'cs',
      allowedAccountIds,
      baseUrl: 'https://app.example',
      operatorEmail,
    },
    emailSender: sender,
    todayIso: TODAY,
    now: () => FIXED_NOW,
  });
  return { app, send, storage };
}

describe('POST /(mndy-cronjob|scheduler)/digest-send', () => {
  it('runs only tenants whose sendHour matches the current Jerusalem hour; silent on wrong_hour', async () => {
    const { app, send } = await harness({
      configs: {
        [ACCOUNT_A]: fullConfig(8), // due
        [ACCOUNT_B]: fullConfig(9), // not due
      },
    });
    const res = await request(app).post('/scheduler/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.hour).toBe(8);
    expect(res.body.tenants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: ACCOUNT_A, sent: 1, failed: 0 }),
      ])
    );
    expect(res.body.tenants.find((t) => t.accountId === ACCOUNT_B)).toBeUndefined();
    // one digest + one operator summary
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].to).toBe('dana@example.com');
    expect(send.mock.calls[1][0].to).toBe('ops@twyst.co.il');
    expect(send.mock.calls[1][0].subject).toMatch(/summary|סיכום|digest/i);
    expect(send.mock.calls[1][0].plain).toContain('slot:');
    expect(send.mock.calls[1][0].plain).toContain(`account ${ACCOUNT_A}`);
    expect(send.mock.calls[1][0].plain).not.toContain('itemId');
  });

  it('also answers on /mndy-cronjob/digest-send (monday scheduler path)', async () => {
    const { app } = await harness({
      configs: { [ACCOUNT_A]: fullConfig(8) },
      allowedAccountIds: [ACCOUNT_A],
      operatorEmail: null,
    });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('skips incomplete tenants quietly (digest_not_configured) without raising', async () => {
    const { app, send } = await harness({
      configs: { [ACCOUNT_A]: null },
      allowedAccountIds: [ACCOUNT_A],
      operatorEmail: null,
    });
    // ACCOUNT_A has no config seeded
    const res = await request(app).post('/scheduler/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual([
      { accountId: ACCOUNT_A, skip: 'digest_not_configured' },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it('empty allowedAccountIds → 200 with zero tenants (D15 default-deny roster)', async () => {
    const { app, send } = await harness({
      allowedAccountIds: [],
      configs: { [ACCOUNT_A]: fullConfig(8) },
      operatorEmail: null,
    });
    const res = await request(app).post('/scheduler/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send operator summary when OPERATOR_EMAIL is unset', async () => {
    const { app, send } = await harness({
      configs: { [ACCOUNT_A]: fullConfig(8) },
      allowedAccountIds: [ACCOUNT_A],
      operatorEmail: null,
    });
    const res = await request(app).post('/scheduler/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.summarySent).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('dana@example.com');
  });
});
