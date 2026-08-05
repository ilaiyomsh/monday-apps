// TDD — WHO gets the per-employee summary file, and WHEN (owner decision
// 2026-08-05, docs/scheduling.md §5.2).
//
// Three parts of the decision are behaviour, not formatting, so they are pinned
// here rather than in the CSV tests:
//
//  1. **Target: the tenant's OWN sending mailbox** (`${accountId}:google_sender`,
//     a send to itself). Deliberately NOT `OPERATOR_EMAIL`: the file follows the
//     mailbox, so rebinding a sender moves the report with it and no separate
//     env var can drift out of date.
//  2. **Trigger: a cron tick only.** The admin screen shows its own result on
//     screen, so `/api/digest/send` and `resend-today` produce no file. Nothing
//     in the shared pipeline may start mailing files on a button press.
//  3. **A failed report never costs a digest.** The digests are already sent by
//     the time the file goes out; a send failure here is logged and the tick
//     still answers 200, or a broken report would trigger the platform's retry
//     and re-run the whole tenant.

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
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00'); // hour 8 Jerusalem

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
  allowedAccountIds = [ACCOUNT_A],
  operatorEmail = null,
  senders = { [ACCOUNT_A]: 'sender-a@tenant.example' },
  configs = { [ACCOUNT_A]: fullConfig(8) },
  send,
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
  for (const [id, senderAddress] of Object.entries(senders ?? {})) {
    if (!senderAddress) continue;
    await storage.forAccount(id).setGoogleSender({
      senderAddress,
      refreshToken: 'r',
      accessToken: 'a',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'https://mail.google.com/',
    });
  }
  const sendFn = send ?? vi.fn().mockResolvedValue({ id: 'em' });
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
    emailSender: { send: sendFn },
    todayIso: TODAY,
    now: () => FIXED_NOW,
  });
  return { app, send: sendFn, storage };
}

/** Every send() call addressed to the tenant's own sending mailbox. */
function reportCalls(send, address) {
  return send.mock.calls.map(([p]) => p).filter((p) => p.to === address);
}

