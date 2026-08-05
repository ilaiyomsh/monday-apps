import { describe, it, expect } from 'vitest';
import {
  formatParticipantSegments,
  formatParticipantLabel,
  resolveParticipantParts,
  recordMarker,
  resolveRecordMarker,
} from '../participantFormat.js';
import { PARTICIPANT_SEPARATORS } from '../mondayApi/boards.config.js';

/*
 * round357 (owner spec, approved off a before/after mockup):
 *
 * 1. THE SEPARATOR between a person's name and their title is short AND BOLD. Bold is
 *    not a property of the text — a .docx run carries it — so the composed line can no
 *    longer be one string. formatParticipantSegments returns the pieces with the
 *    separators flagged, and the renderer maps each to its own run. The plain-string
 *    formatParticipantLabel stays (the single-row form and the preview use it) and is
 *    derived from the same segments so the two can never drift.
 *
 * 2. THE RECORD MARKER is chosen PER people component (מוביל דיון / מרכז דיון /
 *    משתתפים): numbering, bullets, or nothing. Default is 'none' — today's export has
 *    no marker, and an upgrade must not restyle a document nobody asked to change.
 */

const PERSON = { name: 'גב׳ ליז עובדיה', title: 'מנכ״לית העירייה' };
const NAME_THEN_TITLE = [{ key: 'name' }, { key: 'title', sep: ' – ' }];

describe('round357 §1 — the name/title separator is its own bold segment', () => {
  it('splits the line into text and separator segments', () => {
    expect(formatParticipantSegments(PERSON, NAME_THEN_TITLE)).toEqual([
      { text: 'גב׳ ליז עובדיה', sep: false },
      { text: ' – ', sep: true },
      { text: 'מנכ״לית העירייה', sep: false },
    ]);
  });

  it('the joined string still matches the segments exactly', () => {
    const segs = formatParticipantSegments(PERSON, NAME_THEN_TITLE);
    expect(formatParticipantLabel(PERSON, NAME_THEN_TITLE)).toBe(segs.map((s) => s.text).join(''));
  });

  it('a missing part drops its separator with it — no dangling dash', () => {
    // The rule round315 established: someone without a Title may never export as
    // "עידו פיוטרקובסקי – ". With segments the risk is a leading/trailing sep run.
    const segs = formatParticipantSegments({ name: 'מר יוסי כהן' }, NAME_THEN_TITLE);
    expect(segs).toEqual([{ text: 'מר יוסי כהן', sep: false }]);
    expect(segs.some((s) => s.sep)).toBe(false);
  });

  it('falls back to the NAME when no chosen part resolves', () => {
    const segs = formatParticipantSegments(PERSON, [{ key: 'cf:999', sep: ' – ' }]);
    expect(segs).toEqual([{ text: 'גב׳ ליז עובדיה', sep: false }]);
  });

  it('never emits a separator first — the first part that produces text leads', () => {
    const segs = formatParticipantSegments({ title: 'גזבר' }, NAME_THEN_TITLE);
    expect(segs[0].sep).toBe(false);
    expect(segs).toEqual([{ text: 'גזבר', sep: false }]);
  });
});

describe('round357 §1 — the offered dash is the SHORT one', () => {
  it('the "מקף" option is an en dash, not the long em dash', () => {
    const dash = PARTICIPANT_SEPARATORS.find((s) => s.label === 'מקף');
    expect(dash.value).toBe(' – ');
    expect(PARTICIPANT_SEPARATORS.some((s) => s.value === ' — ')).toBe(false);
  });

  it('a template still holding the retired long dash resolves to the short one', () => {
    // The long dash was an OFFERED option until this round; a stored template carries
    // it. Leaving it would show a blank picker and keep exporting the old glyph, so the
    // retired value maps to its replacement.
    const parts = resolveParticipantParts({ parts: [{ key: 'name' }, { key: 'title', sep: ' — ' }] });
    expect(parts[1].sep).toBe(' – ');
  });

  it('a separator the owner chose on purpose is left alone', () => {
    const parts = resolveParticipantParts({ parts: [{ key: 'name' }, { key: 'title', sep: ', ' }] });
    expect(parts[1].sep).toBe(', ');
  });
});

describe('round357 §2 — the record marker is per component', () => {
  it('numbers count from 1 in document order', () => {
    expect(recordMarker('number', 0)).toBe('1.');
    expect(recordMarker('number', 2)).toBe('3.');
  });

  it('bullets are the same glyph for every record', () => {
    expect(recordMarker('bullet', 0)).toBe('•');
    expect(recordMarker('bullet', 7)).toBe('•');
  });

  it('none — and anything unrecognized — contributes no marker', () => {
    expect(recordMarker('none', 0)).toBe('');
    expect(recordMarker('bogus', 0)).toBe('');
    expect(recordMarker(undefined, 0)).toBe('');
  });

  it('a field without a marker setting keeps today\'s export: no marker', () => {
    expect(resolveRecordMarker({ key: 'participantsText' })).toBe('none');
    expect(resolveRecordMarker(null)).toBe('none');
  });

  it('each field carries its OWN marker — one component does not set another', () => {
    expect(resolveRecordMarker({ key: 'leadText', marker: 'bullet' })).toBe('bullet');
    expect(resolveRecordMarker({ key: 'participantsText', marker: 'number' })).toBe('number');
  });

  it('an unknown stored marker degrades to none rather than rendering itself', () => {
    expect(resolveRecordMarker({ marker: 'stars' })).toBe('none');
  });
});
