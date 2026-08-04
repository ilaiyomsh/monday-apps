import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';

/*
 * round337 — reconcileColumns is WIRED (audit + first eslint run):
 *
 * The function sat in SettingsContext since the app entered the repo, with a
 * comment explaining exactly why it must run ("a schema change like dropdown→
 * status never reaches already-configured instances — the stale stored type
 * would still drive parse/format") — and NOTHING ever called it. The first run
 * of the new linter (no-unused-vars) is what surfaced it.
 *
 * These tests pin the wiring:
 *   1. a stored column whose `type` went stale gets the CODE schema's type at
 *      load, while its instance-specific `id` and `verified` are preserved;
 *   2. a stored TITLE the owner set survives (schema title is a fallback only);
 *   3. the reconciled shape is what gets PUBLISHED to the SDK store — the read
 *      path parse/format actually consumes, not just React state.
 *
 * Mocks mirror SettingsContext.merge.test.jsx.
 */

const storageState = { value: null, setItem: vi.fn(), getItem: vi.fn() };
vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: (...a) => storageState.getItem(...a),
      setItem: (...a) => storageState.setItem(...a),
    },
  },
}));
const setActiveConfig = vi.fn();
vi.mock('../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: (...a) => setActiveConfig(...a),
}));

import { SettingsProvider, useSettings } from '../SettingsContext.jsx';
import { MondayContext } from '../MondayContext.jsx';
import { COLUMN_SCHEMA } from '../../utils/mondayApi/boards.config.js';

// A real alias from the code schema, so the expected type is the SCHEMA's, not
// a value this test invents.
const ALIAS = Object.keys(COLUMN_SCHEMA.discussions)[0];
const SCHEMA_TYPE = COLUMN_SCHEMA.discussions[ALIAS].type;

const STORED = {
  boards: {
    discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' }, decisions: { id: 'B4' },
  },
  columns: {
    discussions: {
      [ALIAS]: { id: 'col_live_1', verified: true, type: 'stale_type_from_old_schema', title: 'שם שהבעלים קבע' },
    },
    tasks: {}, topics: {}, decisions: {},
  },
};

function renderSettings() {
  const ref = { current: null };
  function Capture() {
    ref.current = useSettings();
    return null;
  }
  const ctxValue = { context: { instanceId: 'inst1' }, currentUser: null, isMobile: false };
  render(
    <MondayContext.Provider value={ctxValue}>
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    </MondayContext.Provider>
  );
  return ref;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(STORED) } }));
  storageState.setItem = vi.fn(async () => ({}));
});

/*
 * round340 — pruneRetiredSettings is WIRED into the same load path, and its ORDER
 * relative to reconcileColumns is the point: reconcile starts from `{ ...saved }`, so a
 * prune that ran after it would be undone on the very next load. The pure rules live in
 * mondayApi/__tests__/retiredAliases.test.js; what is pinned here is that the load path
 * actually calls it, publishes the pruned shape, and re-persists the cleaned blob.
 */
describe('round340 — retired aliases are pruned at load', () => {
  const LEGACY = {
    boards: STORED.boards,
    columns: {
      ...STORED.columns,
      tasks: { taskViewersID: { id: 'vw', type: 'people' }, taskEditorsID: { id: 'ed', type: 'people' } },
    },
    permissions: { enabled: true, roles: { 'tasks:taskViewersID': { capabilities: {} } } },
    preferences: { accessRoleSources: { taskViewersID: ['participantsID'] } },
  };

  it('drops the retired alias from the settings the app runs on', async () => {
    storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(LEGACY) } }));
    let ref;
    await act(async () => { ref = renderSettings(); });
    expect(ref.current.settings.columns.tasks).not.toHaveProperty('taskViewersID');
    expect(ref.current.settings.columns.tasks.taskEditorsID.id).toBe('ed');
    expect(ref.current.settings.permissions.roles).not.toHaveProperty('tasks:taskViewersID');
  });

  // The SDK store is what BoardSDK reads at query time, so a prune that only touched
  // React state would leave the retired column being fetched on every read.
  it('publishes the PRUNED columns to the SDK store', async () => {
    storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(LEGACY) } }));
    await act(async () => { renderSettings(); });
    const published = setActiveConfig.mock.calls.at(-1)[0];
    expect(published.columns.tasks).not.toHaveProperty('taskViewersID');
  });

  /*
   * A prune that never persists is a prune that runs forever. It also has to be the
   * OTHER way round for a clean instance: re-writing settings on every boot would cost
   * an API call per load for nothing, which is why the helper's identity result is what
   * drives this.
   */
  it('re-persists once when it pruned, and not at all when there was nothing to prune', async () => {
    storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(LEGACY) } }));
    await act(async () => { renderSettings(); });
    expect(storageState.setItem).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(STORED) } }));
    storageState.setItem = vi.fn(async () => ({}));
    await act(async () => { renderSettings(); });
    expect(storageState.setItem).not.toHaveBeenCalled();
  });
});

