import { describe, it, expect } from 'vitest';
import { resolveCan } from '../usePermission.js';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_PERMISSION_SEED,
  CAP_ITEM_SELF_ROLES,
} from '../../utils/mondayApi/boards.config.js';

/*
 * round305 (owner spec) — who may edit a task's שותפים (partnersID):
 *   owners · the DISCUSSION's lead / creator / coordinator · the TASK's creator ·
 *   the TASK's responsible.
 * Notably NOT the read-only viewers role, which the generic item-tier scan would
 * otherwise reach in the personal (discussion-less) surface.
 */

const ME = '101';
const OTHER = '202';
const p = (id) => ({ id });

const CAP = 'editTaskPartners';
const off = { permissions: DEFAULT_PERMISSIONS, canManageSettings: false };
const on = { permissions: { enabled: true, version: 1, roles: DEFAULT_PERMISSION_SEED }, canManageSettings: false };

// A task whose role columns have LOADED (arrays ⇒ itemReady).
const task = (over = {}) => ({
  id: 'T1',
  taskCreatorID: [],
  responsibilityID: [],
  taskEditorsID: [],
  ...over,
});
const ctx = (item, extra = {}) => ({ boardKey: 'tasks', item, currentUserId: ME, ...extra });
// The discussion roles a "בדיונים שהובלתי" row carries (no discussion in ctx).
const ledRoles = (over = {}) => ({
  discussionLeadID: [], discussionCoordinatorID: [], discussionCreatorID: [], ...over,
});

describe('editTaskPartners — the personal view (no discussion in ctx)', () => {
  for (const [label, opts] of [['feature OFF', off], ['feature ON (seeded)', on]]) {
    describe(label, () => {
      it('ALLOWS the task creator', () => {
        expect(resolveCan(CAP, ctx(task({ taskCreatorID: [p(ME)] })), opts)).toBe(true);
      });
      it('ALLOWS the task responsible', () => {
        expect(resolveCan(CAP, ctx(task({ responsibilityID: [p(ME)] })), opts)).toBe(true);
      });
      it('ALLOWS a task editor (יכולת עריכה — seeded from the discussion roles)', () => {
        expect(resolveCan(CAP, ctx(task({ taskEditorsID: [p(ME)] })), opts)).toBe(true);
      });
      it('DENIES a stranger', () => {
        expect(resolveCan(CAP, ctx(task({ taskCreatorID: [p(OTHER)] })), opts)).toBe(false);
      });
      it('ALLOWS the parent discussion\'s lead / coordinator / creator via the row\'s roles', () => {
        expect(resolveCan(CAP, ctx(task({ __discussionRoles: ledRoles({ discussionLeadID: [p(ME)] }) })), opts)).toBe(true);
        expect(resolveCan(CAP, ctx(task({ __discussionRoles: ledRoles({ discussionCoordinatorID: [p(ME)] }) })), opts)).toBe(true);
        expect(resolveCan(CAP, ctx(task({ __discussionRoles: ledRoles({ discussionCreatorID: [p(ME)] }) })), opts)).toBe(true);
      });
      it('DENIES when the row\'s parent-discussion roles belong to someone else', () => {
        expect(resolveCan(CAP, ctx(task({ __discussionRoles: ledRoles({ discussionLeadID: [p(OTHER)] }) })), opts)).toBe(false);
      });
    });
  }

  it('ALWAYS allows the board OWNER', () => {
    expect(resolveCan(CAP, ctx(task()), { ...off, canManageSettings: true })).toBe(true);
    expect(resolveCan(CAP, ctx(task()), { ...on, canManageSettings: true })).toBe(true);
  });

  it('stays read-only until the task\'s people columns have loaded (ready gate)', () => {
    expect(resolveCan(CAP, ctx({ id: 'T1' }), off)).toBe(false);
  });
});

describe('editTaskPartners — inside a discussion', () => {
  const disc = (over = {}) => ({
    id: 'D1', discussionCreatorID: [], discussionLeadID: [], discussionCoordinatorID: [], participantsID: [], ...over,
  });
  it('ALLOWS the discussion lead / creator / coordinator', () => {
    for (const key of ['discussionLeadID', 'discussionCreatorID', 'discussionCoordinatorID']) {
      expect(resolveCan(CAP, ctx(task(), { discussion: disc({ [key]: [p(ME)] }) }), off)).toBe(true);
    }
  });
  it('DENIES a plain participant', () => {
    expect(resolveCan(CAP, ctx(task(), { discussion: disc({ participantsID: [p(ME)] }) }), off)).toBe(false);
  });
});

describe('the narrowing itself', () => {
  /*
   * round340 — the retired taskViewersID is what selfRoles was written to exclude, so
   * the list now happens to equal PERMISSION_ROLE_SOURCES.tasks and the narrowing is
   * a no-op. It stays declared: `parentDiscussionEditors` lives on the same entry and
   * is NOT redundant, and spelling the roles out means a people column added to the
   * tasks board later cannot silently widen who may edit שותפים.
   */
  it('is declared for editTaskPartners with the three edit roles + the parent-discussion hatch', () => {
    const rule = CAP_ITEM_SELF_ROLES.editTaskPartners.tasks;
    expect(rule.selfRoles).toEqual(['taskCreatorID', 'responsibilityID', 'taskEditorsID']);
    expect(rule.selfRoles).not.toContain('taskViewersID');
    expect(rule.parentDiscussionEditors).toBe(true);
  });

  it('does NOT change any other item-tier capability (they keep the full role scan)', () => {
    // editTaskStatus is unlisted, so a parent-discussion lead does NOT gain it
    // through __discussionRoles — only the listed capability reads that hatch.
    const led = ctx(task({ __discussionRoles: ledRoles({ discussionLeadID: [p(ME)] }) }));
    expect(resolveCan('editTaskStatus', led, off)).toBe(false);
  });
});
