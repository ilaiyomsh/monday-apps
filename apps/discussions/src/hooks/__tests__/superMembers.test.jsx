import { describe, it, expect } from 'vitest';
import { resolveCan, isSuperMember } from '../usePermission.js';

// round147 — "חברי-על" (owner spec 2026-07-17): a super member is a REGULAR
// user plus exactly TWO extra abilities — adding discussion types and managing
// (creating/editing) topic templates. No content-edit bypass, no other system
// caps, no settings access. The grant must hold in BOTH permission modes
// (feature off / feature on), so it sits above both resolution paths.

const ctx = { currentUserId: '7' };
const SUPERS = [{ id: '7', name: 'סופר' }];

describe('isSuperMember', () => {
  it('matches by id against the permissions.superMembers list (object or bare-id entries)', () => {
    expect(isSuperMember({ superMembers: SUPERS }, '7')).toBe(true);
    expect(isSuperMember({ superMembers: ['7'] }, 7)).toBe(true);
    expect(isSuperMember({ superMembers: SUPERS }, '8')).toBe(false);
    expect(isSuperMember({}, '7')).toBe(false);
    expect(isSuperMember(null, '')).toBe(false);
  });
});

describe('resolveCan — super-member grant (feature OFF)', () => {
  const off = { permissions: { enabled: false, superMembers: SUPERS } };

  it('grants addDiscussionTypes to a super member (owner-only for everyone else)', () => {
    expect(resolveCan('addDiscussionTypes', ctx, off)).toBe(true);
    expect(resolveCan('addDiscussionTypes', { currentUserId: '8' }, off)).toBe(false);
  });

  it('grants manageTemplates to a super member', () => {
    expect(resolveCan('manageTemplates', ctx, off)).toBe(true);
  });

  it('does NOT grant any other owner-only system cap', () => {
    expect(resolveCan('reorderColumns', ctx, off)).toBe(false);
    expect(resolveCan('saveViewDefaults', ctx, off)).toBe(false);
  });
});

describe('resolveCan — super-member grant (feature ON)', () => {
  it('holds even when the matrix explicitly revokes the capability for the system role', () => {
    const on = {
      permissions: {
        enabled: true,
        superMembers: SUPERS,
        roles: { 'system:system': { capabilities: { addDiscussionTypes: false, manageTemplates: false } } },
      },
    };
    expect(resolveCan('addDiscussionTypes', ctx, on)).toBe(true);
    expect(resolveCan('manageTemplates', ctx, on)).toBe(true);
    // a non-super member stays revoked
    expect(resolveCan('manageTemplates', { currentUserId: '8' }, on)).toBe(false);
  });
});
