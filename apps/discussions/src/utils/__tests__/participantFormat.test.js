import { describe, it, expect } from 'vitest';
import {
  resolveParticipantParts,
  formatParticipantLabel,
  formatParticipantLabels,
  isKnownPartKey,
  partCustomFieldId,
} from '../participantFormat.js';
import {
  DEFAULT_EXPORT_TEMPLATE,
  DEFAULT_PARTICIPANT_PARTS,
  DEFAULT_PARTICIPANT_SEPARATOR,
} from '../mondayApi/boards.config.js';

/*
 * round315 (owner request) — a participant in the export is composed of ORDERED
 * parts taken from the monday user profile (name / Title / account custom fields),
 * each with the separator that precedes it. These are the composition rules; the
 * renderer only decides where the resulting strings go.
 */

const IDO = {
  id: '1',
  name: 'עידו פיוטרקובסקי',
  title: 'מנהל מחלקת מכירות',
  customFields: { 750658: 'מר', 999: '  ' },
};
const NO_TITLE = { id: '2', name: 'דנה כהן', title: '', customFields: {} };

// round319 — the composition moved off the participants ROW onto the template's one
// people setting; the row itself now carries only label/enabled.
const shippedPeople = () => DEFAULT_EXPORT_TEMPLATE.people;

describe('the shipped default composition', () => {
  it('is the NAME alone, so an untouched instance exports exactly as before', () => {
    expect(DEFAULT_PARTICIPANT_PARTS.map((p) => p.key)).toEqual(['name']);
    expect(formatParticipantLabel(IDO, DEFAULT_PARTICIPANT_PARTS)).toBe('עידו פיוטרקובסקי');
  });

  it('is what the default template ships as its ONE people setting', () => {
    const people = shippedPeople();
    expect(people.perLine).toBe(false);
    expect(resolveParticipantParts(people).map((p) => p.key)).toEqual(['name']);
  });
});

describe('resolveParticipantParts', () => {
  it('falls back to the default for a template written before this round (no parts)', () => {
    expect(resolveParticipantParts({ key: 'participantsText', label: 'משתתפים' }))
      .toEqual(DEFAULT_PARTICIPANT_PARTS);
    expect(resolveParticipantParts(undefined)).toEqual(DEFAULT_PARTICIPANT_PARTS);
  });

  it('falls back to the default when the owner unchecked everything', () => {
    expect(resolveParticipantParts({ parts: [] })).toEqual(DEFAULT_PARTICIPANT_PARTS);
  });

  it('keeps the stored order and separators', () => {
    // round357 — ' — ' was the offered 'מקף' until that round and is mapped forward to
    // the short dash that replaced it (see participantLines.round357.test.js); every
    // other stored separator is kept verbatim, which is what this case pins.
    const parts = resolveParticipantParts({ parts: [{ key: 'title', sep: ' · ' }, { key: 'name', sep: ', ' }] });
    expect(parts).toEqual([{ key: 'title', sep: ' · ' }, { key: 'name', sep: ', ' }]);
  });

  it('defaults a missing separator instead of writing "undefined" into the document', () => {
    expect(resolveParticipantParts({ parts: [{ key: 'name' }] })[0].sep).toBe(DEFAULT_PARTICIPANT_SEPARATOR);
  });

  it('drops an unknown part key rather than rendering it as itself', () => {
    expect(resolveParticipantParts({ parts: [{ key: 'name' }, { key: 'phone' }, { key: 'cf:' }] })
      .map((p) => p.key)).toEqual(['name']);
  });

  it('recognises a custom-field part and its meta id', () => {
    expect(isKnownPartKey('cf:750658')).toBe(true);
    expect(isKnownPartKey('cf:')).toBe(false);
    expect(isKnownPartKey('location')).toBe(false);
    expect(partCustomFieldId('cf:750658')).toBe('750658');
    expect(partCustomFieldId('title')).toBe('');
  });
});

describe('formatParticipantLabel — one participant', () => {
  it("composes the owner's example: custom field, name, then Title", () => {
    const parts = [
      { key: 'cf:750658', sep: ', ' },
      { key: 'name', sep: ' ' },
      { key: 'title', sep: ', ' },
    ];
    expect(formatParticipantLabel(IDO, parts)).toBe('מר עידו פיוטרקובסקי, מנהל מחלקת מכירות');
  });

  it('honours the order — Title first reads Title first', () => {
    const parts = [{ key: 'title', sep: ', ' }, { key: 'name', sep: ', ' }];
    expect(formatParticipantLabel(IDO, parts)).toBe('מנהל מחלקת מכירות, עידו פיוטרקובסקי');
  });

  it('uses the separator of the part it PRECEDES, and never one before the first', () => {
    const parts = [{ key: 'name', sep: ' – ' }, { key: 'title', sep: ' – ' }];
    expect(formatParticipantLabel(IDO, parts)).toBe('עידו פיוטרקובסקי – מנהל מחלקת מכירות');
  });

  it('supports an EMPTY separator (two parts glued together)', () => {
    const parts = [{ key: 'cf:750658', sep: '' }, { key: 'name', sep: '' }];
    expect(formatParticipantLabel(IDO, parts)).toBe('מרעידו פיוטרקובסקי');
  });

  it('skips a part the profile has no value for — no dangling separator', () => {
    const parts = [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }];
    expect(formatParticipantLabel(NO_TITLE, parts)).toBe('דנה כהן');
  });

  it('treats a whitespace-only custom field as missing', () => {
    const parts = [{ key: 'cf:999', sep: ', ' }, { key: 'name', sep: ' ' }];
    expect(formatParticipantLabel(IDO, parts)).toBe('עידו פיוטרקובסקי');
  });

  it('trims the profile values so a stray space cannot double a separator', () => {
    const person = { name: '  דנה כהן ', title: ' מנהלת ', customFields: {} };
    expect(formatParticipantLabel(person, [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }]))
      .toBe('דנה כהן, מנהלת');
  });

  it('falls back to the NAME when nothing else resolved — a participant is never dropped', () => {
    expect(formatParticipantLabel(NO_TITLE, [{ key: 'title', sep: ', ' }])).toBe('דנה כהן');
    expect(formatParticipantLabel(NO_TITLE, [{ key: 'cf:750658', sep: ', ' }])).toBe('דנה כהן');
  });

  it('yields nothing for a person with no name and no values (rather than a blank line)', () => {
    expect(formatParticipantLabel({ id: '9', name: '', title: '', customFields: {} }, [{ key: 'title', sep: ', ' }])).toBe('');
  });
});

describe('formatParticipantLabels — the list', () => {
  it('formats every person in order and drops the empty ones', () => {
    const parts = [{ key: 'name', sep: ', ' }, { key: 'title', sep: ', ' }];
    const out = formatParticipantLabels([IDO, NO_TITLE, { name: '', title: '' }], parts);
    expect(out).toEqual(['עידו פיוטרקובסקי, מנהל מחלקת מכירות', 'דנה כהן']);
  });

  it('tolerates a non-array (a model built without participants)', () => {
    expect(formatParticipantLabels(undefined, DEFAULT_PARTICIPANT_PARTS)).toEqual([]);
  });
});
