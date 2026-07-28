import { describe, it, expect } from 'vitest';
import { clampTopicWords, splitTopicNameLines } from '../topicName.js';

// round303 — the owner's topic-name rules: a ribbon line holds at most 3 words OR
// 16 characters (whichever is hit first), overflow wraps automatically, and a
// topic name can never hold more than 6 words.

describe('clampTopicWords — the 6-word ceiling', () => {
  it('keeps a short name as-is', () => {
    expect(clampTopicWords('תקציב שנתי')).toEqual({ name: 'תקציב שנתי', clamped: false });
  });

  it('keeps exactly 6 words untouched', () => {
    const six = 'אחת שתיים שלוש ארבע חמש שש';
    expect(clampTopicWords(six)).toEqual({ name: six, clamped: false });
  });

  it('drops the 7th word onward and reports it', () => {
    const res = clampTopicWords('אחת שתיים שלוש ארבע חמש שש שבע שמונה');
    expect(res).toEqual({ name: 'אחת שתיים שלוש ארבע חמש שש', clamped: true });
  });

  it('normalizes stray whitespace while counting', () => {
    expect(clampTopicWords('  תקציב   שנתי  ')).toEqual({ name: 'תקציב שנתי', clamped: false });
  });

  it('tolerates empty / nullish input', () => {
    expect(clampTopicWords('')).toEqual({ name: '', clamped: false });
    expect(clampTopicWords(null)).toEqual({ name: '', clamped: false });
  });
});

describe('splitTopicNameLines — 3 words / 16 chars per line, the smaller wins', () => {
  it('a short name stays on one line', () => {
    expect(splitTopicNameLines('תקציב שנתי')).toEqual(['תקציב שנתי']);
  });

  it('breaks on the WORD budget: the 4th word starts line 2 even when chars still fit', () => {
    // "אב גד הו זח" = 11 chars — under 16 — but 4 words.
    expect(splitTopicNameLines('אב גד הו זח')).toEqual(['אב גד הו', 'זח']);
  });

  it('breaks on the CHAR budget: 2 long words exceed 16 chars, so the 3-word allowance is cut short', () => {
    // "אינטגרציות ארגוניות" = 10 + 1 + 9 = 20 chars.
    expect(splitTopicNameLines('אינטגרציות ארגוניות רבעון')).toEqual(['אינטגרציות', 'ארגוניות רבעון']);
  });

  it('a 6-word name fills exactly two lines', () => {
    expect(splitTopicNameLines('אחת שתיים שלוש ארבע חמש שש')).toEqual(['אחת שתיים שלוש', 'ארבע חמש שש']);
  });

  it('never cuts a word mid-word: a single over-budget word owns its line', () => {
    const long = 'אינטרדיסציפלינריות'; // 18 chars > 16
    expect(splitTopicNameLines(`${long} קצר`)).toEqual([long, 'קצר']);
  });

  it('counts the joining space against the char budget', () => {
    // 8 + 1 + 8 = 17 > 16 ⇒ must break, even though each word alone fits.
    expect(splitTopicNameLines('אבגדהוזח אבגדהוזח')).toEqual(['אבגדהוזח', 'אבגדהוזח']);
  });

  it('returns [] for empty input', () => {
    expect(splitTopicNameLines('')).toEqual([]);
    expect(splitTopicNameLines('   ')).toEqual([]);
  });
});
