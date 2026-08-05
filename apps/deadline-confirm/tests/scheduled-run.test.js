// TDD — `runScheduledForAccount`: the shared per-tenant half of a tick, and the
// engine behind the admin screen's manual trigger (round348, owner decisions
// 2026-08-05).
//
// This supersedes, for ONE new route only, the "a file is produced by cron
// alone" rule pinned in `scheduler-summary-file.test.js`. That rule still holds
// for `/api/digest/send` and `resend-today`, and its test is untouched: the
// owner asked for a button that runs the scheduled action *including its
// report*, not for the existing buttons to start mailing files.
//
// The three behaviours below are decisions, not implementation detail:
//
//  1. **`skipAlreadySent` is FALSE by default** — the manual button re-sends to
//     everyone, every time. Because `digest-run.js` writes the per-slot marker
//     ONLY under that flag, a manual run also leaves no marker, so it cannot
//     suppress the cron that follows it. Both halves are asserted; a future
//     "improvement" that defaults the flag on breaks them.
//  2. **The report goes to the tenant's OWN mailbox**, and a tenant with no
//     connected mailbox simply gets no file.
//  3. **A failed report never fails the run.** The digests are already out.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runDigestForAccount = vi.fn();
const buildDigestSummaryReport = vi.fn();

vi.mock('../src/services/digest-run.js', () => ({
  runDigestForAccount: (...a) => runDigestForAccount(...a),
}));
vi.mock('../src/helpers/digest-summary-report.js', () => ({
  buildDigestSummaryReport: (...a) => buildDigestSummaryReport(...a),
}));

const { runScheduledForAccount, sendTenantSummaryReport } = await import(
  '../src/services/scheduled-run.js'
);

const ACCOUNT = '777';

function storageWith(senderAddress, { throws = false } = {}) {
  return {
    forAccount: () => ({
      getGoogleSender: async () => {
        if (throws) throw new Error('storage exploded');
        return senderAddress ? { senderAddress } : null;
      },
    }),
  };
}

function okRun(over = {}) {
  return {
    slot: '2026-08-05',
    failed: 0,
    results: [{ email: 'a@x.com', ok: true }],
    summaryRows: [{ kind: 'sent' }],
    summarySections: [{ title: 'לסיים:' }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildDigestSummaryReport.mockReturnValue({
    subject: 'דוח שליחה 2026-08-05',
    plain: 'body',
    mime: { raw: 'MIME' },
  });
});

describe('runScheduledForAccount — the per-slot marker decision', () => {
  it('defaults skipAlreadySent to FALSE so the button re-sends to everyone', async () => {
    runDigestForAccount.mockResolvedValue(okRun());
    const emailSender = { send: vi.fn().mockResolvedValue({ id: '1' }) };

    await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender,
    });

    expect(runDigestForAccount).toHaveBeenCalledTimes(1);
    expect(runDigestForAccount.mock.calls[0][0].skipAlreadySent).toBe(false);
  });

  it('passes the flag through when a caller (the cron) asks for the marker', async () => {
    runDigestForAccount.mockResolvedValue(okRun());
    await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send: vi.fn().mockResolvedValue({ id: '1' }) },
      skipAlreadySent: true,
    });
    expect(runDigestForAccount.mock.calls[0][0].skipAlreadySent).toBe(true);
  });

  it('freezes the clock it hands the run, so a long batch cannot sign two slots', async () => {
    runDigestForAccount.mockResolvedValue(okRun());
    let t = 1000;
    const now = () => new Date((t += 5000)); // every call is a different instant

    await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send: vi.fn().mockResolvedValue({ id: '1' }) },
      now,
    });

    const passedNow = runDigestForAccount.mock.calls[0][0].now;
    expect(passedNow().getTime()).toBe(passedNow().getTime());
  });
});

describe('runScheduledForAccount — the CSV report', () => {
  it("sends the report to the tenant's own sending mailbox and reports it sent", async () => {
    runDigestForAccount.mockResolvedValue(okRun());
    const send = vi.fn().mockResolvedValue({ id: '1' });

    const out = await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send },
    });

    expect(out.reportSent).toBe(true);
    const mail = send.mock.calls.at(-1)[0];
    expect(mail.to).toBe('me@tenant.com');
    expect(mail.accountId).toBe(ACCOUNT);
    expect(mail.mime).toEqual({ raw: 'MIME' });
  });

  it('sends no file when the tenant has no connected mailbox', async () => {
    runDigestForAccount.mockResolvedValue(okRun());
    const send = vi.fn().mockResolvedValue({ id: '1' });

    const out = await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith(null),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send },
    });

    expect(out.reportSent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not throw — and still returns the run — when the report send fails', async () => {
    runDigestForAccount.mockResolvedValue(okRun());
    const send = vi.fn().mockRejectedValue(new Error('smtp auth failed: 535'));

    const out = await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send },
    });

    expect(out.reportSent).toBe(false);
    expect(out.results).toHaveLength(1);
    expect(out.slot).toBe('2026-08-05');
  });

  it('produces no file for a tenant that ran nothing (skip → no summaryRows)', async () => {
    runDigestForAccount.mockResolvedValue({ skip: 'email_not_configured' });
    const send = vi.fn();

    const out = await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send },
    });

    expect(out.skip).toBe('email_not_configured');
    expect(out.reportSent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('runScheduledForAccount — durationMs', () => {
  it('measures the run only, not the report send', async () => {
    // now() order: clock, startedAt, finishedAt, (report send does no now()).
    const stamps = [0, 0, 250].map((ms) => new Date(1_000_000 + ms));
    let i = 0;
    const now = () => stamps[Math.min(i++, stamps.length - 1)];

    runDigestForAccount.mockResolvedValue(okRun());
    const out = await runScheduledForAccount({
      accountId: ACCOUNT,
      storage: storageWith('me@tenant.com'),
      api: {},
      baseUrl: 'https://x',
      emailSender: { send: vi.fn().mockResolvedValue({ id: '1' }) },
      now,
    });

    expect(out.durationMs).toBe(250);
  });
});

describe('sendTenantSummaryReport', () => {
  it('is a no-op without an emailSender', async () => {
    const sent = await sendTenantSummaryReport({
      tenant: { accountId: ACCOUNT, summaryRows: [] },
      storage: storageWith('me@tenant.com'),
      emailSender: undefined,
      tag: 't',
    });
    expect(sent).toBe(false);
  });

  it('returns false, and does not throw, when the sender lookup itself fails', async () => {
    const send = vi.fn();
    const sent = await sendTenantSummaryReport({
      tenant: { accountId: ACCOUNT, summaryRows: [{ kind: 'sent' }] },
      storage: storageWith('me@tenant.com', { throws: true }),
      emailSender: { send },
      tag: 't',
    });
    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
