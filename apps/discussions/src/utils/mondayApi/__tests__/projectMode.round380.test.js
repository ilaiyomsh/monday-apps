import { describe, it, expect } from 'vitest';
import {
  isProjectModeReady,
  CREATE_DISCUSSION_MODES,
  COLUMN_SCHEMA,
  DEFAULT_PREFERENCES,
} from '../boards.config.js';

/*
 * round380 (owner spec) — stage 1 of "דיון על פרויקט": the mapping, the preference
 * and the ONE rule that decides whether the path may be offered at all.
 *
 * The rule has two conditions on purpose. The preference is the owner's intent;
 * the mapped column is whether the app can actually write the link. The projects
 * board belongs to the account and nothing in this app provisions it, so
 * "preference on, column not mapped yet" is the normal intermediate state — and
 * offering the path there would create discussions whose project went nowhere.
 */

describe('isProjectModeReady', () => {
  const on = { projectDiscussions: true };
  const mapped = { projectLinkID: { id: 'connect_mkx1', type: 'board_relation' } };

  it('needs BOTH the preference and a mapped column', () => {
    expect(isProjectModeReady(on, mapped)).toBe(true);
    expect(isProjectModeReady({ projectDiscussions: false }, mapped)).toBe(false);
    expect(isProjectModeReady(on, {})).toBe(false);
  });

  /*
   * A mapping row can exist with no id — that is what an unmapped field looks like
   * after the schema is merged over stored settings. Testing the ROW's presence
   * instead of its id is the mistake that would offer the path with nothing to
   * write to.
   */
  it('treats a mapping row without an id as unmapped', () => {
    expect(isProjectModeReady(on, { projectLinkID: {} })).toBe(false);
    expect(isProjectModeReady(on, { projectLinkID: { id: '' } })).toBe(false);
    expect(isProjectModeReady(on, { projectLinkID: null })).toBe(false);
  });

  it('is false — never throws — on missing input', () => {
    expect(isProjectModeReady(undefined, undefined)).toBe(false);
    expect(isProjectModeReady(null, null)).toBe(false);
  });

  /*
   * The preference must be strictly true. An instance that stored a truthy junk
   * value (a migration artefact, a hand-edited store) must not silently enable a
   * path the owner never turned on.
   */
  it('requires the preference to be exactly true, not merely truthy', () => {
    expect(isProjectModeReady({ projectDiscussions: 'yes' }, mapped)).toBe(false);
    expect(isProjectModeReady({ projectDiscussions: 1 }, mapped)).toBe(false);
  });
});

describe('the feature ships OFF, so this round is a no-op for existing instances', () => {
  it('defaults projectDiscussions to false', () => {
    expect(DEFAULT_PREFERENCES.projectDiscussions).toBe(false);
  });

  it('resolves to not-ready for an instance that has never heard of the preference', () => {
    // Stored preferences from before this round: no key at all. The default must
    // carry it to false rather than leaving it undefined-and-truthy-somewhere.
    expect(isProjectModeReady({}, { projectLinkID: { id: 'x' } })).toBe(false);
  });
});

describe('the mapping and the mode constant', () => {
  it('maps פרויקט as a board_relation on the DISCUSSIONS board', () => {
    expect(COLUMN_SCHEMA.discussions.projectLinkID).toEqual({
      type: 'board_relation',
      title: 'פרויקט',
    });
  });

  it('seeds NO column id — the projects board is not provisioned by this app', () => {
    // A seeded id would point at a column on a board the app never created, and
    // the owner's real mapping is the only correct source.
    expect(COLUMN_SCHEMA.discussions.projectLinkID.id).toBeUndefined();
  });

  it('adds PROJECT as a third creation mode without disturbing the existing two', () => {
    expect(CREATE_DISCUSSION_MODES.PROJECT).toBe('project');
    expect(CREATE_DISCUSSION_MODES.TEMPLATE).toBe('template');
    expect(CREATE_DISCUSSION_MODES.ADHOC).toBe('adhoc');
  });

  it('keeps TEMPLATE as the default creation mode', () => {
    expect(DEFAULT_PREFERENCES.createDiscussionMode).toBe(CREATE_DISCUSSION_MODES.TEMPLATE);
  });
});
