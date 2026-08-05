// TDD — the note-column mapping survives the draft round-trip. The SPA edits a
// draft and PUTs a config; a field that is dropped anywhere along that path
// silently un-maps the column, and the requirement disappears from the next
// email with no error anywhere.

import { describe, it, expect } from 'vitest';
import {
  digestClusters,
  newDigestSection,
  digestFromConfig,
  draftToConfig,
  draftFromConfig,
} from './draft';
import type { ActionButton, AppConfig, DigestConfig } from './types';

const BUTTON: ActionButton = {
  id: 'b_done0001',
  name: 'סיימתי',
  statusColumnId: 'status_a',
  targetIndex: 2,
  targetLabel: 'בוצע',
  style: { color: '#00854d', icon: '✓', size: 'sm' },
};

const digestConfig = (over: Partial<DigestConfig['sections'][number]> = {}): DigestConfig => ({
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
      ...over,
    },
  ],
});

const appConfig = (digest: DigestConfig): AppConfig => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [BUTTON],
  templates: [],
  digest,
});

describe('newDigestSection', () => {
  it('starts with no note column mapped — the requirement is opt-in', () => {
    const section = newDigestSection('כותרת');
    expect(section.noteColumnId).toBeNull();
    expect(section.noteColumnTitle).toBe('');
  });
});

describe('digestFromConfig', () => {
  it('loads a mapped note column into the draft', () => {
    const draft = digestFromConfig(
      digestConfig({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' })
    );
    expect(digestClusters(draft)[0].noteColumnId).toBe('text_note');
    expect(digestClusters(draft)[0].noteColumnTitle).toBe('סיכום ביצוע');
  });

  it('backfills a config saved before the feature — null/empty, never undefined', () => {
    const draft = digestFromConfig(digestConfig());
    expect(digestClusters(draft)[0].noteColumnId).toBeNull();
    expect(digestClusters(draft)[0].noteColumnTitle).toBe('');
  });
});

describe('draftToConfig', () => {
  it('emits the mapping so the server can persist it', () => {
    const draft = draftFromConfig(
      appConfig(digestConfig({ noteColumnId: 'text_note', noteColumnTitle: 'סיכום ביצוע' }))
    );
    const config = draftToConfig(draft);
    expect(config?.digest?.sections[0].noteColumnId).toBe('text_note');
    expect(config?.digest?.sections[0].noteColumnTitle).toBe('סיכום ביצוע');
  });

  it('emits null for an unmapped section rather than omitting the key', () => {
    const config = draftToConfig(draftFromConfig(appConfig(digestConfig())));
    expect(config?.digest?.sections[0].noteColumnId).toBeNull();
    expect(config?.digest?.sections[0].noteColumnTitle).toBe('');
  });

  it('survives a full round-trip unchanged (config → draft → config)', () => {
    const original = appConfig(digestConfig({ noteColumnId: 'text_note', noteColumnTitle: 'הערה' }));
    const roundTripped = draftToConfig(draftFromConfig(original));
    expect(roundTripped?.digest?.sections[0]).toMatchObject({
      noteColumnId: 'text_note',
      noteColumnTitle: 'הערה',
    });
  });
});
