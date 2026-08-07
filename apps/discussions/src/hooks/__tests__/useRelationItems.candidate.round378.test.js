import { describe, it, expect } from 'vitest';
import { toCandidate } from '../useRelationItems.js';

/*
 * round378 — the picker panel now draws monday's grouped "Choose items" layout, so
 * each candidate carries its GROUP (title + colour) alongside id and name. This is
 * the normalizer between monday's payload and that shape.
 *
 * `Item.group` is NULLABLE in the live schema (verified against it — a subitem has
 * no group), which is the whole reason a normalizer exists: the panel must be able
 * to tell "no group" from "a group with no title", or an ungrouped item renders
 * under an empty coloured header.
 */
describe('toCandidate', () => {
  it('carries the group through, stringifying the ids', () => {
    const c = toCandidate({ id: 12, name: 'פריט', group: { id: 34, title: 'קבוצה', color: '#579bfc' } });
    expect(c).toEqual({
      id: '12',
      name: 'פריט',
      group: { id: '34', title: 'קבוצה', color: '#579bfc' },
    });
  });

  it('reports NO group as null, not as a half-filled object', () => {
    expect(toCandidate({ id: '1', name: 'x', group: null }).group).toBeNull();
    expect(toCandidate({ id: '1', name: 'x' }).group).toBeNull();
    // a group object with no id is not a group either — it cannot be keyed on
    expect(toCandidate({ id: '1', name: 'x', group: { title: 'ק' } }).group).toBeNull();
  });

  it('keeps a group that has an id but no title/colour, blanked rather than dropped', () => {
    // The section still exists (its items belong together); the panel supplies the
    // fallback colour. Dropping the group here would merge it into "ungrouped".
    expect(toCandidate({ id: '1', name: 'x', group: { id: 'g' } }).group)
      .toEqual({ id: 'g', title: '', color: '' });
  });

  it('falls back to the id when an item has no name, so no row renders blank', () => {
    expect(toCandidate({ id: 77, name: '' }).name).toBe('77');
    expect(toCandidate({ id: 77 }).name).toBe('77');
  });
});
