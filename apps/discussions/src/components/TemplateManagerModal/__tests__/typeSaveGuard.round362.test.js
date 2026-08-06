import { describe, it, expect } from 'vitest';
import { canSaveType, cleanTypeTopics } from '../typeSaveGuard.js';

/*
 * round362 (owner, with screenshot) — the export .docx saved fine on types that
 * ALREADY have a template (trash+pencil rows) and silently vanished on
 * template-less types ("ללא תבנית — הקליקו להגדרה"). Root cause: the type editor's
 * save gate required CONTENT (a non-blank topic or any person), and a
 * template-less type opens with one blank seeded topic — so uploading only a
 * file (or picking only a color, or only flipping מחליט=מוביל) left the save
 * button disabled and the whole save silently skipped. The gate must also accept
 * a type whose ONLY configuration is its export template, color, or decider
 * default.
 *
 * cleanTypeTopics guards the flip side: an export-only save must not persist the
 * blank seeded topic row as a real agenda item.
 */

const draftWith = (names) => ({
  discussionType: 'אסטרטגיה',
  topics: names.map((n) => ({ _uid: n || 'blank', name: n, points: [] })),
});

const BASE = {
  draft: draftWith(['']), // the blank row every template-less type opens with
  lead: [],
  coordinator: [],
  participants: [],
  exportDirty: false,
  colorDraft: null,
  storedColor: null,
  deciderIsLead: false,
  storedDeciderIsLead: false,
};

describe('round362 — canSaveType', () => {
  it('a pristine template-less type (blank seeded topic, nothing edited) is NOT savable', () => {
    expect(canSaveType(BASE)).toBe(false);
  });

  it('no draft at all is not savable regardless of edits', () => {
    expect(canSaveType({ ...BASE, draft: null, exportDirty: true })).toBe(false);
  });

  it('content still qualifies: a non-blank topic, or any person in any role', () => {
    expect(canSaveType({ ...BASE, draft: draftWith(['נושא']) })).toBe(true);
    expect(canSaveType({ ...BASE, lead: [{ id: 1 }] })).toBe(true);
    expect(canSaveType({ ...BASE, coordinator: [{ id: 2 }] })).toBe(true);
    expect(canSaveType({ ...BASE, participants: [{ id: 3 }] })).toBe(true);
  });

  it('an EXPORT-ONLY edit is savable — the owner\'s vanished .docx case', () => {
    expect(canSaveType({ ...BASE, exportDirty: true })).toBe(true);
  });

  it('a COLOR-ONLY change is savable, but an unchanged color is not an edit', () => {
    expect(canSaveType({ ...BASE, colorDraft: 'done-green', storedColor: null })).toBe(true);
    expect(canSaveType({ ...BASE, colorDraft: 'done-green', storedColor: 'done-green' })).toBe(false);
  });

  it('flipping מחליט=מוביל alone is savable, in both directions', () => {
    expect(canSaveType({ ...BASE, deciderIsLead: true })).toBe(true);
    expect(canSaveType({ ...BASE, deciderIsLead: false, storedDeciderIsLead: true })).toBe(true);
  });
});

describe('round362 — cleanTypeTopics', () => {
  it('drops the blank seeded row and whitespace-only names', () => {
    expect(cleanTypeTopics(draftWith(['', '  ']).topics)).toEqual([]);
  });

  it('keeps real topics, mapping points to their text', () => {
    const topics = [
      { _uid: 'a', name: 'נושא', points: [{ text: 'נק 1' }, { text: 'נק 2' }] },
      { _uid: 'b', name: '', points: [{ text: 'יתום' }] },
    ];
    expect(cleanTypeTopics(topics)).toEqual([{ name: 'נושא', points: ['נק 1', 'נק 2'] }]);
  });

  it('tolerates missing input', () => {
    expect(cleanTypeTopics(null)).toEqual([]);
  });
});
