// TDD — the digest must not send the same task list to the same person twice in
// one slot, and the platform is what forces the issue.
//
// Measured 2026-08-05: `mapps scheduler:create -a 11704868 … -r 0` was IGNORED —
// the CLI treats 0 as "not supplied", prompts, and stored the defaults instead:
// `retryConfig: { maxRetries: 3, minBackoffDuration: 60 }`, `timeout: 300`. So a
// run killed at 300s is re-invoked up to three times, a minute apart, and every
// send it already performed happens again. Zero retries is not reachable from
// the CLI, which means the guard has to live in the handler.
//
// Granularity is per (slot × recipient), on purpose:
//   - per-tenant "already ran" would drop every recipient after the point where
//     a run died — the retry would skip the whole tenant;
//   - per-recipient lets the retry RESUME: those already emailed are skipped,
//     the rest go out. That turns the platform's retries from a hazard into
//     self-healing.
// The marker is therefore persisted after EACH successful send, not once at the
// end, or a crash mid-loop would leave nothing recorded.
//
// And it must be OPT-IN: `resend-today` and the admin's "send now" exist to
// re-send deliberately inside the same slot. Only the cron enforces it.

import { describe, it, expect, vi } from 'vitest';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { runDigestForAccount } from '../src/services/digest-run.js';
import { currentSlot } from '../src/services/manifest-signature.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00');
const SLOT = currentSlot({ sendHour: 8, now: FIXED_NOW });

const button = {
  id: 'b_start001',
  name: 'עדכן',
  statusColumnId: 'status_a',
  targetIndex: 0,
  targetLabel: 'בעבודה',
  style: { color: '#0073ea' },
};

const config = () => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [button],
  digest: {
    usersBoardId: '222',
    usersPeopleColumnId: 'people_u',
    usersEmailColumnId: 'email_u',
    subject: 'digest',
    sendHour: 8,
    sections: [
      {
        id: 's1',
        title: 'להתחיל:',
        dateColumnId: 'date_start',
        dateColumnTitle: 'תאריך',
        buttonId: button.id,
        includeStatusLabelIds: [0],
      },
    ],
  },
});