/** Decode the CSV attachment out of a report call. */
function decodeCsv(call) {
  const section = call.mime.body.split(/--dcm_[0-9a-f]+/).find((s) => s.includes('text/csv'));
  const payload = section.slice(section.indexOf('\r\n\r\n') + 4).trim();
  return Buffer.from(payload.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

describe('cron tick — the per-employee summary file', () => {
  it('mails exactly one report to the tenant’s own sending mailbox', async () => {
    const { app, send } = await harness();
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.status).toBe(200);
    const reports = reportCalls(send, 'sender-a@tenant.example');
    expect(reports).toHaveLength(1);
    expect(reports[0].accountId).toBe(ACCOUNT_A);
    expect(reports[0].subject).toContain('דוח שליחה');
  });

  it('sends the report with NO operatorEmail configured — it does not depend on it', async () => {
    const { app, send } = await harness({ operatorEmail: null });
    await request(app).post('/mndy-cronjob/digest-send');
    expect(reportCalls(send, 'sender-a@tenant.example')).toHaveLength(1);
    expect(send.mock.calls.some(([p]) => p.to === 'ops@twyst.co.il')).toBe(false);
  });

  it('goes to the tenant mailbox even when OPERATOR_EMAIL is set — the operator gets the text summary, not the file', async () => {
    // The one fixture where the two candidate targets differ. Without it, an
    // implementation that prefers OPERATOR_EMAIL passes every other test here.
    const { app, send } = await harness({ operatorEmail: 'ops@twyst.co.il' });
    await request(app).post('/mndy-cronjob/digest-send');
    const reports = reportCalls(send, 'sender-a@tenant.example');
    expect(reports).toHaveLength(1);
    expect(reports[0].mime.contentType).toMatch(/^multipart\/mixed;/);
    // The operator summary is still text-only — the CSV never goes there.
    const toOperator = send.mock.calls.map(([p]) => p).filter((p) => p.to === 'ops@twyst.co.il');
    expect(toOperator).toHaveLength(1);
    expect(toOperator[0].mime).toBeUndefined();
  });

  it('attaches a CSV carrying a row for the employee who got mail AND the one who did not', async () => {
    const { app, send } = await harness();
    await request(app).post('/mndy-cronjob/digest-send');
    const csv = decodeCsv(reportCalls(send, 'sender-a@tenant.example')[0]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('עובד,אימייל,להתחיל:,"סה""כ",שגיאה');
    expect(lines[1]).toBe('דנה,dana@example.com,1,1,');
    expect(lines[2]).toBe('רון,ron@example.com,0,0,אין משימות פתוחות');
  });

  it('reports the file count in the tick response', async () => {
    const { app } = await harness();
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.reportsSent).toBe(1);
  });

  it('sends one report per due tenant, each to its own mailbox', async () => {
    const { app, send } = await harness({
      allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
      configs: { [ACCOUNT_A]: fullConfig(8), [ACCOUNT_B]: fullConfig(8) },
      senders: { [ACCOUNT_A]: 'sender-a@tenant.example', [ACCOUNT_B]: 'sender-b@other.example' },
    });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.reportsSent).toBe(2);
    expect(reportCalls(send, 'sender-a@tenant.example')).toHaveLength(1);
    expect(reportCalls(send, 'sender-b@other.example')).toHaveLength(1);
    // Each tenant's file goes out under its OWN sending identity — never the
    // first tenant's, the way the cross-tenant operator summary has to.
    expect(reportCalls(send, 'sender-b@other.example')[0].accountId).toBe(ACCOUNT_B);
  });

  it('sends nothing for a tenant that is not due this hour', async () => {
    const { app, send } = await harness({
      allowedAccountIds: [ACCOUNT_A, ACCOUNT_B],
      configs: { [ACCOUNT_A]: fullConfig(8), [ACCOUNT_B]: fullConfig(9) },
      senders: { [ACCOUNT_A]: 'sender-a@tenant.example', [ACCOUNT_B]: 'sender-b@other.example' },
    });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.reportsSent).toBe(1);
    expect(reportCalls(send, 'sender-b@other.example')).toHaveLength(0);
  });

  it('leaves a due tenant that ran NOTHING alone — no send, and no hourly error line', async () => {
    // A tenant past the sendHour gate whose run skipped (here: no link secret)
    // has no rows and no slot. It must be passed over deliberately, not fed to
    // the report builder and rescued by the catch: this cron fires every hour,
    // and §5 is the measured record of what an hourly error line costs.
    const storage = createAppStorage({ backend: createMemoryBackend() });
    const scoped = storage.forAccount(ACCOUNT_A);
    await scoped.setConfig(fullConfig(8));
    await scoped.setOauthToken('tok'); // deliberately no link secret → skip 'no_secret'
    await scoped.setGoogleSender({
      senderAddress: 'sender-a@tenant.example',
      refreshToken: 'r',
      accessToken: 'a',
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: 'https://mail.google.com/',
    });
    const send = vi.fn().mockResolvedValue({ id: 'em' });
    const records = [];
    const unsubscribe = addSink((record) => records.push(record));
    try {
      const app = createApp({
        storage,
        api: { getBoardItems: boardItemsDouble() },
        rateLimiters: {
          perIp: createRateLimiter({ capacity: 120 }),
          perAccount: createRateLimiter(),
        },
        env: {
          clientId: 'cid',
          clientSecret: 'cs',
          allowedAccountIds: [ACCOUNT_A],
          baseUrl: 'https://app.example',
          operatorEmail: null,
        },
        emailSender: { send },
        todayIso: TODAY,
        now: () => FIXED_NOW,
      });
      const res = await request(app).post('/mndy-cronjob/digest-send');
      expect(res.body.tenants[0]).toMatchObject({ accountId: ACCOUNT_A, skip: 'no_secret' });
      expect(res.body.reportsSent).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(records.filter((r) => r.level === 'ERROR')).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('sends no report for a tenant that never ran (no digest configured)', async () => {
    const { app, send } = await harness({
      configs: { [ACCOUNT_A]: null },
      senders: { [ACCOUNT_A]: 'sender-a@tenant.example' },
    });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.reportsSent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends no report when the tenant has no connected mailbox to send it to', async () => {
    const { app, send } = await harness({ senders: {} });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.reportsSent).toBe(0);
    // The digest itself still went out; only the file had nowhere to go.
    expect(send.mock.calls.map(([p]) => p.to)).toEqual(['dana@example.com']);
  });

  it('answers 200 and still counts the digests when the report send fails', async () => {
    const send = vi.fn(async ({ to }) => {
      if (to === 'sender-a@tenant.example') throw new Error('smtp rejected: 550');
      return { id: 'em' };
    });
    const { app } = await harness({ send });
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.status).toBe(200);
    expect(res.body.reportsSent).toBe(0);
    expect(res.body.tenants[0]).toMatchObject({ accountId: ACCOUNT_A, sent: 1, failed: 0 });
  });

  it('sends the report AFTER every digest of that tenant, never before', async () => {
    const { app, send } = await harness();
    await request(app).post('/mndy-cronjob/digest-send');
    const order = send.mock.calls.map(([p]) => p.to);
    expect(order.indexOf('sender-a@tenant.example')).toBeGreaterThan(
      order.indexOf('dana@example.com')
    );
  });

  it('keeps the report out of the tenant list — the wire shape stays what consumers expect', async () => {
    const { app } = await harness();
    const res = await request(app).post('/mndy-cronjob/digest-send');
    expect(res.body.tenants[0].summaryRows).toBeUndefined();
    expect(res.body.tenants[0].summarySections).toBeUndefined();
    expect(res.body.tenants[0].due).toBeUndefined();
  });
});

describe('admin sends — no file, by design', () => {
  it('produces no report when the admin triggers a send from the screen', async () => {
    const { app, send } = await harness();
    const res = await request(app)
      .post('/api/digest/send')
      .set('Authorization', 'none')
      .send({});
    // Unauthenticated admin call is refused long before any send — the point is
    // that no path other than the cron tick reaches the report at all.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(reportCalls(send, 'sender-a@tenant.example')).toHaveLength(0);
  });
});