/*
 * round340 (PR review, P1) — the capability backfill must run on the RUNTIME read path,
 * not only inside the Settings modal's draft. PermissionsTab already backfilled, but its
 * result reaches storage only once an owner opens AND saves the modal; until then an
 * absent capability key is not a denial and the resolver falls through to
 * CAPABILITY_DEFAULTS. The merge rules are pinned in mondayApi/__tests__/retiredAliases;
 * what is pinned here is that `permissions` — the object the resolver actually reads —
 * comes out healed with no owner action at all.
 */
describe('round340 — new capabilities are backfilled into the permissions the resolver reads', () => {
  // A pre-round340 roles map: the affected role predates editDecisionTracking.
  const LEGACY = {
    ...STORED,
    permissions: {
      enabled: true,
      roles: { 'decisions:affectedID': { capabilities: { editDecisionStatus: true } } },
    },
  };

  it('fills the absent capability from the seed, with no save required', async () => {
    storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(LEGACY) } }));
    let ref;
    await act(async () => { ref = renderSettings(); });
    const caps = ref.current.permissions.roles['decisions:affectedID'].capabilities;
    expect(caps.editDecisionTracking).toBe(false);
  });

  // …while a value the owner actually set survives. `true` here is the same shape the
  // backfill would otherwise write as `false`, so this is the case that separates
  // "fill what is missing" from "reset to the seed".
  it('leaves a stored value alone', async () => {
    storageState.getItem = vi.fn(async () => ({
      data: { value: JSON.stringify({
        ...STORED,
        permissions: { enabled: true, roles: { 'decisions:affectedID': { capabilities: { editDecisionTracking: true } } } },
      }) },
    }));
    let ref;
    await act(async () => { ref = renderSettings(); });
    expect(ref.current.permissions.roles['decisions:affectedID'].capabilities.editDecisionTracking).toBe(true);
  });

  /*
   * The backfill is a READ-time heal, not a migration: it must not trigger a storage
   * write. Persisting it would rewrite the owner's permissions blob on a plain page load,
   * turning inferred defaults into stored state behind their back.
   */
  it('does not persist the backfill', async () => {
    storageState.getItem = vi.fn(async () => ({ data: { value: JSON.stringify(LEGACY) } }));
    await act(async () => { renderSettings(); });
    expect(storageState.setItem).not.toHaveBeenCalled();
  });
});

describe('round337 — stored columns are reconciled onto the code schema at load', () => {
  it('replaces a stale stored `type` with the schema type, keeping id and verified', async () => {
    let ref;
    await act(async () => { ref = renderSettings(); });
    const col = ref.current.settings.columns.discussions[ALIAS];
    expect(col.type).toBe(SCHEMA_TYPE);
    expect(col.type).not.toBe('stale_type_from_old_schema');
    expect(col.id).toBe('col_live_1');
    expect(col.verified).toBe(true);
  });

  it('keeps an owner-set title (schema title is only a fallback)', async () => {
    let ref;
    await act(async () => { ref = renderSettings(); });
    expect(ref.current.settings.columns.discussions[ALIAS].title).toBe('שם שהבעלים קבע');
  });

  it('publishes the RECONCILED columns to the SDK store, not the raw stored ones', async () => {
    await act(async () => { renderSettings(); });
    expect(setActiveConfig).toHaveBeenCalled();
    const published = setActiveConfig.mock.calls.at(-1)[0];
    expect(published.columns.discussions[ALIAS].type).toBe(SCHEMA_TYPE);
  });
});
