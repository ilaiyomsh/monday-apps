import { describe, it, expect } from 'vitest';
import { withSeededAccessRoles, DEFAULT_PREFERENCES } from '../boards.config.js';

/*
 * round317 (owner request) — on install, the tasks "יכולת עריכה" column must come
 * with יוצר + מוביל/מנהל + מרכז דיון already ticked, and "יכולת צפייה" with
 * משתתפים. Until now that was a FALLBACK only (nothing stored); this seeds it as
 * real state, per key, so a top-up can run it without overriding the owner.
 */

describe('withSeededAccessRoles', () => {
  it('seeds a fresh install with the three edit roles and the viewers role', () => {
    const prefs = withSeededAccessRoles(undefined);
    expect(prefs.accessRoleSources.taskEditorsID)
      .toEqual(['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']);
    expect(prefs.accessRoleSources.taskViewersID).toEqual(['participantsID']);
  });

  it('seeds exactly what the app already falls back to (no behavior change, just stored)', () => {
    expect(withSeededAccessRoles(null).accessRoleSources).toEqual(DEFAULT_PREFERENCES.accessRoleSources);
  });

  it('keeps a list the owner already configured', () => {
    const prefs = withSeededAccessRoles({ accessRoleSources: { taskEditorsID: ['discussionCreatorID'] } });
    expect(prefs.accessRoleSources.taskEditorsID).toEqual(['discussionCreatorID']);
    // …and still fills the key that was never set.
    expect(prefs.accessRoleSources.taskViewersID).toEqual(['participantsID']);
  });

  it('respects an EMPTY list — "fill nothing" is a decision, not a missing value', () => {
    const prefs = withSeededAccessRoles({ accessRoleSources: { taskEditorsID: [] } });
    expect(prefs.accessRoleSources.taskEditorsID).toEqual([]);
  });

  it('replaces a non-array (a value that survived a bad write) with the default', () => {
    const prefs = withSeededAccessRoles({ accessRoleSources: { taskEditorsID: 'discussionLeadID' } });
    expect(prefs.accessRoleSources.taskEditorsID)
      .toEqual(['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']);
  });

  it('carries the unrelated preferences through untouched', () => {
    const prefs = withSeededAccessRoles({ logoUrl: 'data:x', showMyTasks: true, boxLabels: { background: 'סקירה' } });
    expect(prefs.logoUrl).toBe('data:x');
    expect(prefs.showMyTasks).toBe(true);
    expect(prefs.boxLabels).toEqual({ background: 'סקירה' });
  });

  it('is pure — neither the preferences nor the shipped defaults are mutated', () => {
    const prefs = { accessRoleSources: { taskViewersID: ['participantsID'] } };
    const snapshot = JSON.stringify(prefs);
    const defaults = JSON.stringify(DEFAULT_PREFERENCES.accessRoleSources);
    const next = withSeededAccessRoles(prefs);
    next.accessRoleSources.taskEditorsID.push('x');
    expect(JSON.stringify(prefs)).toBe(snapshot);
    expect(JSON.stringify(DEFAULT_PREFERENCES.accessRoleSources)).toBe(defaults);
  });
});
