import { describe, it, expect } from 'vitest';
import {
  RETIRED_COLUMN_ALIASES,
  pruneRetiredSettings,
  COLUMN_SCHEMA,
  PERMISSION_ROLE_SOURCES,
  DEFAULT_PREFERENCES,
  DEFAULT_PERMISSION_SEED,
  PREVIOUS_TASKS_MODES,
  resolvePreference,
  backfillSeedCapabilities,
} from '../boards.config.js';
import { resolveCan } from '../../../hooks/usePermission.js';

/*
 * round340 (owner request, fresh-account install) — retiring a column alias, and the
 * two preference defaults that changed in the same round.
 *
 * Why a purge step exists at all: stored settings are merged OVER the schema, never
 * replaced by it (`reconcileColumns` starts from `{ ...saved }`), so deleting a key
 * from COLUMN_SCHEMA does NOT remove it from an instance that already stored it. It
 * would linger in three places at once — the column mapping, `permissions.roles`, and
 * `preferences.accessRoleSources` — and `withSeededAccessRoles`, whose whole contract
 * is to preserve what the owner configured, would faithfully keep it forever.
 */

describe('RETIRED_COLUMN_ALIASES', () => {
  it('lists taskViewersID, and it is really gone from the schema', () => {
    expect(RETIRED_COLUMN_ALIASES.tasks).toContain('taskViewersID');
    expect(COLUMN_SCHEMA.tasks).not.toHaveProperty('taskViewersID');
  });

  /*
   * The invariant that makes this list trustworthy: a retired alias must not still be
   * live somewhere. A schema entry would mean reconcileColumns re-adds it on every
   * load and the prune fights the reconcile forever; a role-source entry would mean
   * the resolver still scans it.
   */
  it('every retired alias is absent from BOTH the schema and the role sources', () => {
    for (const [boardKey, aliases] of Object.entries(RETIRED_COLUMN_ALIASES)) {
      for (const alias of aliases) {
        expect(COLUMN_SCHEMA[boardKey] || {}).not.toHaveProperty(alias);
        expect(PERMISSION_ROLE_SOURCES[boardKey] || []).not.toContain(alias);
      }
    }
  });
});

