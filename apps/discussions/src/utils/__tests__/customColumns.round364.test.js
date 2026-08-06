import { describe, it, expect } from 'vitest';
import {
  CUSTOM_COLUMN_BOARDS,
  CUSTOM_COLUMN_TYPE_GROUPS,
  isCustomAlias,
  canAddCustomColumn,
  nextCustomAlias,
  makeCustomColumn,
  customEntriesFor,
} from '../customColumns.js';

/*
 * round364 — pure logic behind owner-added custom column mappings. The alias
 * scheme (`custom<N>ID`) and the eligibility rules (which boards, which type
 * groups) are contracts the Settings mapping screen and the display surfaces
 * both build on — a drift here silently orphans stored mappings.
 */

describe('round364 — isCustomAlias', () => {
  it('recognizes custom<N>ID and ONLY that shape', () => {
    expect(isCustomAlias('custom1ID')).toBe(true);
    expect(isCustomAlias('custom42ID')).toBe(true);
    expect(isCustomAlias('customID')).toBe(false); // no index
    expect(isCustomAlias('custom1id')).toBe(false); // wrong suffix case
    expect(isCustomAlias('Xcustom1ID')).toBe(false); // not anchored
    expect(isCustomAlias('custom1IDx')).toBe(false);
    expect(isCustomAlias('statusID')).toBe(false);
    expect(isCustomAlias('')).toBe(false);
    expect(isCustomAlias(null)).toBe(false);
    expect(isCustomAlias(undefined)).toBe(false);
  });
});

describe('round364 — canAddCustomColumn (owner spec: 2 boards × 6 type groups)', () => {
  it('allows exactly discussions+tasks, and exactly the six owner-spec type groups', () => {
    expect(CUSTOM_COLUMN_BOARDS).toEqual(['discussions', 'tasks']);
    for (const board of ['discussions', 'tasks']) {
      for (const group of ['people', 'dropdown', 'relation', 'date', 'text', 'file']) {
        expect(canAddCustomColumn(board, group), `${board}/${group}`).toBe(true);
      }
      // statuses, checkboxes and computed fields are deliberately excluded
      for (const group of ['status', 'checkbox', 'formula', 'other', 'board']) {
        expect(canAddCustomColumn(board, group), `${board}/${group}`).toBe(false);
      }
    }
    for (const board of ['topics', 'decisions', 'nope', '', null, undefined]) {
      expect(canAddCustomColumn(board, 'people'), String(board)).toBe(false);
    }
  });
});

describe('round364 — nextCustomAlias', () => {
  it('starts at custom1ID on an empty/undefined board map', () => {
    expect(nextCustomAlias({})).toBe('custom1ID');
    expect(nextCustomAlias(undefined)).toBe('custom1ID');
    expect(nextCustomAlias(null)).toBe('custom1ID');
  });

  it('takes max existing index + 1, ignoring non-custom aliases', () => {
    expect(nextCustomAlias({
      statusID: { id: 'x', type: 'status' },
      custom1ID: { id: 'a', type: 'people', custom: true },
      custom7ID: { id: 'b', type: 'date', custom: true },
      custom3ID: { id: 'c', type: 'text', custom: true },
    })).toBe('custom8ID');
  });

  it('never reuses a removed middle index (a gap stays a gap)', () => {
    // custom2ID was removed; the next alias continues past the highest, so a
    // later re-add cannot silently inherit custom2ID's old stored meaning.
    expect(nextCustomAlias({
      custom1ID: { id: 'a', type: 'people', custom: true },
      custom5ID: { id: 'b', type: 'file', custom: true },
    })).toBe('custom6ID');
  });

  it('counts an UNMAPPED custom entry too (a just-added empty row still claims its index)', () => {
    expect(nextCustomAlias({
      custom2ID: { id: '', type: 'dropdown', custom: true },
    })).toBe('custom3ID');
  });
});

describe('round364 — makeCustomColumn', () => {
  it('creates an unmapped draft entry carrying the group canonical type + custom flag', () => {
    expect(makeCustomColumn('relation')).toEqual({
      id: '', type: 'board_relation', title: '', verified: false, custom: true,
    });
    expect(makeCustomColumn('people').type).toBe('people');
    expect(makeCustomColumn('text').type).toBe('text');
    expect(makeCustomColumn('file').type).toBe('file');
    expect(makeCustomColumn('date').type).toBe('date');
    expect(makeCustomColumn('dropdown').type).toBe('dropdown');
  });

  it('returns null for a group that is not customizable', () => {
    expect(makeCustomColumn('status')).toBe(null);
    expect(makeCustomColumn('formula')).toBe(null);
    expect(makeCustomColumn('nope')).toBe(null);
    expect(makeCustomColumn(undefined)).toBe(null);
  });

  it('every customizable group maps to a type the schema uses', () => {
    expect(CUSTOM_COLUMN_TYPE_GROUPS).toEqual({
      people: 'people',
      dropdown: 'dropdown',
      relation: 'board_relation',
      date: 'date',
      text: 'text',
      file: 'file',
    });
  });
});

describe('round364 — customEntriesFor', () => {
  const board = {
    statusID: { id: 's', type: 'status' },
    custom3ID: { id: 'c3', type: 'date', custom: true },
    custom1ID: { id: 'c1', type: 'people', custom: true },
    custom2ID: { id: 'c2', type: 'long_text', custom: true },
    deadlineID: { id: 'd', type: 'date' },
  };

  it('returns only custom entries, in stable numeric index order (not insertion order)', () => {
    expect(customEntriesFor(board).map(([a]) => a)).toEqual(['custom1ID', 'custom2ID', 'custom3ID']);
    expect(customEntriesFor(board)[0][1]).toEqual({ id: 'c1', type: 'people', custom: true });
  });

  it('narrows by the given types list (a text group matches long_text too)', () => {
    expect(customEntriesFor(board, ['text', 'long_text']).map(([a]) => a)).toEqual(['custom2ID']);
    expect(customEntriesFor(board, ['date']).map(([a]) => a)).toEqual(['custom3ID']);
    expect(customEntriesFor(board, ['status'])).toEqual([]);
  });

  it('empty/undefined map yields an empty list', () => {
    expect(customEntriesFor(undefined)).toEqual([]);
    expect(customEntriesFor({})).toEqual([]);
  });

  it('an alias matching the shape but WITHOUT the custom flag still counts as custom (flag is advisory, the alias is the contract)', () => {
    // Stored settings may round-trip through merges that strip unknown flags;
    // the alias shape alone must be enough to recognize the entry.
    expect(customEntriesFor({ custom4ID: { id: 'x', type: 'file' } }).map(([a]) => a)).toEqual(['custom4ID']);
  });
});
