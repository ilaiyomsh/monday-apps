// Settings export/import + the legacy dateColumnTitle backfill.
//
// WHY THE BACKFILL EXISTS (production incident 2026-07-27):
// 0.7.1 made reading a pre-0.6.0 config non-throwing by defaulting a missing
// section.dateColumnTitle to ''. But the SERVER requires that field to be a
// NON-EMPTY string (admin-api validateConfig; pinned by
// tests/admin-api-digest.test.js "section missing dateColumnTitle"). So every
// save of a legacy config was rejected with an opaque 400 invalid_config while
// the panel looked complete — digestIsComplete does not check the title, and
// the date dropdown still *displays* one because it renders from dateColumnId.
// Result: the operator could not save at all, and the digest kept using the old
// stored config, so the preview showed nothing.
//
// The fix belongs on the client: derive the title from the selected column
// rather than trusting the stored copy. Relaxing the server would mean
// weakening a locked test and letting header-less sections into storage.

import { describe, it, expect } from 'vitest';
import { backfillDateColumnTitles, buildSettingsExport, parseSettingsImport } from './settings-io';
import type { DigestDraft } from './draft';
import type { BoardColumn } from './types';

const COLUMNS: BoardColumn[] = [
  { id: 'date4', title: 'תאריך התחלה', type: 'date', labels: [] },
  { id: 'date_mm591808', title: 'תאריך סיום', type: 'date', labels: [] },
  { id: 'status', title: 'סטטוס', type: 'status', labels: [] },
];

const section = (over: Partial<DigestDraft['sections'][number]> = {}) => ({
  id: 's_aaaaaaaa',
  title: 'משימות שנדרש להתחיל',
  dateColumnId: 'date4',
  dateColumnTitle: 'תאריך התחלה',
  noteColumnId: null,
  noteColumnTitle: '',
  buttonId: 'b_start001',
  buttonIds: ['b_start001'],
  includeStatusLabelIds: [3],
  ...over,
});

const digest = (sections: DigestDraft['sections']): DigestDraft => ({
  enabled: true,
  usersBoardId: '18422783851',
  usersPeopleColumnId: 'person',
  usersEmailColumnId: 'email_mm5d3357',
  subject: 'המשימות שלך — נדרש עדכון סטטוס',
  sendHour: 8,
  sections,
});

describe('backfillDateColumnTitles', () => {
  it('fills an empty title from the selected column — the legacy-config case that blocked saving', () => {
    const out = backfillDateColumnTitles(digest([section({ dateColumnTitle: '' })]), COLUMNS);
    expect(out.sections[0].dateColumnTitle).toBe('תאריך התחלה');
  });

  it('fills a whitespace-only title too (still rejected by the server)', () => {
    const out = backfillDateColumnTitles(digest([section({ dateColumnTitle: '   ' })]), COLUMNS);
    expect(out.sections[0].dateColumnTitle).toBe('תאריך התחלה');
  });

  it('falls back to a generic header when the column is unknown, so saving is never blocked', () => {
    // columns may not have loaded yet, or the column was deleted from the board
    const out = backfillDateColumnTitles(digest([section({ dateColumnTitle: '', dateColumnId: 'gone' })]), COLUMNS);
    expect(out.sections[0].dateColumnTitle).toBe('תאריך');
  });

  it('leaves a title the operator actually chose untouched', () => {
    const out = backfillDateColumnTitles(digest([section({ dateColumnTitle: 'דדליין' })]), COLUMNS);
    expect(out.sections[0].dateColumnTitle).toBe('דדליין');
  });

  it('does not mutate the input digest', () => {
    const input = digest([section({ dateColumnTitle: '' })]);
    backfillDateColumnTitles(input, COLUMNS);
    expect(input.sections[0].dateColumnTitle).toBe('');
  });

  it('leaves every other field of the digest alone', () => {
    const input = digest([section({ dateColumnTitle: '' })]);
    const out = backfillDateColumnTitles(input, COLUMNS);
    expect(out.subject).toBe(input.subject);
    expect(out.usersBoardId).toBe(input.usersBoardId);
    expect(out.sections[0].includeStatusLabelIds).toEqual([3]);
    expect(out.sections[0].buttonId).toBe('b_start001');
  });
});

describe('buildSettingsExport', () => {
  const saved = { boardId: '18422078964', peopleColumnId: 'person', buttons: [], templates: [] };
  const draft = { boardId: '18422078964', peopleColumnId: 'person', buttons: [], templates: [], digest: digest([section()]) };

  it('carries BOTH the saved config and the on-screen draft — the diff is the bug', () => {
    const out = buildSettingsExport({ savedConfig: saved, draft, appVersion: '0.7.4', now: '2026-07-27T09:00:00.000Z' });
    expect(out.savedConfig).toEqual(saved);
    expect(out.draft).toEqual(draft);
  });

  it('stamps app, version and time so an exported file is self-identifying', () => {
    const out = buildSettingsExport({ savedConfig: saved, draft, appVersion: '0.7.4', now: '2026-07-27T09:00:00.000Z' });
    expect(out.app).toBe('deadline-confirm');
    expect(out.appVersion).toBe('0.7.4');
    expect(out.exportedAt).toBe('2026-07-27T09:00:00.000Z');
  });

  it('tolerates a missing saved config (account never saved anything)', () => {
    const out = buildSettingsExport({ savedConfig: null, draft, appVersion: '0.7.4', now: 'T' });
    expect(out.savedConfig).toBeNull();
  });

  it('never carries a secret or a token, whatever is handed to it', () => {
    const dirty = { ...saved, linkSecret: 'super-secret', oauthToken: 'tok' } as never;
    const out = buildSettingsExport({ savedConfig: dirty, draft, appVersion: '0.7.4', now: 'T' });
    const text = JSON.stringify(out);
    expect(text).not.toContain('super-secret');
    expect(text).not.toContain('oauthToken');
  });
});

describe('parseSettingsImport', () => {
  const envelope = {
    app: 'deadline-confirm',
    appVersion: '0.7.4',
    exportedAt: 'T',
    savedConfig: null,
    draft: { boardId: '1', peopleColumnId: null, buttons: [], templates: [], digest: digest([section()]) },
  };

  it('accepts a file this app exported and returns its draft', () => {
    const out = parseSettingsImport(JSON.stringify(envelope));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.draft.boardId).toBe('1');
  });

  it('rejects a file exported by a different app instead of importing nonsense', () => {
    const out = parseSettingsImport(JSON.stringify({ ...envelope, app: 'some-other-app' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('אפליקציה');
  });

  it('rejects malformed JSON with a readable reason, never throws', () => {
    const out = parseSettingsImport('{not json');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.length).toBeGreaterThan(0);
  });

  it('rejects an envelope with no draft', () => {
    const out = parseSettingsImport(JSON.stringify({ ...envelope, draft: undefined }));
    expect(out.ok).toBe(false);
  });
});
