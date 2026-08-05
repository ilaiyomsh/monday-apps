// TDD — round348 §E: an optional label gate on the USERS BOARD. When BOTH a
// status column and a label id are configured, only rows carrying that label
// become recipients; everyone else is skipped with reason `not_labeled` (which
// digest-summary-report.js's CSV surfaces via the existing `kind: 'skipped'`
// pipeline — no new report plumbing needed).
//
// The one decision that matters and is pinned here in both directions: EITHER
// field absent (column OR label not configured) means the gate is OFF and
// everyone qualifies, exactly like every digest before this feature. A reversed
// default (nobody qualifies until picked) would silently mute mail for every
// existing tenant the moment they upgrade, with nobody having touched the
// setting — the owner rejected that outright.

import { describe, it, expect } from 'vitest';
import { buildDigest, digestUsersColumnIds } from '../src/services/digest-service.js';

const BUTTON = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'status_a',
  targetIndex: 2,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};

const config = (digestOver = {}) => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [BUTTON],
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
        dateColumnId: 'date_end',
        dateColumnTitle: 'תאריך יעד',
        buttonId: 'b_done0001',
        buttonIds: ['b_done0001'],
        includeStatusLabelIds: [0],
      },
    ],
    ...digestOver,
  },
});

const TASKS = [
  {
    id: '9001',
    name: 'גיבוש תכנית',
    columns: {
      people_t: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
      date_end: { text: '2026-08-01', statusLabelId: null, date: '2026-08-01', personIds: [] },
      status_a: { text: 'לא התחיל', statusLabelId: 0, date: null, personIds: [] },
    },
  },
  {
    id: '9002',
    name: 'הגשת דוח',
    columns: {
      people_t: { text: 'רון', statusLabelId: null, date: null, personIds: ['502'] },
      date_end: { text: '2026-08-01', statusLabelId: null, date: '2026-08-01', personIds: [] },
      status_a: { text: 'לא התחיל', statusLabelId: 0, date: null, personIds: [] },
    },
  },
];

/** דנה is opted in (gate_col = label 1, "מקבל מייל"); רון never touched the column (null). */
const USERS_MIXED = [
  {
    id: 'u1',
    name: 'דנה כהן',
    columns: {
      people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
      email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
      gate_col: { text: 'מקבל מייל', statusLabelId: 1, date: null, personIds: [] },
    },
  },
  {
    id: 'u2',
    name: 'רון לוי',
    columns: {
      people_u: { text: 'רון', statusLabelId: null, date: null, personIds: ['502'] },
      email_u: { text: 'ron@example.com', statusLabelId: null, date: null, personIds: [] },
      gate_col: { text: '', statusLabelId: null, date: null, personIds: [] },
    },
  },
];

const runMixed = (digestOver) =>
  buildDigest({ config: config(digestOver), tasks: TASKS, users: USERS_MIXED, today: '2026-08-03' });

