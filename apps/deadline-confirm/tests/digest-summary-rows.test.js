// TDD — the DATA behind the per-employee summary file (docs/scheduling.md §5.2).
// The bytes are tests/digest-summary-report.test.js; this file pins where the
// numbers come from, across the two modules that produce them:
//
//  - `buildDigest` must also report the employees it resolved and then had
//    NOTHING to send to. Until now they were dropped silently (`taskCount === 0
//    → continue`), which is fine for mailing and fatal for a report whose whole
//    claim is "a row for every employee, so nobody is missing".
//  - `runDigestForAccount` must emit one row per employee, tagged with what
//    actually happened to them, plus the cluster columns in CONFIG ORDER — the
//    file has to match the settings, not a copy of them.
//
// The per-slot marker (§4) is what makes `already_sent` a real outcome rather
// than an absence: a retry that resumes must still account for the people the
// first attempt had already mailed.

import { describe, it, expect, vi } from 'vitest';
import { createAppStorage } from '../src/services/storage.js';
import { createMemoryBackend } from '../src/storage/memory-backend.js';
import { buildDigest } from '../src/services/digest-service.js';
import { runDigestForAccount } from '../src/services/digest-run.js';
import { currentSlot } from '../src/services/manifest-signature.js';

const ACCOUNT_ID = '777';
const TODAY = '2026-07-19';
const FIXED_NOW = new Date('2026-07-19T08:05:00+03:00');
const SLOT = currentSlot({ sendHour: 8, now: FIXED_NOW });

const buttons = [
  {
    id: 'b_start',
    name: 'עדכן: התחלתי',
    statusColumnId: 'status_a',
    targetIndex: 0,
    targetLabel: 'בעבודה',
    style: { color: '#0073ea' },
  },
  {
    id: 'b_done',
    name: 'עדכן: בוצע',
    statusColumnId: 'status_b',
    targetIndex: 1,
    targetLabel: 'בוצע',
    style: { color: '#00854d' },
  },
];

function config() {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons,
    digest: {
      usersBoardId: '222',
      usersPeopleColumnId: 'people_u',
      usersEmailColumnId: 'email_u',
      subject: 'digest',
      sendHour: 8,
      sections: [
        {
          id: 's_start',
          title: 'להתחיל:',
          dateColumnId: 'date_start',
          dateColumnTitle: 'תאריך התחלה',
          buttonId: 'b_start',
          includeStatusLabelIds: [0],
        },
        {
          id: 's_done',
          title: 'לסיים:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          buttonId: 'b_done',
          includeStatusLabelIds: [0],
        },
      ],
    },
  };
}

function userRow(id, name, { persons = [], email = '' } = {}) {
  return {
    id,
    name,
    columns: {
      people_u: { text: name, statusLabelId: null, date: null, personIds: persons },
      email_u: { text: email, statusLabelId: null, date: null, personIds: [] },
    },
  };
}

/** A task pending in the 'להתחיל' cluster (status_a === 0, date passed). */
function startTask(id, name, persons) {
  return {
    id,
    name,
    columns: {
      people_t: { text: '', statusLabelId: null, date: null, personIds: persons },
      date_start: { text: '', statusLabelId: null, date: '2026-07-10', personIds: [] },
      date_due: { text: '', statusLabelId: null, date: null, personIds: [] },
      status_a: { text: 'טרם', statusLabelId: 0, date: null, personIds: [] },
      status_b: { text: '', statusLabelId: null, date: null, personIds: [] },
    },
  };
}

/** A task pending in the 'לסיים' cluster (status_b === 0, date passed). */
function dueTask(id, name, persons) {
  return {
    id,
    name,
    columns: {
      people_t: { text: '', statusLabelId: null, date: null, personIds: persons },
      date_start: { text: '', statusLabelId: null, date: null, personIds: [] },
      date_due: { text: '', statusLabelId: null, date: '2026-07-11', personIds: [] },
      status_a: { text: '', statusLabelId: null, date: null, personIds: [] },
      status_b: { text: 'בעבודה', statusLabelId: 0, date: null, personIds: [] },
    },
  };
}

