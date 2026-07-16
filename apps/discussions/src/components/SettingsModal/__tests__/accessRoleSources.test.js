import { describe, it, expect } from 'vitest';
import { accessRolesFor, toggleAccessRoleSource } from '../SettingsModal.jsx';

// Round-78 pure helpers behind the "which roles fill this access column" chips.
describe('accessRolesFor', () => {
  it('returns the stored list when present', () => {
    const prefs = { accessRoleSources: { taskEditorsID: ['discussionLeadID'] } };
    expect(accessRolesFor(prefs, 'taskEditorsID')).toEqual(['discussionLeadID']);
  });
  it('falls back to the DEFAULT for an unset column', () => {
    expect(accessRolesFor({}, 'taskViewersID')).toEqual(['participantsID']);
    expect(accessRolesFor(undefined, 'taskEditorsID')).toEqual(
      ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']
    );
  });
  it('an explicitly EMPTY stored list is honored (no auto-fill), not replaced by the default', () => {
    expect(accessRolesFor({ accessRoleSources: { taskViewersID: [] } }, 'taskViewersID')).toEqual([]);
  });
});

describe('toggleAccessRoleSource', () => {
  it('adds a role that is not present', () => {
    const next = toggleAccessRoleSource({ accessRoleSources: { taskViewersID: [] } }, 'taskViewersID', 'discussionLeadID');
    expect(next.accessRoleSources.taskViewersID).toEqual(['discussionLeadID']);
  });
  it('removes a role that is present', () => {
    const next = toggleAccessRoleSource({ accessRoleSources: { taskEditorsID: ['discussionLeadID', 'discussionCoordinatorID'] } }, 'taskEditorsID', 'discussionLeadID');
    expect(next.accessRoleSources.taskEditorsID).toEqual(['discussionCoordinatorID']);
  });
  it('seeds from the DEFAULT when the column has no stored list, then toggles', () => {
    // taskViewersID default is ['participantsID']; toggling it off yields [].
    const next = toggleAccessRoleSource({}, 'taskViewersID', 'participantsID');
    expect(next.accessRoleSources.taskViewersID).toEqual([]);
  });
  it('does not mutate the input preferences object', () => {
    const prefs = { accessRoleSources: { taskViewersID: ['participantsID'] } };
    toggleAccessRoleSource(prefs, 'taskViewersID', 'discussionLeadID');
    expect(prefs.accessRoleSources.taskViewersID).toEqual(['participantsID']);
  });
});
