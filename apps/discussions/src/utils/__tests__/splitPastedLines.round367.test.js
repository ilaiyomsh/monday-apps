import { describe, it, expect } from 'vitest';
import { splitPastedLines } from '../splitPastedLines.js';

/*
 * round367 §1 — pasting a multi-line block into a point input creates one
 * point per line. The splitter is the pure core: split on newlines, trim,
 * drop empties, and strip common list markers (bullets / numbering) so a
 * list copied from a document lands as clean point names.
 */
describe('round367 — splitPastedLines', () => {
  it('splits on newlines (both \\n and \\r\\n), trims, and drops empty lines', () => {
    expect(splitPastedLines('נקודה ראשונה\r\nנקודה שנייה\n\n  נקודה שלישית  \n')).toEqual([
      'נקודה ראשונה', 'נקודה שנייה', 'נקודה שלישית',
    ]);
  });

  it('strips leading bullet markers and numbering', () => {
    expect(splitPastedLines('• סעיף אחד\n- סעיף שניים\n* סעיף שלוש\n1. סעיף ארבע\n2) סעיף חמש')).toEqual([
      'סעיף אחד', 'סעיף שניים', 'סעיף שלוש', 'סעיף ארבע', 'סעיף חמש',
    ]);
  });

  it('a single line (no newline) returns a single entry unchanged', () => {
    expect(splitPastedLines('נקודה בודדת')).toEqual(['נקודה בודדת']);
  });

  it('does NOT strip a dash that is part of the text (no space after marker)', () => {
    expect(splitPastedLines('-5 מעלות\nא-ב')).toEqual(['-5 מעלות', 'א-ב']);
  });

  it('garbage in → empty list (null, undefined, whitespace-only)', () => {
    expect(splitPastedLines(null)).toEqual([]);
    expect(splitPastedLines(undefined)).toEqual([]);
    expect(splitPastedLines('   \n  \n')).toEqual([]);
  });
});
