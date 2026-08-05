// TDD red phase (0.14.0) — the admin-side block helpers.
//
// `insertAt` is the whole "הוסף שם משתמש" button: a controlled textarea/input
// resets the caret on every re-render, so the caller needs to be told where the
// caret belongs, and a defensive clamp is what keeps an unfocused field (null
// selection, coerced by the caller into a length) from throwing or truncating.
//
// applyTokens / legacyBlocksFromSections are asserted against the SERVER module
// in tests/digest-blocks-client-drift.test.js — this file pins the behavior the
// editor itself depends on.

import { describe, it, expect } from 'vitest';
import { NAME_TOKEN, applyTokens, hasNameToken, insertAt } from './digest-blocks';

describe('insertAt', () => {
  it('inserts at the caret in the middle of the text', () => {
    // caret at index 5 — right after "שלום " and before the comma
    expect(insertAt('שלום , מה נשמע', 5, 5)).toEqual({
      text: `שלום ${NAME_TOKEN}, מה נשמע`,
      caret: 5 + NAME_TOKEN.length,
    });
  });

  it('REPLACES a selection rather than inserting beside it', () => {
    expect(insertAt('שלום דנה', 5, 8).text).toBe(`שלום ${NAME_TOKEN}`);
  });

  it('appends at the end', () => {
    const out = insertAt('שלום ', 5, 5);
    expect(out.text).toBe(`שלום ${NAME_TOKEN}`);
    expect(out.caret).toBe(out.text.length);
  });

  it('inserts into an empty field', () => {
    expect(insertAt('', 0, 0)).toEqual({ text: NAME_TOKEN, caret: NAME_TOKEN.length });
  });

  it('appends when the caret is unknown (an unfocused field reports none)', () => {
    const text = 'שלום';
    expect(insertAt(text, Number.NaN, Number.NaN).text).toBe(`שלום${NAME_TOKEN}`);
  });

  it('clamps a caret past the end instead of producing a gap', () => {
    expect(insertAt('אב', 99, 99).text).toBe(`אב${NAME_TOKEN}`);
  });

  it('clamps a negative caret to the start', () => {
    expect(insertAt('אב', -5, -5).text).toBe(`${NAME_TOKEN}אב`);
  });

  it('tolerates a backwards selection (end before start) without losing text', () => {
    expect(insertAt('אבגד', 3, 1).text).toBe(`אבג${NAME_TOKEN}ד`);
  });

  it('can insert any token, not only the name one', () => {
    expect(insertAt('אב', 1, 1, 'X').text).toBe('אXב');
  });
});

describe('hasNameToken', () => {
  it.each([
    ['שלום {{שם}}', true],
    ['Hello {{name}}', true],
    ['{{ שם }}', true],
    ['בלי טוקן', false],
    ['{{מחלקה}}', false],
  ])('%j → %s', (text, expected) => {
    expect(hasNameToken(text)).toBe(expected);
  });

  it('is not stateful across calls (a lastIndex leak would flip every other call)', () => {
    expect(hasNameToken('שלום {{שם}}')).toBe(true);
    expect(hasNameToken('שלום {{שם}}')).toBe(true);
  });
});

describe('applyTokens — what the preview shows', () => {
  it('resolves the token for the previewed recipient', () => {
    expect(applyTokens('המשימות של {{שם}}', { name: 'דנה כהן' })).toBe('המשימות של דנה כהן');
  });

  it('strips CR/LF, because the same string fills the Subject header', () => {
    expect(applyTokens('נושא {{שם}}', { name: 'א\nב' })).toBe('נושא א ב');
  });

  it('leaves an unknown token visible instead of blanking it', () => {
    expect(applyTokens('{{מחלקה}}', { name: 'דנה' })).toBe('{{מחלקה}}');
  });
});