describe('buildDigest — recipient label gate (round348)', () => {
  it('gate OFF (column and label both unset) — everyone qualifies, as before', () => {
    const { recipients, skippedUsers } = runMixed({});
    expect(recipients.map((r) => r.email).sort()).toEqual(['dana@example.com', 'ron@example.com']);
    expect(skippedUsers).toEqual([]);
  });

  it('gate OFF (column set, label unset) — everyone still qualifies', () => {
    const { recipients, skippedUsers } = runMixed({ recipientGateColumnId: 'gate_col' });
    expect(recipients.map((r) => r.email).sort()).toEqual(['dana@example.com', 'ron@example.com']);
    expect(skippedUsers).toEqual([]);
  });

  it('gate OFF (label set, column unset) — everyone still qualifies', () => {
    const { recipients, skippedUsers } = runMixed({ recipientGateLabelId: 1 });
    expect(recipients.map((r) => r.email).sort()).toEqual(['dana@example.com', 'ron@example.com']);
    expect(skippedUsers).toEqual([]);
  });

  it('gate ON — only the row carrying the configured label becomes a recipient', () => {
    const { recipients, skippedUsers } = runMixed({
      recipientGateColumnId: 'gate_col',
      recipientGateLabelId: 1,
    });
    expect(recipients.map((r) => r.email)).toEqual(['dana@example.com']);
    expect(skippedUsers).toEqual([{ itemId: 'u2', name: 'רון לוי', reason: 'not_labeled' }]);
  });

  it('gate ON — an unset (null) status on the gate column is excluded, not treated as a match', () => {
    const { skippedUsers } = runMixed({ recipientGateColumnId: 'gate_col', recipientGateLabelId: 1 });
    expect(skippedUsers.map((s) => s.itemId)).toContain('u2');
  });

  it('gate ON with label id 0 — matches label 0 and EXCLUDES a different label (0 is a real value, never falsy)', () => {
    // A truthy check on `recipientGateLabelId` (e.g. `Boolean(gateLabelId)`) reads
    // 0 as "not configured" and turns the whole gate off — which would let רון
    // (label 2, not 0) through too. Both rows must be present so that outcome
    // is distinguishable from "gate off, everyone in".
    const zeroUsers = [
      {
        id: 'u1',
        name: 'דנה כהן',
        columns: {
          people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
          email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
          gate_col: { text: 'לא פעיל', statusLabelId: 0, date: null, personIds: [] },
        },
      },
      {
        id: 'u2',
        name: 'רון לוי',
        columns: {
          people_u: { text: 'רון', statusLabelId: null, date: null, personIds: ['502'] },
          email_u: { text: 'ron@example.com', statusLabelId: null, date: null, personIds: [] },
          gate_col: { text: 'פעיל', statusLabelId: 2, date: null, personIds: [] },
        },
      },
    ];
    const { recipients, skippedUsers } = buildDigest({
      config: config({ recipientGateColumnId: 'gate_col', recipientGateLabelId: 0 }),
      tasks: TASKS,
      users: zeroUsers,
      today: '2026-08-03',
    });
    expect(recipients.map((r) => r.email)).toEqual(['dana@example.com']);
    expect(skippedUsers).toEqual([{ itemId: 'u2', name: 'רון לוי', reason: 'not_labeled' }]);
  });

  it('a row already skipped for no_email keeps that reason — the gate never overrides an earlier skip', () => {
    const noEmailUsers = [
      {
        id: 'u1',
        name: 'בלי מייל',
        columns: {
          people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
          email_u: { text: '', statusLabelId: null, date: null, personIds: [] },
          gate_col: { text: 'מקבל מייל', statusLabelId: 1, date: null, personIds: [] },
        },
      },
    ];
    const { skippedUsers } = buildDigest({
      config: config({ recipientGateColumnId: 'gate_col', recipientGateLabelId: 1 }),
      tasks: TASKS,
      users: noEmailUsers,
      today: '2026-08-03',
    });
    expect(skippedUsers).toEqual([{ itemId: 'u1', name: 'בלי מייל', reason: 'no_email' }]);
  });
});

describe('digestUsersColumnIds — users-board read column list', () => {
  it('carries person + email only when the gate is unconfigured', () => {
    expect(
      digestUsersColumnIds({ usersPeopleColumnId: 'p', usersEmailColumnId: 'e' })
    ).toEqual(['p', 'e']);
  });

  it('adds the gate column when configured', () => {
    expect(
      digestUsersColumnIds({
        usersPeopleColumnId: 'p',
        usersEmailColumnId: 'e',
        recipientGateColumnId: 'g',
      })
    ).toEqual(['p', 'e', 'g']);
  });

  it('never returns null/undefined entries', () => {
    expect(
      digestUsersColumnIds({ usersPeopleColumnId: 'p', usersEmailColumnId: 'e', recipientGateColumnId: null })
    ).toEqual(['p', 'e']);
  });
});
