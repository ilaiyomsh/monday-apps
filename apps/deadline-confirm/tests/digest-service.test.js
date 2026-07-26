// v4 digest core — PURE classification/matching contract (see module header
// of src/services/digest-service.js). Items arrive in the normalized shape
// produced by monday-api getBoardItems: { id, name, columns: { [colId]:
// { text, statusLabelId, date, personIds } } }.
//
// Owner spec (2026-07-20): "show by status" — a task enters a section only if
// its status (on the button's status column) is one of the section's
// includeStatusLabelIds. A date counts as "passed" INCLUDING today. The email
// date header is the section's dateColumnTitle.

import { describe, it, expect } from 'vitest';
import { buildDigest, digestTaskColumnIds } from '../src/services/digest-service.js';

const TODAY = '2026-07-19';

function baseConfig(overrides = {}) {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: [
      {
        id: 'b_start001',
        name: 'עדכן: התחלתי',
        statusColumnId: 'status_a',
        targetIndex: 0, // label id 0 — VALID (falsy-check trap)
        targetLabel: 'בעבודה',
        style: { color: '#0073ea', icon: '✓', size: 'sm' },
      },
      {
        id: 'b_done0001',
        name: 'עדכן: בוצע',
        statusColumnId: 'status_b',
        targetIndex: 1,
        targetLabel: 'בוצע',
        style: { color: '#00854d', icon: '✓', size: 'sm' },
      },
    ],
    templates: [],
    digest: {
      usersBoardId: '222',
      usersPeopleColumnId: 'people_u',
      usersEmailColumnId: 'email_u',
      subject: 'המשימות שלך',
      sections: [
        {
          id: 's_start001',
          title: 'משימות שנדרש להתחיל וטרם התחילו:',
          dateColumnId: 'date_start',
          dateColumnTitle: 'תאריך התחלה',
          buttonId: 'b_start001',
          includeStatusLabelIds: [0], // show only status_a === 0 (label id 0 — falsy trap)
        },
        {
          id: 's_done0001',
          title: 'משימות שנדרש לסיים וטרם בוצעו:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          buttonId: 'b_done0001',
          includeStatusLabelIds: [0], // show status_b === 0 ("בעבודה"); done (1) is excluded
        },
      ],
    },
    ...overrides,
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

function taskRow(
  id,
  name,
  {
    persons = [],
    startDate = null,
    statusA = null,
    statusAText = '',
    dueDate = null,
    statusB = null,
    statusBText = '',
  } = {}
) {
  return {
    id,
    name,
    columns: {
      people_t: { text: '', statusLabelId: null, date: null, personIds: persons },
      date_start: { text: '', statusLabelId: null, date: startDate, personIds: [] },
      status_a: { text: statusAText, statusLabelId: statusA, date: null, personIds: [] },
      date_due: { text: '', statusLabelId: null, date: dueDate, personIds: [] },
      status_b: { text: statusBText, statusLabelId: statusB, date: null, personIds: [] },
    },
  };
}

describe('digestTaskColumnIds', () => {
  it('collects people + every section date + every referenced button status column, deduped', () => {
    const ids = digestTaskColumnIds(baseConfig());
    expect([...ids].sort()).toEqual(['date_due', 'date_start', 'people_t', 'status_a', 'status_b']);
  });
});

describe('buildDigest — show-by-status classification', () => {
  it('overdue date + status in the include set → pending; full recipient contract shape (with dateColumnTitle)', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה כהן', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [
        taskRow('9001', 'גיבוש תכנית עבודה', {
          persons: ['501'],
          startDate: '2026-07-10',
          statusA: 0, // in include set [0]
          statusAText: 'בעבודה',
        }),
        taskRow('9002', 'הגשת דוח רבעוני', {
          persons: ['501'],
          dueDate: '2026-07-01',
          statusB: 0, // in include set [0] ("בעבודה" — not done)
          statusBText: 'בעבודה',
        }),
      ],
      today: TODAY,
    });

    expect(result.skippedUsers).toEqual([]);
    expect(result.recipients).toEqual([
      {
        email: 'dana@example.com',
        name: 'דנה כהן',
        personIds: ['501'],
        taskCount: 2,
        sections: [
          {
            sectionId: 's_start001',
            title: 'משימות שנדרש להתחיל וטרם התחילו:',
            dateColumnTitle: 'תאריך התחלה',
            buttonId: 'b_start001',
            tasks: [{ itemId: '9001', name: 'גיבוש תכנית עבודה', date: '2026-07-10', statusText: 'בעבודה' }],
          },
          {
            sectionId: 's_done0001',
            title: 'משימות שנדרש לסיים וטרם בוצעו:',
            dateColumnTitle: 'תאריך סיום',
            buttonId: 'b_done0001',
            tasks: [{ itemId: '9002', name: 'הגשת דוח רבעוני', date: '2026-07-01', statusText: 'בעבודה' }],
          },
        ],
      },
    ]);
  });

  it('THE BUG FIX: an overdue task already "בוצע" (status NOT in the include set) is excluded', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [
        taskRow('9002', 'כבר בוצע', { persons: ['501'], dueDate: '2026-07-01', statusB: 1, statusBText: 'בוצע' }),
      ],
      today: TODAY,
    });
    expect(result.recipients).toEqual([]);
  });

  it('include set with label id 0 works (falsy trap) — status_a === 0 IS matched', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [taskRow('9001', 'לא התחיל', { persons: ['501'], startDate: '2026-07-10', statusA: 0 })],
      today: TODAY,
    });
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].sections[0].tasks.map((t) => t.itemId)).toEqual(['9001']);
  });

  it('status NOT in the include set → excluded (e.g. status_a === 1 when include is [0])', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [taskRow('9001', 'כבר בעבודה', { persons: ['501'], startDate: '2026-07-10', statusA: 1 })],
      today: TODAY,
    });
    expect(result.recipients).toEqual([]);
  });

  it('unset status (null) matches no include set → excluded', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [taskRow('9001', 'בלי סטטוס', { persons: ['501'], startDate: '2026-07-10', statusA: null })],
      today: TODAY,
    });
    expect(result.recipients).toEqual([]);
  });

  it('a date EQUAL to today counts as passed (past includes today)', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [taskRow('9001', 'היום', { persons: ['501'], startDate: TODAY, statusA: 0 })],
      today: TODAY,
    });
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].sections[0].tasks.map((t) => t.itemId)).toEqual(['9001']);
  });

  it('a FUTURE date / unset date → not pending', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [
        taskRow('9001', 'עתידי', { persons: ['501'], startDate: '2026-08-01', statusA: 0 }),
        taskRow('9002', 'בלי תאריך', { persons: ['501'], startDate: null, statusA: 0 }),
      ],
      today: TODAY,
    });
    expect(result.recipients).toEqual([]);
  });

  it('a section with no matching tasks is omitted from the recipient', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' })],
      tasks: [taskRow('9002', 'רק סיום', { persons: ['501'], dueDate: '2026-07-01', statusB: 0 })],
      today: TODAY,
    });
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].sections.map((s) => s.sectionId)).toEqual(['s_done0001']);
    expect(result.recipients[0].taskCount).toBe(1);
  });
});

