import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, ACCESS_ROLE_SOURCE_OPTIONS, resolveAccessPeople } from '../boards.config.js';

// Round-78: which discussion-board roles auto-fill each tasks access column.
describe('access-role defaults', () => {
  it('default sources fill יכולת עריכה from the three manager roles', () => {
    expect(DEFAULT_PREFERENCES.accessRoleSources.taskEditorsID).toEqual(
      ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']
    );
  });

  /*
   * round340 — the retired "יכולת צפייה" column must leave NO auto-fill default
   * behind. This is not decoration: withSeededAccessRoles iterates these keys and
   * writes each one into real stored settings at install, so a leftover key would
   * keep re-seeding a column the app no longer knows about, on every fresh install.
   */
  it('carries NO auto-fill default for the retired viewers column', () => {
    expect(DEFAULT_PREFERENCES.accessRoleSources).not.toHaveProperty('taskViewersID');
    expect(Object.keys(DEFAULT_PREFERENCES.accessRoleSources)).toEqual(['taskEditorsID']);
  });
  it('offers the four discussion roles as selectable sources', () => {
    expect(ACCESS_ROLE_SOURCE_OPTIONS.map((o) => o.alias)).toEqual(
      ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID', 'participantsID']
    );
  });
});

describe('resolveAccessPeople', () => {
  const disc = {
    discussionLeadID: [{ id: '1', name: 'לירן' }],
    discussionCoordinatorID: [{ id: '2', name: 'דנה' }],
    discussionCreatorID: [{ id: '1', name: 'לירן' }], // same person as lead
    participantsID: [{ id: '3', name: 'עדי' }, { id: '2', name: 'דנה' }],
  };

  it('unions people across the given role aliases, deduped by id (first-seen order)', () => {
    const editors = resolveAccessPeople(disc, ['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID']);
    expect(editors.map((p) => p.id)).toEqual(['1', '2']); // creator '1' is a dup of lead → not repeated
  });

  it('resolves a single-role source', () => {
    const single = resolveAccessPeople(disc, ['participantsID']);
    expect(single.map((p) => p.id)).toEqual(['3', '2']);
  });

  it('empty / missing aliases yield no people', () => {
    expect(resolveAccessPeople(disc, [])).toEqual([]);
    expect(resolveAccessPeople(disc, ['discussionLeadID', 'notAColumn'])).toEqual([{ id: '1', name: 'לירן' }]);
    expect(resolveAccessPeople(null, ['discussionLeadID'])).toEqual([]);
  });
});
