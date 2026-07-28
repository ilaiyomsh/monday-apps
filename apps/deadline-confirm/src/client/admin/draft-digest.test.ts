// v4 digest draft model — enabled-flag semantics: a DISABLED digest never
// blocks saving (payload digest: null); an ENABLED digest must be complete
// before draftToConfig resolves.

import { describe, it, expect } from 'vitest';
import {
  defaultDigestDraft,
  digestFromConfig,
  digestIsComplete,
  draftFromConfig,
  draftToConfig,
  newDigestSection,
  type ConfigDraft,
} from './draft';
import type { ActionButton, DigestConfig } from './types';

const BUTTON: ActionButton = {
  id: 'b_done0001',
  name: 'עדכן: בוצע',
  statusColumnId: 'status_b',
  targetIndex: 1,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'md' },
};

const DIGEST_CONFIG: DigestConfig = {
  usersBoardId: '222',
  usersPeopleColumnId: 'people_u',
  usersEmailColumnId: 'email_u',
  subject: 'המשימות שלך',
  sendHour: 8,
  sections: [
    {
      id: 's_done0001',
      title: 'לסיים:',
      dateColumnId: 'date_due',
      dateColumnTitle: 'תאריך סיום',
      buttonId: 'b_done0001',
      buttonIds: ['b_done0001'],
      includeStatusLabelIds: [0],
    },
  ],
};

function completeDraft(digest?: Partial<ConfigDraft['digest']>): ConfigDraft {
  return {
    boardId: '111',
    peopleColumnId: 'people_t',
    buttons: [BUTTON],
    templates: [],
    digest: { ...digestFromConfig(DIGEST_CONFIG), ...digest },
  };
}

describe('defaultDigestDraft', () => {
  it('starts disabled, with a default subject and the two mock sections (empty picks)', () => {
    const d = defaultDigestDraft();
    expect(d.enabled).toBe(false);
    expect(d.subject.length).toBeGreaterThan(0);
    expect(d.sendHour).toBe(8);
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0].id).toMatch(/^s_/);
    expect(d.sections[0].dateColumnId).toBeNull();
    expect(d.sections[0].dateColumnTitle).toBe('');
    expect(d.sections[0].buttonId).toBeNull();
    expect(d.sections[0].buttonIds).toEqual([]);
    expect(d.sections[0].includeStatusLabelIds).toEqual([]);
    // two distinct generated ids
    expect(d.sections[0].id).not.toBe(d.sections[1].id);
  });
});

describe('newDigestSection', () => {
  it('generates a fresh s_ id and empty picks', () => {
    const s = newDigestSection('כותרת');
    expect(s.id).toMatch(/^s_[A-Za-z0-9_-]{4,16}$/);
    expect(s.title).toBe('כותרת');
    expect(s.dateColumnId).toBeNull();
    expect(s.dateColumnTitle).toBe('');
    expect(s.buttonId).toBeNull();
    expect(s.buttonIds).toEqual([]);
    expect(s.includeStatusLabelIds).toEqual([]);
  });
});

describe('digestFromConfig / draftFromConfig', () => {
  it('a saved digest loads enabled with its fields', () => {
    const d = digestFromConfig(DIGEST_CONFIG);
    expect(d.enabled).toBe(true);
    expect(d.usersBoardId).toBe('222');
    expect(d.sendHour).toBe(8);
    expect(d.sections).toEqual([
      {
        id: 's_done0001',
        title: 'לסיים:',
        dateColumnId: 'date_due',
        dateColumnTitle: 'תאריך סיום',
        buttonId: 'b_done0001',
        buttonIds: ['b_done0001'],
        includeStatusLabelIds: [0],
      },
    ]);
  });

  it('legacy section with only buttonId (no buttonIds) fills buttonIds from buttonId', () => {
    const legacy: DigestConfig = {
      ...DIGEST_CONFIG,
      sections: [
        {
          id: 's_done0001',
          title: 'לסיים:',
          dateColumnId: 'date_due',
          dateColumnTitle: 'תאריך סיום',
          buttonId: 'b_done0001',
          includeStatusLabelIds: [0],
        },
      ],
    };
    const d = digestFromConfig(legacy);
    expect(d.sections[0].buttonIds).toEqual(['b_done0001']);
    expect(d.sections[0].buttonId).toBe('b_done0001');
    expect(digestIsComplete(d)).toBe(true);
  });

  it('a null/absent digest loads as the disabled default', () => {
    expect(digestFromConfig(null).enabled).toBe(false);
    expect(digestFromConfig(undefined).enabled).toBe(false);
    const draft = draftFromConfig({
      boardId: '111',
      peopleColumnId: 'people_t',
      buttons: [BUTTON],
      templates: [],
      digest: null,
    });
    expect(draft.digest.enabled).toBe(false);
  });
});

describe('digestIsComplete', () => {
  it('true for a fully-picked enabled digest', () => {
    expect(digestIsComplete(digestFromConfig(DIGEST_CONFIG))).toBe(true);
  });

  it('false when buttonIds is empty even if legacy buttonId is set', () => {
    const d = digestFromConfig(DIGEST_CONFIG);
    d.sections[0].buttonIds = [];
    d.sections[0].buttonId = 'b_done0001';
    expect(digestIsComplete(d)).toBe(false);
  });

  it.each([
    ['no users board', { usersBoardId: null }],
    ['no people column', { usersPeopleColumnId: null }],
    ['no email column', { usersEmailColumnId: null }],
    ['empty subject', { subject: '  ' }],
    ['no sections', { sections: [] }],
    ['section without date column', { sections: [{ id: 's_a1234', title: 'א', dateColumnId: null, dateColumnTitle: '', buttonId: 'b_done0001', buttonIds: ['b_done0001'], includeStatusLabelIds: [0] }] }],
    ['section without button', { sections: [{ id: 's_a1234', title: 'א', dateColumnId: 'd', dateColumnTitle: 'ת', buttonId: null, buttonIds: [], includeStatusLabelIds: [0] }] }],
    ['section with empty title', { sections: [{ id: 's_a1234', title: ' ', dateColumnId: 'd', dateColumnTitle: 'ת', buttonId: 'b_done0001', buttonIds: ['b_done0001'], includeStatusLabelIds: [0] }] }],
    ['section with no include statuses', { sections: [{ id: 's_a1234', title: 'א', dateColumnId: 'd', dateColumnTitle: 'ת', buttonId: 'b_done0001', buttonIds: ['b_done0001'], includeStatusLabelIds: [] }] }],
  ])('false when %s', (_name, patch) => {
    expect(digestIsComplete({ ...digestFromConfig(DIGEST_CONFIG), ...patch })).toBe(false);
  });
});

describe('draftToConfig digest resolution', () => {
  it('DISABLED digest → payload resolves with digest: null (never blocks saving)', () => {
    const payload = draftToConfig(completeDraft({ enabled: false, usersBoardId: null }));
    expect(payload).not.toBeNull();
    expect(payload?.digest).toBeNull();
  });

  it('ENABLED + complete → payload carries the digest config verbatim', () => {
    const payload = draftToConfig(completeDraft());
    expect(payload?.digest).toEqual(DIGEST_CONFIG);
  });

  it('ENABLED + incomplete → the whole payload is null (save disabled)', () => {
    expect(draftToConfig(completeDraft({ usersEmailColumnId: null }))).toBeNull();
  });
});
