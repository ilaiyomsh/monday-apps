import { describe, it, expect } from 'vitest';
import { clampTopicWords, clampTopicName, displayTopicNameLines, splitTopicNameLines } from '../topicName.js';

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

describe('clampTopicName — 6 words AND at most 2 display lines (PR-review fix)', () => {
  it('keeps a name whose 6 words fit two lines', () => {
    const six = 'אחת שתיים שלוש ארבע חמש שש';
    expect(clampTopicName(six)).toEqual({ name: six, clamped: false });
  });

  it('drops words when 6 SHORT-line words would need more than two lines', () => {
    // Six 8-char words: pairs exceed 16 chars, so each line holds ONE word ⇒ six
    // lines — the exact case the review flagged. Accepting it would clip lines
    // 3-6 invisibly, so the name must be cut to what two lines can show.
    const name = 'אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח';
    const res = clampTopicName(name);
    expect(res.clamped).toBe(true);
    expect(res.name).toBe('אבגדהוזח אבגדהוזח');
    expect(splitTopicNameLines(res.name).length).toBeLessThanOrEqual(2);
  });

  it('every accepted name renders fully within two lines (the invariant itself)', () => {
    const inputs = [
      'תקציב', 'תקציב שנתי מפורט', 'אחת שתיים שלוש ארבע חמש שש',
      'אינטגרציות ארגוניות מורכבות ברבעון הקרוב מאוד',
      'אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח',
    ];
    for (const input of inputs) {
      const { name } = clampTopicName(input);
      expect(splitTopicNameLines(name).length).toBeLessThanOrEqual(2);
    }
  });

  it('never returns an empty name for non-empty input (a single word always survives)', () => {
    const { name } = clampTopicName('אינטרדיסציפלינריותמאודמאודארוכה');
    expect(name.length).toBeGreaterThan(0);
  });
});

describe('displayTopicNameLines — legacy names fold into two visible rows', () => {
  it('passes a compliant name through unchanged', () => {
    expect(displayTopicNameLines('תקציב שנתי')).toEqual(['תקציב שנתי']);
  });

  it('folds a pre-rule long name into two rows (row 2 carries the rest, ellipsized by CSS)', () => {
    const legacy = 'אבגדהוזח אבגדהוזח אבגדהוזח אבגדהוזח';
    const lines = displayTopicNameLines(legacy);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('אבגדהוזח');
    expect(lines[1]).toBe('אבגדהוזח אבגדהוזח אבגדהוזח');
  });
});
