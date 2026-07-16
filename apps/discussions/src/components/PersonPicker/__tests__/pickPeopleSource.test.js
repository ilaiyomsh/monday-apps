import { describe, it, expect } from 'vitest';
import { pickPeopleSource } from '../PersonPicker.jsx';

const roster = [{ id: '1' }, { id: '2' }, { id: '3' }];
const boardUsers = [{ id: '1' }, { id: '2' }];

// Round-79: מושפעים (affected) may be ANYONE in the account, so the picker is
// account-wide; the decider / other people fields stay board-scoped.
describe('pickPeopleSource', () => {
  it('accountWide → the full account roster, even when a board list exists', () => {
    expect(pickPeopleSource({ accountWide: true, boardKey: 'decisions', boardUsers, roster })).toBe(roster);
  });

  it('board-scoped (no accountWide) → the board members', () => {
    expect(pickPeopleSource({ accountWide: false, boardKey: 'decisions', boardUsers, roster })).toBe(boardUsers);
  });

  it('board-scoped but board members empty/loading → falls back to the roster (never blank)', () => {
    expect(pickPeopleSource({ accountWide: false, boardKey: 'decisions', boardUsers: [], roster })).toBe(roster);
  });

  it('no boardKey → the account roster', () => {
    expect(pickPeopleSource({ accountWide: false, boardKey: null, boardUsers, roster })).toBe(roster);
  });

  it('tolerates missing roster', () => {
    expect(pickPeopleSource({ accountWide: true, boardKey: 'decisions', boardUsers, roster: undefined })).toEqual([]);
  });
});