describe('buildDigest — employees with nothing to send', () => {
  it('reports a resolved employee who has no pending task as an empty recipient', () => {
    const { recipients, emptyRecipients } = buildDigest({
      config: config(),
      tasks: [startTask('9001', 'משימה', ['501'])],
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'רון', { persons: ['502'], email: 'ron@example.com' }),
      ],
      today: TODAY,
    });
    expect(recipients.map((r) => r.email)).toEqual(['dana@example.com']);
    expect(emptyRecipients).toEqual([
      { email: 'ron@example.com', name: 'רון', personId: '502' },
    ]);
  });

  it('never lists the same employee as both a recipient and an empty one', () => {
    const { recipients, emptyRecipients } = buildDigest({
      config: config(),
      tasks: [startTask('9001', 'משימה', ['501'])],
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      today: TODAY,
    });
    expect(recipients).toHaveLength(1);
    expect(emptyRecipients).toEqual([]);
  });

  it('keeps unusable users-board rows in skippedUsers, NOT among the empty recipients', () => {
    const { emptyRecipients, skippedUsers } = buildDigest({
      config: config(),
      tasks: [],
      users: [
        userRow('u1', 'בלי אימייל', { persons: ['501'] }),
        userRow('u2', 'בלי איש', { email: 'x@example.com' }),
        userRow('u3', 'שניים', { persons: ['503', '504'], email: 'y@example.com' }),
      ],
      today: TODAY,
    });
    expect(emptyRecipients).toEqual([]);
    expect(skippedUsers.map((s) => s.reason)).toEqual(['no_email', 'no_person', 'multi_person']);
  });

  it('preserves users-board order among the empty recipients', () => {
    const { emptyRecipients } = buildDigest({
      config: config(),
      tasks: [],
      users: [
        userRow('u1', 'ג', { persons: ['501'], email: 'c@example.com' }),
        userRow('u2', 'א', { persons: ['502'], email: 'a@example.com' }),
      ],
      today: TODAY,
    });
    expect(emptyRecipients.map((r) => r.name)).toEqual(['ג', 'א']);
  });

  it('lists BOTH rows as empty when one person sits on two rows with no tasks (D16)', () => {
    const { emptyRecipients } = buildDigest({
      config: config(),
      tasks: [],
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'דנה שוב', { persons: ['501'], email: 'dana@example.com' }),
      ],
      today: TODAY,
    });
    expect(emptyRecipients).toHaveLength(2);
  });
});

// --- the run's summary rows -------------------------------------------------

function boardDouble({ tasks, users }) {
  return vi.fn(async ({ boardId }) =>
    boardId === '111' ? { items: tasks, truncated: false } : { items: users, truncated: false }
  );
}

async function run({ tasks, users, send, skipAlreadySent = false, seedSent }) {
  const storage = createAppStorage({ backend: createMemoryBackend() });
  const scoped = storage.forAccount(ACCOUNT_ID);
  await scoped.setConfig(config());
  await scoped.setLinkSecret('s'.repeat(32));
  await scoped.setOauthToken('tok');
  if (seedSent) await scoped.setDigestSent(seedSent);
  return runDigestForAccount({
    accountId: ACCOUNT_ID,
    storage,
    api: { getBoardItems: boardDouble({ tasks, users }) },
    baseUrl: 'https://app.example',
    emailSender: { send: send ?? vi.fn().mockResolvedValue({ id: 'em' }) },
    todayIso: TODAY,
    now: () => FIXED_NOW,
    skipAlreadySent,
  });
}

