// TDD — the per-task required-note core (owner ask 2026-08-03).
//
// A cluster may map a TEXT column on the tasks board. When it does, every task
// the reader marks in that cluster must carry a note, and that note is written
// to the mapped column. These are the pure rules the AMP route enforces; the
// client-side `[disabled]` binding is UX, this is the authority.

import { describe, it, expect } from 'vitest';
import {
  MAX_NOTE_LENGTH,
  extractNotes,
  resolveNoteColumn,
  classifyNote,
} from '../src/services/digest-notes.js';

const section = (over = {}) => ({
  id: 's_a0000001',
  title: 'להתחיל:',
  dateColumnId: 'date_start',
  dateColumnTitle: 'תאריך התחלה',
  buttonId: 'b_start001',
  buttonIds: ['b_start001'],
  includeStatusLabelIds: [0],
  noteColumnId: null,
  noteColumnTitle: '',
  ...over,
});

const configWith = (sections) => ({
  boardId: '111',
  peopleColumnId: 'people_t',
  buttons: [],
  digest: { usersBoardId: '222', subject: 's', sendHour: 8, sections },
});

describe('extractNotes', () => {
  it('reads note_<itemId> fields and ignores every other field', () => {
    const notes = extractNotes({
      a: '777',
      sig: 'xyz',
      item_9001: 'b_start001',
      note_9001: 'התחלתי אתמול',
      note_9002: 'ממתין לספק',
      notes_9003: 'not a note field',
      note_abc: 'not a numeric id',
    });
    expect([...notes.entries()]).toEqual([
      ['9001', 'התחלתי אתמול'],
      ['9002', 'ממתין לספק'],
    ]);
  });

  it('trims surrounding whitespace so a space-only note counts as empty', () => {
    const notes = extractNotes({ note_9001: '   ', note_9002: '  ok  ' });
    expect(notes.get('9001')).toBe('');
    expect(notes.get('9002')).toBe('ok');
  });

  it('takes the first non-empty value when a field arrives repeated (array body)', () => {
    const notes = extractNotes({ note_9001: ['', 'שני', 'שלישי'] });
    expect(notes.get('9001')).toBe('שני');
  });

  it('ignores non-string values rather than stringifying them', () => {
    const notes = extractNotes({ note_9001: 42, note_9002: { a: 1 } });
    expect(notes.size).toBe(0);
  });

  it('returns an empty map for a body with no note fields', () => {
    expect(extractNotes({ item_1: 'b_x' }).size).toBe(0);
  });
});

describe('resolveNoteColumn', () => {
  it('returns the mapped column of the section that offers the selected button', () => {
    const config = configWith([
      section(),
      section({
        id: 's_b0000002',
        buttonId: 'b_done0001',
        buttonIds: ['b_done0001'],
        noteColumnId: 'text_done',
        noteColumnTitle: 'סיכום ביצוע',
      }),
    ]);
    expect(resolveNoteColumn(config, 'b_done0001')).toEqual({
      id: 'text_done',
      title: 'סיכום ביצוע',
    });
  });

  it('returns null for a button whose section maps no text column', () => {
    const config = configWith([section({ noteColumnId: 'text_x', noteColumnTitle: 'הערה' }), section({ id: 's_b0000002', buttonId: 'b_done0001', buttonIds: ['b_done0001'] })]);
    expect(resolveNoteColumn(config, 'b_done0001')).toBeNull();
  });

  it('matches ANY button of a multi-button cluster, not only the primary', () => {
    const config = configWith([
      section({
        buttonId: 'b_start001',
        buttonIds: ['b_start001', 'b_hold0001'],
        noteColumnId: 'text_note',
        noteColumnTitle: 'הערה',
      }),
    ]);
    expect(resolveNoteColumn(config, 'b_hold0001')?.id).toBe('text_note');
  });

  it('falls back to the legacy singular buttonId when buttonIds is absent', () => {
    const legacy = section({ buttonIds: undefined, noteColumnId: 'text_note', noteColumnTitle: 'הערה' });
    delete legacy.buttonIds;
    expect(resolveNoteColumn(configWith([legacy]), 'b_start001')?.id).toBe('text_note');
  });

  it('takes the FIRST mapping when a button is shared by two mapped clusters', () => {
    const config = configWith([
      section({ noteColumnId: 'text_first', noteColumnTitle: 'ראשון' }),
      section({ id: 's_b0000002', noteColumnId: 'text_second', noteColumnTitle: 'שני' }),
    ]);
    expect(resolveNoteColumn(config, 'b_start001')?.id).toBe('text_first');
  });

  it('returns null for an unknown button, and for a config with no digest', () => {
    expect(resolveNoteColumn(configWith([section({ noteColumnId: 'c', noteColumnTitle: 't' })]), 'b_nope')).toBeNull();
    expect(resolveNoteColumn({ boardId: '1', digest: null }, 'b_start001')).toBeNull();
    expect(resolveNoteColumn(null, 'b_start001')).toBeNull();
  });
});

describe('classifyNote', () => {
  const column = { id: 'text_note', title: 'הערה' };

  it('is ok when the cluster maps no column — nothing is required and nothing is written', () => {
    expect(classifyNote({ column: null, value: '' })).toBe('ok');
    expect(classifyNote({ column: null, value: 'typed anyway' })).toBe('ok');
  });

  it('refuses an empty note when the cluster maps a column', () => {
    expect(classifyNote({ column, value: '' })).toBe('note_required');
  });

  it('accepts a filled note, including one exactly at the length limit', () => {
    expect(classifyNote({ column, value: 'ok' })).toBe('ok');
    expect(classifyNote({ column, value: 'x'.repeat(MAX_NOTE_LENGTH) })).toBe('ok');
  });

  it('refuses one character past the limit', () => {
    expect(classifyNote({ column, value: 'x'.repeat(MAX_NOTE_LENGTH + 1) })).toBe('note_too_long');
  });

  it('the limit IS the spec value 500 — not merely self-consistent', () => {
    // Guards the constant itself: the symbolic assertions above move with the
    // constant, so without this pin a cap change slips through unnoticed.
    expect(MAX_NOTE_LENGTH).toBe(500);
    expect(classifyNote({ column, value: 'x'.repeat(501) })).toBe('note_too_long');
  });
});