describe('pruneRetiredSettings', () => {
  // An instance installed BEFORE the retirement: the alias is stored in all three places.
  const legacy = () => ({
    boards: { tasks: { id: '2' } },
    columns: {
      tasks: {
        taskEditorsID: { id: 'ed', type: 'people' },
        taskViewersID: { id: 'vw', type: 'people', ids: ['vw', 'vw2'] },
      },
      topics: { topicCreatorID: { id: 'tc', type: 'people' } },
    },
    permissions: {
      enabled: true,
      roles: {
        'tasks:taskEditorsID': { capabilities: { editTaskName: true } },
        'tasks:taskViewersID': { capabilities: { editTaskName: false } },
      },
    },
    preferences: {
      logoUrl: 'data:x',
      accessRoleSources: { taskEditorsID: ['discussionLeadID'], taskViewersID: ['participantsID'] },
    },
  });

  it('removes the retired alias from the column mapping', () => {
    const out = pruneRetiredSettings(legacy());
    expect(out.columns.tasks).not.toHaveProperty('taskViewersID');
    expect(out.columns.tasks.taskEditorsID).toEqual({ id: 'ed', type: 'people' });
  });

  /*
   * The permissions half matters most. `boardRoleEntries` keys a role
   * `${boardKey}:${alias}`, so a stored `tasks:taskViewersID` entry is a role row for
   * an alias nothing maps any more — it survives in an exported settings JSON and in
   * the owner's matrix state as a ghost the UI cannot reach to clear.
   */
  it('removes the retired role from permissions.roles, leaving its siblings', () => {
    const out = pruneRetiredSettings(legacy());
    expect(out.permissions.roles).not.toHaveProperty('tasks:taskViewersID');
    expect(out.permissions.roles['tasks:taskEditorsID']).toEqual({ capabilities: { editTaskName: true } });
    expect(out.permissions.enabled).toBe(true);
  });

  // accessRoleSources is keyed by the TARGET alias with NO board prefix — a different
  // key shape from permissions.roles, which is why the prune handles them separately.
  it('removes the retired auto-fill list, leaving the others and unrelated preferences', () => {
    const out = pruneRetiredSettings(legacy());
    expect(out.preferences.accessRoleSources).toEqual({ taskEditorsID: ['discussionLeadID'] });
    expect(out.preferences.logoUrl).toBe('data:x');
  });

  it('leaves other boards untouched', () => {
    const out = pruneRetiredSettings(legacy());
    expect(out.columns.topics).toEqual({ topicCreatorID: { id: 'tc', type: 'people' } });
  });

  /*
   * Identity is the caller's "did anything change" test: SettingsContext folds
   * `pruned !== prunedSource` into the one storage write it already does for the alias
   * migration. Returning a fresh object every time would make every single load
   * re-persist the settings — an extra API call per boot, for nothing.
   */
  it('returns the SAME object when there is nothing to prune', () => {
    const clean = { columns: { tasks: { taskEditorsID: { id: 'ed' } } }, preferences: {} };
    expect(pruneRetiredSettings(clean)).toBe(clean);
  });

  it('does not mutate its input', () => {
    const input = legacy();
    const snapshot = JSON.stringify(input);
    pruneRetiredSettings(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is idempotent — pruning an already-pruned blob is a no-op', () => {
    const once = pruneRetiredSettings(legacy());
    expect(pruneRetiredSettings(once)).toBe(once);
  });

  it('survives blobs with no columns / permissions / preferences at all', () => {
    expect(pruneRetiredSettings(null)).toBeNull();
    expect(pruneRetiredSettings(undefined)).toBeUndefined();
    const bare = { boards: {} };
    expect(pruneRetiredSettings(bare)).toBe(bare);
  });

  // A partially-migrated instance: the mapping was cleaned but the role row was not.
  // Each trace must be prunable on its own, or one leftover blocks the others.
  it('prunes a lone leftover trace', () => {
    const out = pruneRetiredSettings({
      columns: { tasks: { taskEditorsID: { id: 'ed' } } },
      permissions: { roles: { 'tasks:taskViewersID': { capabilities: {} } } },
    });
    expect(out.permissions.roles).toEqual({});
  });
});

/*
 * round340 preference defaults — and the reason these are `resolvePreference` tests
 * rather than assertions about the constants.
 *
 * My first version of this block asserted DEFAULT_PREFERENCES.previousTasksMode === AUTO
 * and DEFAULT_PREFERENCES.defaultDeciderLead === true. Both passed, and BOTH FEATURES
 * WERE STILL BROKEN: every read site spelled its own fallback inline
 * (`|| PREVIOUS_TASKS_MODES.LINKED_DISCUSSION`, `=== true`), so the constants were
 * documentation and the app never consulted them. Asserting the constant tests that I
 * typed a value, not that anything reads it.
 */
describe('resolvePreference — the defaults are actually REACHABLE', () => {
  it('previous-tasks mode resolves to אוטומטי when nothing is stored', () => {
    expect(resolvePreference(undefined, 'previousTasksMode')).toBe(PREVIOUS_TASKS_MODES.AUTO);
    expect(resolvePreference({}, 'previousTasksMode')).toBe(PREVIOUS_TASKS_MODES.AUTO);
    expect(DEFAULT_PREFERENCES.previousTasksMode).toBe(PREVIOUS_TASKS_MODES.AUTO);
  });

  it('a new decision defaults its מחליט to the discussion lead when nothing is stored', () => {
    expect(resolvePreference({}, 'defaultDeciderLead')).toBe(true);
    expect(DEFAULT_PREFERENCES.defaultDeciderLead).toBe(true);
  });

  // A STORED value always wins — the point of a default is to cover the unset case only.
  it('a stored value wins over the default', () => {
    expect(resolvePreference({ previousTasksMode: PREVIOUS_TASKS_MODES.LINKED_DISCUSSION }, 'previousTasksMode'))
      .toBe(PREVIOUS_TASKS_MODES.LINKED_DISCUSSION);
  });

  /*
   * The case that rules out writing this as `stored || default`: an owner who
   * deliberately UNTICKED "the decider is the lead" stored `false`, and a `||` fallback
   * would read that as unset and hand them back `true` — silently overriding a real
   * choice with the default. Same for a numeric 0.
   */
  it('returns a stored FALSE as-is, rather than treating it as unset', () => {
    expect(resolvePreference({ defaultDeciderLead: false }, 'defaultDeciderLead')).toBe(false);
    expect(resolvePreference({ defaultLayoutRatio: 0 }, 'defaultLayoutRatio')).toBe(0);
  });

  // null / '' ARE unset: a blank stored mode is unusable, so it resolves to the default
  // rather than through it as an empty string.
  it('treats null and an empty string as unset', () => {
    expect(resolvePreference({ previousTasksMode: null }, 'previousTasksMode')).toBe(PREVIOUS_TASKS_MODES.AUTO);
    expect(resolvePreference({ previousTasksMode: '' }, 'previousTasksMode')).toBe(PREVIOUS_TASKS_MODES.AUTO);
  });
});


/*
 * round340 (PR review, P1) — backfilling capability keys a stored roles map predates.
 *
 * The review was right and the hole was real. Adding a capability to the catalog does not
 * reach an instance that already stored `permissions.roles`: the key is simply ABSENT
 * there, and absent is NOT a denial. `resolveCan` falls through to CAPABILITY_DEFAULTS,
 * and for an ITEM-tier capability the 'creatorLeadOwner' bucket resolves through
 * `isItemSelfRole`, which scans EVERY role source of that board — including the role the
 * new seed entry denies. So `editDecisionTracking: false` on `decisions:affectedID`
 * resolved to ALLOW for an affected-only user: the exact opposite of the request.
 *
 * The resolver-level proof is the last test here; the rest pin the merge rules that make
 * running this on every load safe.
 */
describe('backfillSeedCapabilities', () => {
  // A roles map stored BEFORE round340: the affected role has the old capability set and
  // has never heard of editDecisionTracking or the *Discussed pair.
  const legacyRoles = () => ({
    'decisions:affectedID': {
      capabilities: {
        editDecisionStatus: true,
        editDecisionPriority: false,
        editDecisionDate: false,
        editDecisionAffected: false,
        editDecisionName: false,
        deleteDecision: false,
      },
    },
    'discussions:participantsID': { capabilities: { viewDiscussion: true, editTopicOrPoint: false } },
  });

  it('fills a capability the stored map has never seen, from the seed', () => {
    const out = backfillSeedCapabilities(legacyRoles());
    expect(out['decisions:affectedID'].capabilities.editDecisionTracking).toBe(false);
    expect(out['discussions:participantsID'].capabilities.editTopicOrPointDiscussed).toBe(false);
  });

  /*
   * The line that keeps this safe to run unconditionally: a stored value is the owner's
   * answer. `false` is the dangerous case — a `stored || seed` style merge would read it
   * as unset and silently re-grant something the owner turned off.
   */
  it('never overwrites a stored value, true or FALSE', () => {
    const roles = legacyRoles();
    roles['decisions:affectedID'].capabilities.editDecisionTracking = true; // owner re-granted it
    roles['discussions:participantsID'].capabilities.viewDiscussion = false; // owner revoked it
    const out = backfillSeedCapabilities(roles);
    expect(out['decisions:affectedID'].capabilities.editDecisionTracking).toBe(true);
    expect(out['discussions:participantsID'].capabilities.viewDiscussion).toBe(false);
  });

  // Adding a missing ROLE is a different concern (only the owner UI does it) — a role the
  // instance never had should arrive with its whole seed at once, not be half-created here.
  it('does not invent role keys the stored map lacks', () => {
    const out = backfillSeedCapabilities({ 'decisions:affectedID': { capabilities: {} } });
    expect(Object.keys(out)).toEqual(['decisions:affectedID']);
  });

  // A role with no seed entry at all (e.g. an extra people column keyed by raw column id)
  // passes through untouched rather than throwing.
  it('passes an unseeded role through untouched', () => {
    const extra = { 'decisions:some_raw_col': { capabilities: { editDecisionName: true } } };
    const out = backfillSeedCapabilities(extra);
    expect(out['decisions:some_raw_col']).toBe(extra['decisions:some_raw_col']);
  });

  it('returns the SAME object when nothing needs filling, and does not mutate its input', () => {
    const full = { 'decisions:affectedID': JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED['decisions:affectedID'])) };
    expect(backfillSeedCapabilities(full)).toBe(full);
    const input = legacyRoles();
    const snapshot = JSON.stringify(input);
    backfillSeedCapabilities(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('tolerates null / a role with no capabilities object', () => {
    expect(backfillSeedCapabilities(null)).toBeNull();
    const out = backfillSeedCapabilities({ 'decisions:affectedID': {} });
    expect(out['decisions:affectedID'].capabilities.editDecisionTracking).toBe(false);
  });

  /*
   * The regression itself, through the REAL resolver rather than the merge helper: an
   * affected-only user on a pre-round340 roles map. Without the backfill this returns
   * true, which is the bug the review caught.
   */
  it('closes the leak: an affected-only user cannot edit decision tracking on a legacy map', () => {
    const ME = '7';
    const decision = { id: 'DC1', decisionCreatorID: [], deciderID: [], affectedID: [{ id: ME }] };
    const ctx = { item: decision, currentUserId: ME };

    const raw = { enabled: true, version: 1, roles: legacyRoles() };
    expect(resolveCan('editDecisionTracking', ctx, { permissions: raw, canManageSettings: false })).toBe(true);

    const healed = { ...raw, roles: backfillSeedCapabilities(raw.roles) };
    expect(resolveCan('editDecisionTracking', ctx, { permissions: healed, canManageSettings: false })).toBe(false);
  });
});