describe('runDigestForAccount — summary rows', () => {
  it('exposes the cluster columns as configured, ids and titles, in order', async () => {
    const result = await run({
      tasks: [startTask('9001', 'משימה', ['501'])],
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
    });
    expect(result.summarySections).toEqual([
      { id: 's_start', title: 'להתחיל:' },
      { id: 's_done', title: 'לסיים:' },
    ]);
  });

  it('counts a sent employee per cluster, and totals to the recipient task count', async () => {
    const result = await run({
      tasks: [
        startTask('9001', 'א', ['501']),
        startTask('9002', 'ב', ['501']),
        dueTask('9003', 'ג', ['501']),
      ],
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
    });
    expect(result.summaryRows).toEqual([
      {
        name: 'דנה',
        email: 'dana@example.com',
        kind: 'sent',
        counts: { s_start: 2, s_done: 1 },
        total: 3,
      },
    ]);
  });

  it('tags a failed send with the transport error, keeping its counts', async () => {
    const send = vi.fn().mockRejectedValue(new Error('smtp rejected: 550'));
    const result = await run({
      tasks: [startTask('9001', 'א', ['501'])],
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      send,
    });
    expect(result.summaryRows).toEqual([
      {
        name: 'דנה',
        email: 'dana@example.com',
        kind: 'failed',
        counts: { s_start: 1 },
        total: 1,
        error: 'smtp rejected: 550',
      },
    ]);
  });

  it('tags an employee this slot already reached as already_sent, not as absent', async () => {
    const send = vi.fn().mockResolvedValue({ id: 'em' });
    const result = await run({
      tasks: [startTask('9001', 'א', ['501']), startTask('9002', 'ב', ['502'])],
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'רון', { persons: ['502'], email: 'ron@example.com' }),
      ],
      send,
      skipAlreadySent: true,
      seedSent: { slot: SLOT, personIds: ['501'] },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.summaryRows).toEqual([
      {
        name: 'דנה',
        email: 'dana@example.com',
        kind: 'already_sent',
        counts: { s_start: 1 },
        total: 1,
      },
      {
        name: 'רון',
        email: 'ron@example.com',
        kind: 'sent',
        counts: { s_start: 1 },
        total: 1,
      },
    ]);
  });

  it('carries a row for an employee with zero pending tasks', async () => {
    const result = await run({
      tasks: [startTask('9001', 'א', ['501'])],
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'רון', { persons: ['502'], email: 'ron@example.com' }),
      ],
    });
    expect(result.summaryRows).toContainEqual({
      name: 'רון',
      email: 'ron@example.com',
      kind: 'no_tasks',
      counts: {},
      total: 0,
    });
  });

  it('carries a row per unusable users-board row, with its skip reason', async () => {
    const result = await run({
      tasks: [],
      users: [userRow('u1', 'בלי אימייל', { persons: ['501'] })],
    });
    expect(result.summaryRows).toEqual([
      { name: 'בלי אימייל', email: '', kind: 'skipped', reason: 'no_email', counts: {}, total: 0 },
    ]);
  });

  it('accounts for EVERY users-board row exactly once, whatever happened to it', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ id: 'em' })
      .mockRejectedValueOnce(new Error('boom'));
    const result = await run({
      tasks: [startTask('9001', 'א', ['501']), startTask('9002', 'ב', ['502'])],
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'רון', { persons: ['502'], email: 'ron@example.com' }),
        userRow('u3', 'תמר', { persons: ['503'], email: 'tamar@example.com' }),
        userRow('u4', 'שי', { persons: [], email: 'shai@example.com' }),
      ],
      send,
    });
    expect(result.summaryRows).toHaveLength(4);
    expect(result.summaryRows.map((r) => r.kind).sort()).toEqual([
      'failed',
      'no_tasks',
      'sent',
      'skipped',
    ]);
    expect(result.summaryRows.map((r) => r.name).sort()).toEqual(['דנה', 'רון', 'שי', 'תמר']);
  });

  it('lists the employees with tasks before those without, so the file opens on the news', async () => {
    const result = await run({
      tasks: [startTask('9001', 'א', ['502'])],
      users: [
        userRow('u1', 'בלי משימות', { persons: ['501'], email: 'a@example.com' }),
        userRow('u2', 'עם משימות', { persons: ['502'], email: 'b@example.com' }),
        userRow('u3', 'בלי אימייל', { persons: ['503'] }),
      ],
    });
    expect(result.summaryRows.map((r) => r.kind)).toEqual(['sent', 'no_tasks', 'skipped']);
  });

  it('produces the rows for a manual send too — only the cron chooses to mail them', async () => {
    const result = await run({
      tasks: [startTask('9001', 'א', ['501'])],
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      skipAlreadySent: false,
    });
    expect(result.summaryRows).toHaveLength(1);
    expect(result.summaryRows[0].kind).toBe('sent');
  });

  it('emits an empty row list when the users board is empty, never undefined', async () => {
    const result = await run({ tasks: [], users: [] });
    expect(result.summaryRows).toEqual([]);
    expect(result.summarySections).toHaveLength(2);
  });
});
