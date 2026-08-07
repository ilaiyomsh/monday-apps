import { describe, it, expect } from 'vitest';
import {
  buildSections,
  countItems,
  matchesQuery,
  nextOrder,
  ORDER_ALPHA,
  ORDER_BOARD,
  DEFAULT_GROUP_COLOR,
  UNGROUPED_ID,
} from '../relationPickerModel.js';

/*
 * round378 — the picker panel is modelled on monday's "Choose items" dropdown
 * (owner screenshot). These tests pin the parts that decide what the panel LOOKS
 * like: which sections exist, in what order, with which colour, and what the
 * search and sort controls do to them.
 */

const CANDS = [
  { id: '1', name: 'ד פריט', group: { id: 'g1', title: 'קבוצה ראשונה', color: '#579bfc' } },
  { id: '2', name: 'א פריט', group: { id: 'g1', title: 'קבוצה ראשונה', color: '#579bfc' } },
  { id: '3', name: 'ב פריט', group: { id: 'g2', title: 'קבוצה שנייה', color: '#00c875' } },
];

describe('buildSections — the grouped layout monday shows', () => {
  it('splits the candidates into one section per group, carrying title and colour', () => {
    const sections = buildSections(CANDS);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ id: 'g1', title: 'קבוצה ראשונה', color: '#579bfc' });
    expect(sections[1]).toMatchObject({ id: 'g2', title: 'קבוצה שנייה', color: '#00c875' });
    expect(sections[0].items.map((i) => i.id)).toEqual(['1', '2']);
  });

  /*
   * Group order is FIRST APPEARANCE, which is monday's board order because
   * items_page walks the board group by group. Sorting sections by title would
   * silently reorder the board — here 'קבוצה שנייה' would come first.
   */
  it('orders the sections by board position, never by title', () => {
    const reversed = [CANDS[2], CANDS[0], CANDS[1]];
    expect(buildSections(reversed).map((s) => s.title)).toEqual(['קבוצה שנייה', 'קבוצה ראשונה']);
  });

  it('keeps the board order of items inside a section by default', () => {
    // '1' is 'ד' and '2' is 'א' — board order keeps ד first, alphabetical would not.
    expect(buildSections(CANDS, { order: ORDER_BOARD })[0].items.map((i) => i.name))
      .toEqual(['ד פריט', 'א פריט']);
  });

  it('sorts items inside each section when the alphabetical order is picked', () => {
    const sections = buildSections(CANDS, { order: ORDER_ALPHA });
    expect(sections[0].items.map((i) => i.name)).toEqual(['א פריט', 'ד פריט']);
    // ...and the SECTIONS stay in board order even then.
    expect(sections.map((s) => s.title)).toEqual(['קבוצה ראשונה', 'קבוצה שנייה']);
  });

  it('puts an item with no group in its own untitled section, with the fallback colour', () => {
    const sections = buildSections([{ id: '9', name: 'בודד', group: null }]);
    expect(sections[0].id).toBe(UNGROUPED_ID);
    expect(sections[0].title).toBe(''); // no header, rather than a made-up one
    expect(sections[0].color).toBe(DEFAULT_GROUP_COLOR);
  });

  it('falls back to the default colour for a group that carries none', () => {
    const sections = buildSections([{ id: '9', name: 'x', group: { id: 'g', title: 'ק', color: '' } }]);
    expect(sections[0].color).toBe(DEFAULT_GROUP_COLOR);
  });

  it('drops junk candidates instead of rendering a row with no id', () => {
    expect(buildSections([null, {}, { name: 'ללא מזהה' }, CANDS[0]])).toHaveLength(1);
    expect(buildSections(undefined)).toEqual([]);
  });
});

describe('search', () => {
  it('keeps only the matching items and COLLAPSES the sections left empty', () => {
    const sections = buildSections(CANDS, { query: 'ב' });
    expect(sections).toHaveLength(1); // g1 has no match — no bare title left behind
    expect(sections[0].title).toBe('קבוצה שנייה');
  });

  it('treats a blank or whitespace query as no filter at all', () => {
    expect(countItems(buildSections(CANDS, { query: '   ' }))).toBe(3);
    expect(matchesQuery('any', '')).toBe(true);
    expect(matchesQuery('any', null)).toBe(true);
  });

  it('matches case-insensitively, as the same search does on monday', () => {
    expect(matchesQuery('Item Two', 'item')).toBe(true);
    expect(matchesQuery('item two', 'ITEM')).toBe(true);
  });
});

describe('countItems / nextOrder', () => {
  it('counts across every section, so the panel can tell empty from no-match', () => {
    expect(countItems(buildSections(CANDS))).toBe(3);
    expect(countItems(buildSections(CANDS, { query: 'לא קיים' }))).toBe(0);
    expect(countItems(null)).toBe(0);
  });

  it('toggles between the two orders monday offers', () => {
    expect(nextOrder(ORDER_BOARD)).toBe(ORDER_ALPHA);
    expect(nextOrder(ORDER_ALPHA)).toBe(ORDER_BOARD);
  });
});
