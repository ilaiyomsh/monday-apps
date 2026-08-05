/**
 * columnOwners — the owner-list MUTATIONS the settings editor drives
 * (characterization / retrofit). The invariants under test are the ones the
 * guard depends on: there is always exactly one primary while owners exist, a
 * column is never left owner-less by an edit, and the crown moves only by an
 * explicit act.
 */

import { describe, expect, it } from 'vitest';

import { addOwner, removeOwner, setPrimaryOwner } from './columnOwners.js';

const OWNERS = { ownerIds: ['7', '9'], primaryOwnerId: '7' };

describe('addOwner', () => {
  it('appends a new owner without moving the primary crown', () => {
    expect(addOwner(OWNERS, '5')).toEqual({ ownerIds: ['7', '9', '5'], primaryOwnerId: '7' });
  });

  it('is a no-op for an existing owner (no duplicate, crown unchanged)', () => {
    expect(addOwner(OWNERS, 9)).toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '7' });
  });

  it('bootstraps an unadopted column: the added user becomes owner #1 and primary', () => {
    expect(addOwner(null, '5')).toEqual({ ownerIds: ['5'], primaryOwnerId: '5' });
  });

  it('ignores a blank id', () => {
    expect(addOwner(OWNERS, '  ')).toEqual(OWNERS);
  });
});

describe('removeOwner', () => {
  it('removes a non-primary owner and leaves the primary in place', () => {
    expect(removeOwner(OWNERS, '9')).toEqual({ ownerIds: ['7'], primaryOwnerId: '7' });
  });

  it('hands the crown to the first remaining owner when the primary is removed', () => {
    expect(removeOwner({ ownerIds: ['7', '9', '5'], primaryOwnerId: '7' }, '7'))
      .toEqual({ ownerIds: ['9', '5'], primaryOwnerId: '9' });
  });

  it('refuses to remove the last owner — a column is never left owner-less', () => {
    expect(removeOwner({ ownerIds: ['7'], primaryOwnerId: '7' }, '7'))
      .toEqual({ ownerIds: ['7'], primaryOwnerId: '7' });
  });

  it('is a no-op for a non-owner id', () => {
    expect(removeOwner(OWNERS, '42')).toEqual(OWNERS);
  });
});

describe('setPrimaryOwner', () => {
  it('moves the crown to another existing owner', () => {
    expect(setPrimaryOwner(OWNERS, '9')).toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '9' });
  });

  it('refuses to crown a non-owner (add them first)', () => {
    expect(setPrimaryOwner(OWNERS, '42')).toEqual(OWNERS);
  });

  it('preserves owner order when moving the crown', () => {
    expect(setPrimaryOwner({ ownerIds: ['7', '9', '5'], primaryOwnerId: '7' }, '5'))
      .toEqual({ ownerIds: ['7', '9', '5'], primaryOwnerId: '5' });
  });
});
