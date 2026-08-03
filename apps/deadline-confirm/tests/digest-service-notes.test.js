// TDD — buildDigest carries each cluster's note-column mapping into the
// rendered section. Without it the renderer cannot know a text field is due,
// and the requirement would silently vanish between config and email.

import { describe, it, expect } from 'vitest';
import { buildDigest, decorateRecipientSections } from '../src/services/digest-service.js';

const BUTTON = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'status_a',
  targetIndex: 2,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};

const config = (sectionOver = {}) => ({
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
        ...sectionOver,
      },
    ],
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
];

const USERS = [
  {
    id: 'u1',
    name: 'דנה כהן',
    columns: {
      people_u: { text: 'דנה', statusLabelId: null, date: null, personIds: ['501'] },
      email_u: { text: 'dana@example.com', statusLabelId: null, date: null, personIds: [] },
    },
  },
];

const run = (sectionOver) =>
  buildDigest({ config: config(sectionOver), tasks: TASKS, users: USERS, today: '2026-08-03' });

describe('buildDigest — note column on a section', () => {
  it('copies noteColumnId and noteColumnTitle onto the rendered section', () => {
    const { recipients } = run({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' });
    expect(recipients[0].sections[0]).toMatchObject({
      noteColumnId: 'text_note',
      noteColumnTitle: 'סיכום ביצוע',
    });
  });

  it('an unmapped section reports null/empty rather than undefined', () => {
    const { recipients } = run();
    expect(recipients[0].sections[0].noteColumnId).toBeNull();
    expect(recipients[0].sections[0].noteColumnTitle).toBe('');
  });

  it('the mapping survives decorateRecipientSections (the renderers read the decorated shape)', () => {
    const { recipients } = run({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' });
    const decorated = decorateRecipientSections(recipients[0], new Map([[BUTTON.id, BUTTON]]));
    expect(decorated.sections[0].noteColumnId).toBe('text_note');
    expect(decorated.sections[0].noteColumnTitle).toBe('סיכום ביצוע');
  });
});
