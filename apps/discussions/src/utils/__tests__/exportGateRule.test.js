import { describe, it, expect } from 'vitest';
import { canExportDiscussion } from '../exportGate.js';

// round207 — the FIXED export rule: creator / lead / coordinator + board owner.
describe('canExportDiscussion', () => {
  const me = { id: '7' };

  it('allows the board owner regardless of roles', () => {
    expect(canExportDiscussion({}, { canManageSettings: true, currentUser: null })).toBe(true);
  });

  it('allows creator, lead and coordinator', () => {
    expect(canExportDiscussion({ discussionCreatorID: [{ id: '7' }] }, { currentUser: me })).toBe(true);
    expect(canExportDiscussion({ discussionLeadID: [{ id: 7 }] }, { currentUser: me })).toBe(true);
    expect(canExportDiscussion({ discussionCoordinatorID: [{ id: '7' }] }, { currentUser: me })).toBe(true);
  });

  it('denies everyone else — participants included', () => {
    const item = {
      discussionCreatorID: [{ id: '1' }],
      discussionLeadID: [{ id: '2' }],
      discussionCoordinatorID: [{ id: '3' }],
      participantsID: [{ id: '7' }], // participant is NOT in the fixed rule
    };
    expect(canExportDiscussion(item, { currentUser: me })).toBe(false);
    expect(canExportDiscussion(null, { currentUser: me })).toBe(false);
    expect(canExportDiscussion(item, { currentUser: null })).toBe(false);
  });
});