/** Two recipients (two people, two rows on the users board). */
function boardItemsDouble() {
  return vi.fn(async ({ boardId }) => {
    if (boardId === '111') {
      return {
        items: [
          {
            id: '9001',
            name: 'משימה של דנה',
            columns: {
              people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
              date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
              status_a: { text: '', statusLabelId: 0, date: null, personIds: [] },
            },
          },
          {
            id: '9002',
            name: 'משימה של רון',
            columns: {
              people_t: { text: 'רון', statusLabelId: null, date: null, personIds: ['502'] },
              date_start: { text: '', statusLabelId: null, date: '2026-07-11', personIds: [] },
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
            people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
            email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
          },
        },
        {
          id: 'u2',
          name: 'רון',
          columns: {
            people_u: { text: 'רון', statusLabelId: null, date: null, personIds: ['502'] },
            email_u: { text: 'ron@example.com', statusLabelId: null, date: null, personIds: [] },
          },
        },
      ],
      truncated: false,
    };
  });
}

async function seeded({ send } = {}) {
  const storage = createAppStorage({ backend: createMemoryBackend() });
  const scoped = storage.forAccount(ACCOUNT_ID);
  await scoped.setConfig(config());
  await scoped.setLinkSecret('s'.repeat(32));
  await scoped.setOauthToken('tok');
  return {
    storage,
    api: { getBoardItems: boardItemsDouble() },
    emailSender: { send: send ?? vi.fn().mockResolvedValue({ id: 'em' }) },
  };
}

const run = (deps, over = {}) =>
  runDigestForAccount({
    accountId: ACCOUNT_ID,
    storage: deps.storage,
    api: deps.api,
    baseUrl: 'https://app.example',
    emailSender: deps.emailSender,
    todayIso: TODAY,
    now: () => FIXED_NOW,
    ...over,
  });

const recipientsOf = (send) => send.mock.calls.map((c) => c[0].to).filter((to) => to);

describe('runDigestForAccount — per-slot send marker (skipAlreadySent)', () => {
  it('sends to everyone on the first run and records them for the slot', async () => {
    const deps = await seeded();
    const out = await run(deps, { skipAlreadySent: true });

    expect(out.sent).toBe(2);
    expect(recipientsOf(deps.emailSender.send).sort()).toEqual([
      'dana@example.com',
      'ron@example.com',
    ]);
    const marker = await deps.storage.forAccount(ACCOUNT_ID).getDigestSent();
    expect(marker.slot).toBe(SLOT);
    expect([...marker.personIds].sort()).toEqual(['501', '502']);
  });

  it('a second tick in the same slot sends NOTHING', async () => {
    const deps = await seeded();
    await run(deps, { skipAlreadySent: true });
    deps.emailSender.send.mockClear();

    const out = await run(deps, { skipAlreadySent: true });
    expect(deps.emailSender.send).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
    expect(out.alreadySent).toBe(2);
  });

  // The reason for per-recipient granularity: a retry has to finish the job, not
  // abandon it. Recipient 1 succeeded, then the run died; the retry must send to
  // recipient 2 ONLY.
  it('resumes after a crash — the retry sends only who is still missing', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: 'em1' })
      .mockRejectedValueOnce(new Error('killed mid-run'));
    const deps = await seeded({ send });
    await run(deps, { skipAlreadySent: true });
    expect(recipientsOf(send)).toHaveLength(2); // both attempted, one failed

    send.mockClear();
    send.mockResolvedValue({ id: 'em2' });
    const out = await run(deps, { skipAlreadySent: true });

    expect(recipientsOf(send)).toEqual(['ron@example.com']);
    expect(out.sent).toBe(1);
    expect(out.alreadySent).toBe(1);
  });

  // The one above cannot see WHEN the marker is written: a rejected send is
  // caught, so the run still reaches its end either way. What a killed run
  // depends on is that recipient #1 is already durable while send #2 is only
  // starting — so observe the marker from inside the send itself.
  it('persists each recipient before the NEXT send starts, not at the end', async () => {
    const deps = await seeded();
    const seenDuringSend = [];
    deps.emailSender.send.mockImplementation(async () => {
      const marker = await deps.storage.forAccount(ACCOUNT_ID).getDigestSent();
      seenDuringSend.push(marker ? [...marker.personIds] : null);
      return { id: 'em' };
    });

    await run(deps, { skipAlreadySent: true });

    expect(seenDuringSend[0]).toBeNull(); // nothing sent yet
    expect(seenDuringSend[1]).toEqual(['501']); // #1 is durable before #2 goes out
  });

  it('records a recipient only when their send SUCCEEDED', async () => {
    const send = vi.fn().mockRejectedValue(new Error('smtp down'));
    const deps = await seeded({ send });
    await run(deps, { skipAlreadySent: true });

    const marker = await deps.storage.forAccount(ACCOUNT_ID).getDigestSent();
    expect(marker?.personIds ?? []).toEqual([]);
  });

  it('a new slot clears the slate — yesterday cannot block today', async () => {
    const deps = await seeded();
    await run(deps, { skipAlreadySent: true });
    deps.emailSender.send.mockClear();

    const tomorrow = new Date('2026-07-20T08:05:00+03:00');
    const out = await run(deps, { skipAlreadySent: true, now: () => tomorrow, todayIso: '2026-07-20' });

    expect(out.sent).toBe(2);
    expect(out.alreadySent).toBe(0);
    const marker = await deps.storage.forAccount(ACCOUNT_ID).getDigestSent();
    expect(marker.slot).toBe(currentSlot({ sendHour: 8, now: tomorrow }));
  });

  // resend-today and the admin's "send now" are DELIBERATE re-sends inside the
  // same slot. The guard is opt-in so it cannot break them.
  it('is opt-in — without the flag a re-send in the same slot still goes out', async () => {
    const deps = await seeded();
    await run(deps, { skipAlreadySent: true });
    deps.emailSender.send.mockClear();

    const out = await run(deps); // no flag: the admin path
    expect(out.sent).toBe(2);
    expect(recipientsOf(deps.emailSender.send)).toHaveLength(2);
  });

  it('leaves no marker at all when the guard is off', async () => {
    const deps = await seeded();
    await run(deps);
    expect(await deps.storage.forAccount(ACCOUNT_ID).getDigestSent()).toBeNull();
  });

  // The 60s read cache would hide a marker written by the previous attempt —
  // and the platform's default backoff is exactly 60s.
  it('reads the marker THROUGH the cache, not from it', async () => {
    const deps = await seeded();
    const scoped = deps.storage.forAccount(ACCOUNT_ID);
    await scoped.getDigestSent(); // would populate a cache entry
    await scoped.setDigestSent({ slot: SLOT, personIds: ['501', '502'] });

    const out = await run(deps, { skipAlreadySent: true });
    expect(out.sent).toBe(0);
    expect(out.alreadySent).toBe(2);
  });
});
