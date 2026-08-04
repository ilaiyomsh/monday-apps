import { describe, it, expect } from 'vitest';
import {
  RETIRED_COLUMN_ALIASES,
  pruneRetiredSettings,
  COLUMN_SCHEMA,
  PERMISSION_ROLE_SOURCES,
  DEFAULT_PREFERENCES,
  PREVIOUS_TASKS_MODES,
} from '../boards.config.js';

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

describe('round340 preference defaults', () => {
  /*
   * Owner request: a fresh instance opens on AUTO. AUTO is the strictly more forgiving
   * mode — a discussion WITH a type resolves by type, one without still falls back to
   * the previous-discussion link — so nothing that worked under LINKED_DISCUSSION
   * stops working, while the old default started every install in the mode that shows
   * nothing until somebody manually links a previous discussion.
   */
  it('previous-tasks mode defaults to אוטומטי', () => {
    expect(DEFAULT_PREFERENCES.previousTasksMode).toBe(PREVIOUS_TASKS_MODES.AUTO);
  });

  // Owner request: the discussion's lead is the decider far more often than whoever
  // happens to be typing the decision, and the field stays editable inline either way.
  it('a new decision defaults its מחליט to the discussion lead', () => {
    expect(DEFAULT_PREFERENCES.defaultDeciderLead).toBe(true);
  });
});
