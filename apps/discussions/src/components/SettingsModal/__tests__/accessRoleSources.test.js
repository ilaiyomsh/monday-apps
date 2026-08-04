import { describe, it, expect } from 'vitest';
import { accessRolesFor, toggleAccessRoleSource } from '../SettingsModal.jsx';

// Round-78 pure helpers behind the "which roles fill this access column" chips.
describe('accessRolesFor', () => {
  it('returns the stored list when present', () => {
    const prefs = { accessRoleSources: { taskEditorsID: ['discussionLeadID'] } };
    expect(accessRolesFor(prefs, 'taskEditorsID')).toEqual(['discussionLeadID']);
  });
  it('falls back to the DEFAULT for an unset column', () => {
    expect(accessRolesFor({}, 'taskEditorsID')).toEqual(
      ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']
    );
    expect(accessRolesFor(undefined, 'taskEditorsID')).toEqual(
      ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']
    );
  });
  it('an explicitly EMPTY stored list is honored (no auto-fill), not replaced by the default', () => {
    expect(accessRolesFor({ accessRoleSources: { taskEditorsID: [] } }, 'taskEditorsID')).toEqual([]);
  });
  // round340 — an alias with no default and nothing stored resolves to "fill nothing"
  // rather than throwing or inventing a list. The retired taskViewersID is the case
  // that exists in the wild, on instances installed before it was removed.
  it('yields an empty list for an alias that has no default at all', () => {
    expect(accessRolesFor({}, 'taskViewersID')).toEqual([]);
  });
});

describe('toggleAccessRoleSource', () => {
  it('adds a role that is not present', () => {
    const next = toggleAccessRoleSource({ accessRoleSources: { taskEditorsID: [] } }, 'taskEditorsID', 'discussionLeadID');
    expect(next.accessRoleSources.taskEditorsID).toEqual(['discussionLeadID']);
  });
  it('removes a role that is present', () => {
    const next = toggleAccessRoleSource({ accessRoleSources: { taskEditorsID: ['discussionLeadID', 'discussionCoordinatorID'] } }, 'taskEditorsID', 'discussionLeadID');
    expect(next.accessRoleSources.taskEditorsID).toEqual(['discussionCoordinatorID']);
  });
  it('seeds from the DEFAULT when the column has no stored list, then toggles', () => {
    // taskEditorsID default holds discussionLeadID; toggling it off drops just that one.
    const next = toggleAccessRoleSource({}, 'taskEditorsID', 'discussionLeadID');
    expect(next.accessRoleSources.taskEditorsID).toEqual(['discussionCoordinatorID', 'discussionCreatorID']);
  });
  it('does not mutate the input preferences object', () => {
    const prefs = { accessRoleSources: { taskEditorsID: ['discussionCreatorID'] } };
    toggleAccessRoleSource(prefs, 'taskEditorsID', 'discussionLeadID');
    expect(prefs.accessRoleSources.taskEditorsID).toEqual(['discussionCreatorID']);
  });
});
