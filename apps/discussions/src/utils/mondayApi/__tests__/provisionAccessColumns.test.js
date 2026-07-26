import { describe, it, expect } from 'vitest';
import { PROVISION_SPEC } from '../provisionBoards.js';
import { DEFAULT_PREFERENCES } from '../boards.config.js';

/*
 * round294 — INFRASTRUCTURE guarantee for task access.
 *
 * A freshly-provisioned (or topped-up / connected) board set MUST carry the
 * people columns the access model writes into on task creation:
 *   - tasks board:       "יכולת עריכה" (taskEditorsID) — creator + coordinator
 *                         + manager of the source discussion are written here.
 *   - discussions board: "מרכז דיון" (discussionCoordinatorID) — the coordinator
 *                         role, one of the three sources for the editors column.
 *
 * Before round294 neither column was provisioned, so taskEditorsID was never
 * mapped and the editors write in useTasks was a silent no-op (owner-reported).
 * These assertions fail on the pre-round294 spec.
 */
describe('PROVISION_SPEC — task access infrastructure columns', () => {
  it('provisions the tasks "יכולת עריכה" people column (taskEditorsID)', () => {
    const col = PROVISION_SPEC.tasks.columns.find((c) => c.alias === 'taskEditorsID');
    expect(col).toBeTruthy();
    expect(col.type).toBe('people');
    expect(col.title).toBe('יכולת עריכה');
  });

  it('provisions the discussions "מרכז דיון" people column (discussionCoordinatorID)', () => {
    const col = PROVISION_SPEC.discussions.columns.find((c) => c.alias === 'discussionCoordinatorID');
    expect(col).toBeTruthy();
    expect(col.type).toBe('people');
    expect(col.title).toBe('מרכז דיון');
  });

  it('every default editors-source role has a provisioned column on the discussions board', () => {
    // The default editors sources are the three discussion roles the owner asked
    // to flow into "יכולת עריכה": manager (lead) + coordinator + creator.
    const sources = DEFAULT_PREFERENCES.accessRoleSources.taskEditorsID;
    expect(sources).toEqual(
      expect.arrayContaining(['discussionLeadID', 'discussionCoordinatorID', 'discussionCreatorID'])
    );
    const provisioned = new Set(PROVISION_SPEC.discussions.columns.map((c) => c.alias));
    sources.forEach((alias) => expect(provisioned.has(alias)).toBe(true));
  });
});