describe('buildDigest — user matching', () => {
  it('task with two persons appears in BOTH users’ digests; unmatched user gets none', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'יוסי', { persons: ['502'], email: 'yossi@example.com' }),
        userRow('u3', 'בלי משימות', { persons: ['503'], email: 'idle@example.com' }),
      ],
      tasks: [taskRow('9001', 'משותפת', { persons: ['501', '502'], startDate: '2026-07-10', statusA: 0 })],
      today: TODAY,
    });
    expect(result.recipients.map((r) => r.email).sort()).toEqual(['dana@example.com', 'yossi@example.com']);
    for (const r of result.recipients) {
      expect(r.sections[0].tasks.map((t) => t.itemId)).toEqual(['9001']);
    }
  });

  it('user rows without email / without persons land in skippedUsers with a reason', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [
        userRow('u1', 'בלי מייל', { persons: ['501'], email: '   ' }),
        userRow('u2', 'בלי איש', { persons: [], email: 'x@example.com' }),
      ],
      tasks: [taskRow('9001', 'מ', { persons: ['501'], startDate: '2026-07-10', statusA: 0 })],
      today: TODAY,
    });
    expect(result.recipients).toEqual([]);
    expect(result.skippedUsers).toEqual([
      { itemId: 'u1', name: 'בלי מייל', reason: 'no_email' },
      { itemId: 'u2', name: 'בלי איש', reason: 'no_person' },
    ]);
  });

  it('duplicate email rows merge into ONE recipient (person ids united)', () => {
    const result = buildDigest({
      config: baseConfig(),
      users: [
        userRow('u1', 'דנה', { persons: ['501'], email: 'dana@example.com' }),
        userRow('u2', 'דנה (כפולה)', { persons: ['599'], email: 'dana@example.com' }),
      ],
      tasks: [
        taskRow('9001', 'של 501', { persons: ['501'], startDate: '2026-07-10', statusA: 0 }),
        taskRow('9002', 'של 599', { persons: ['599'], startDate: '2026-07-10', statusA: 0 }),
      ],
      today: TODAY,
    });
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0].email).toBe('dana@example.com');
    expect(result.recipients[0].sections[0].tasks.map((t) => t.itemId).sort()).toEqual(['9001', '9002']);
  });
});
