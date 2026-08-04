/**
 * columnOwners — characterization suite (retrofit path: the module was written
 * first, so red is proven by killed mutations, bar raised to ≥3).
 *
 * The contract (owner decision, round322): first configurer = owner #1 =
 * primary; owners manage owners; ABSENT/empty owners = column not adopted yet
 * (legacy blobs) and must normalize to null, never to a phantom record; the
 * primary must always be ONE OF the owners because the guard writes reverts
 * with the primary's identity.
 */

import { describe, expect, it } from 'vitest';

import {
  bootstrapOwners,
  hasOwners,
  isColumnOwner,
  isPrimaryOwner,
  normalizeOwners,
} from './columnOwners.js';

describe('normalizeOwners', () => {
  it('normalizes ids to trimmed unique strings and keeps their order', () => {
    expect(normalizeOwners({ ownerIds: [7, ' 7 ', '9', '', null, '9'], primaryOwnerId: '9' }))
      .toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '9' });
  });

  it('falls the primary back to the FIRST owner when it is missing or not an owner', () => {
    expect(normalizeOwners({ ownerIds: ['7', '9'] }))
      .toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '7' });
    expect(normalizeOwners({ ownerIds: ['7', '9'], primaryOwnerId: '42' }))
      .toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '7' });
  });

  it('accepts a numeric primary that matches an owner (monday hands numbers)', () => {
    expect(normalizeOwners({ ownerIds: ['7', '9'], primaryOwnerId: 9 }))
      .toEqual({ ownerIds: ['7', '9'], primaryOwnerId: '9' });
  });

  it('normalizes absence in every spelling to null — an unadopted column stays unadopted', () => {
    expect(normalizeOwners(undefined)).toBeNull();
    expect(normalizeOwners(null)).toBeNull();
    expect(normalizeOwners({})).toBeNull();
    expect(normalizeOwners({ ownerIds: [] })).toBeNull();
    expect(normalizeOwners({ ownerIds: ['', null] })).toBeNull();
    expect(normalizeOwners(['7'])).toBeNull();
  });
});

describe('membership checks', () => {
  const OWNERS = { ownerIds: ['7', '9'], primaryOwnerId: '9' };

  it('isColumnOwner matches listed owners only, number or string', () => {
    expect(isColumnOwner(OWNERS, '7')).toBe(true);
    expect(isColumnOwner(OWNERS, 9)).toBe(true);
    expect(isColumnOwner(OWNERS, '42')).toBe(false);
    expect(isColumnOwner(OWNERS, null)).toBe(false);
    expect(isColumnOwner(null, '7')).toBe(false);
  });

  it('isPrimaryOwner matches exactly the primary, and only while owners exist', () => {
    expect(isPrimaryOwner(OWNERS, '9')).toBe(true);
    expect(isPrimaryOwner(OWNERS, 9)).toBe(true);
    expect(isPrimaryOwner(OWNERS, '7')).toBe(false);
    expect(isPrimaryOwner(null, '9')).toBe(false);
  });

  it('isPrimaryOwner follows the normalized fallback, not the raw field', () => {
    expect(isPrimaryOwner({ ownerIds: ['7', '9'], primaryOwnerId: '42' }, '7')).toBe(true);
  });

  it('hasOwners is the adoption test: false for every absent spelling', () => {
    expect(hasOwners(OWNERS)).toBe(true);
    expect(hasOwners({ ownerIds: [] })).toBe(false);
    expect(hasOwners(undefined)).toBe(false);
  });
});

describe('bootstrapOwners', () => {
  it('makes the first configurer owner #1 AND primary', () => {
    expect(bootstrapOwners(7)).toEqual({ ownerIds: ['7'], primaryOwnerId: '7' });
  });

  it('refuses a missing user id — a column must never adopt nobody', () => {
    expect(() => bootstrapOwners('')).toThrow();
    expect(() => bootstrapOwners(undefined)).toThrow();
  });
});
