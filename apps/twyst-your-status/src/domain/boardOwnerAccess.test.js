/**
 * Who may open the settings overlay.
 *
 * This is the ONE place that decides "is this actor a board owner", and it is
 * deliberately the INVERSE of the per-label rules next door: an empty
 * `allowedUserIds` means "everyone may pick that status", but a board with no
 * owners at all means NOBODY gets the settings button. The gate fails closed —
 * an unknown actor is not an owner — so both of those are pinned here.
 *
 * monday hands ids back as strings on some fields and numbers on others, and
 * `owners: [User]!` has NULLABLE elements, so a deleted user arrives as a hole
 * in the list. Both are fed in below rather than assumed away.
 */

import { describe, expect, it } from 'vitest';
import { isBoardOwner } from './boardOwnerAccess.js';

describe('isBoardOwner', () => {
  it('returns true when the actor id is listed among the board user owners', () => {
    expect(isBoardOwner({
      userId: '4001',
      ownerIds: ['9999', '4001'],
      teamOwnerIds: [],
      userTeamIds: [],
    })).toBe(true);
  });

  it('returns false for an actor who is neither a user owner nor in an owning team', () => {
    expect(isBoardOwner({
      userId: '4002',
      ownerIds: ['9999', '4001'],
      teamOwnerIds: ['77'],
      userTeamIds: ['88', '99'],
    })).toBe(false);
  });

  it('returns true when the actor belongs to a team that owns the board', () => {
    expect(isBoardOwner({
      userId: '4002',
      ownerIds: ['4001'],
      teamOwnerIds: ['77', '78'],
      userTeamIds: ['88', '78'],
    })).toBe(true);
  });

  it('returns false when a team owns the board but the actor is not on that team', () => {
    expect(isBoardOwner({
      userId: '4002',
      ownerIds: ['4001'],
      teamOwnerIds: ['77'],
      userTeamIds: ['78'],
    })).toBe(false);
  });

  it('returns false when the actor has teams but the board has no team owners', () => {
    expect(isBoardOwner({
      userId: '4002',
      ownerIds: ['4001'],
      teamOwnerIds: [],
      userTeamIds: ['77', '78'],
    })).toBe(false);
  });

  it('matches a numeric actor id against string owner ids', () => {
    expect(isBoardOwner({
      userId: 4001,
      ownerIds: ['4001'],
      teamOwnerIds: [],
      userTeamIds: [],
    })).toBe(true);
  });

  it('matches a numeric team id against string team-owner ids', () => {
    expect(isBoardOwner({
      userId: '4002',
      ownerIds: [],
      teamOwnerIds: [77],
      userTeamIds: ['77'],
    })).toBe(true);
  });

  it('returns false when the board has no owners at all — an empty list is not "everyone"', () => {
    expect(isBoardOwner({
      userId: '4001',
      ownerIds: [],
      teamOwnerIds: [],
      userTeamIds: [],
    })).toBe(false);
  });

  it('returns false when the actor id is missing, even on a board with owners', () => {
    expect(isBoardOwner({
      userId: null,
      ownerIds: ['4001'],
      teamOwnerIds: ['77'],
      userTeamIds: ['77'],
    })).toBe(false);
  });

  it('returns false for an empty-string actor id rather than matching a blank owner hole', () => {
    expect(isBoardOwner({
      userId: '',
      ownerIds: ['', '4001'],
      teamOwnerIds: [],
      userTeamIds: [],
    })).toBe(false);
  });

  it('ignores null holes in the owners list and still finds a real match after one', () => {
    expect(isBoardOwner({
      userId: '4001',
      ownerIds: [null, '4001'],
      teamOwnerIds: [],
      userTeamIds: [],
    })).toBe(true);
  });

  it('ignores null holes in the team-owners list without matching a null actor team', () => {
    expect(isBoardOwner({
      userId: '4002',
      ownerIds: [],
      teamOwnerIds: [null],
      userTeamIds: [null, '77'],
    })).toBe(false);
  });

  it('defaults every list to empty, so a call with only an actor id is not an owner', () => {
    expect(isBoardOwner({ userId: '4001' })).toBe(false);
  });
});
