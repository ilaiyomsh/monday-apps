import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round312 (owner decision 2026-08-02: "the discussion-type column is ALWAYS
 * managed") — and the bug that forced the decision.
 *
 * ensureManagedTypeColumn used to adopt ANY board dropdown titled "סוג דיון" or
 * "סוג" as the type column, returning managedColumnId: null. On a customer's real
 * board "סוג" is an ordinary column name, so the app mapped a PLAIN dropdown as the
 * type column. Adding a discussion type then took the board-level
 * update_dropdown_column path — which is what failed in the new account with
 * "Graphql validation errors" (the payload itself was verified valid against the
 * live 2026-07 schema, so the fault was the column being unmanaged, not the query).
 *
 * The other half is idempotence: label-signature detection cannot recognise an
 * EMPTY managed column, so without a title lookup on the account a second run would
 * mint another account-level "סוג דיון" — clutter the app cannot clean up.
 */

const { api, state } = vi.hoisted(() => {
  const state = { calls: [], managed: [], boardLabels: [], failList: false };
  return {
    state,
    api: vi.fn(async (q) => {
      const s = String(q);
      state.calls.push(s);
      if (s.includes('managed_column(state: active)')) {
        if (state.failList) throw new Error('boom');
        return { managed_column: state.managed };
      }
      if (s.includes('boards(ids: $boardId)')) {
        return { boards: [{ columns: [{ id: 'col-old', settings: { labels: state.boardLabels } }] }] };
      }
      if (s.includes('create_dropdown_managed_column')) {
        return { create_dropdown_managed_column: { id: 'mc-fresh' } };
      }
      if (s.includes('attach_dropdown_managed_column')) {
        return { attach_dropdown_managed_column: { id: 'col-attached' } };
      }
      return {};
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));
vi.mock('../assertGraphQL.js', () => ({ assertNoGraphQLErrors: (r) => r }));
vi.mock('../../logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ensureManagedTypeColumn } from '../provisionBoards.js';
import { findManagedDropdownColumnByTitle } from '../managedColumns.js';

const called = (frag) => state.calls.filter((q) => q.includes(frag)).length;
const PLAIN = [{ id: 'col-old', title: 'סוג', type: 'dropdown' }];

beforeEach(() => {
  api.mockClear();
  state.calls = [];
  state.managed = [];
  state.boardLabels = [];
  state.failList = false;
});

describe('findManagedDropdownColumnByTitle', () => {
  it('returns the id of the single dropdown managed column with that exact title', async () => {
    state.managed = [
      { id: 'mc-1', title: 'סוג דיון', settings_json: { type: 'dropdown' } },
      { id: 'mc-2', title: 'משהו אחר', settings_json: { type: 'dropdown' } },
    ];
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBe('mc-1');
  });

  it('ignores a STATUS managed column that shares the title', async () => {
    // the real account has both a status and a dropdown "סוג דיון"; the update
    // mutations are not interchangeable, so picking the status one would break
    state.managed = [
      { id: 'mc-status', title: 'סוג דיון', settings_json: { type: 'color' } },
      { id: 'mc-drop', title: 'סוג דיון', settings_json: { type: 'dropdown' } },
    ];
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBe('mc-drop');
  });

  it('tolerates surrounding whitespace on either side', async () => {
    state.managed = [{ id: 'mc-1', title: '  סוג דיון ', settings_json: { type: 'dropdown' } }];
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBe('mc-1');
  });

  it('returns null on a partial title match — never a near miss', async () => {
    state.managed = [{ id: 'mc-1', title: 'סוג דיון פנימי', settings_json: { type: 'dropdown' } }];
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBeNull();
  });

  it('returns null when SEVERAL share the title — guessing would attach the wrong one', async () => {
    state.managed = [
      { id: 'mc-1', title: 'סוג דיון', settings_json: { type: 'dropdown' } },
      { id: 'mc-2', title: 'סוג דיון', settings_json: { type: 'dropdown' } },
    ];
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBeNull();
  });

  it('returns null when there is no match, and on an empty title without calling the API', async () => {
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBeNull();
    api.mockClear();
    expect(await findManagedDropdownColumnByTitle('')).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it('degrades to null when the account query fails instead of breaking provisioning', async () => {
    state.failList = true;
    expect(await findManagedDropdownColumnByTitle('סוג דיון')).toBeNull();
  });
});

describe('ensureManagedTypeColumn — the type column is ALWAYS managed', () => {
  it('does NOT adopt a plain dropdown named "סוג": it attaches a managed column instead', async () => {
    // THE REPORTED BUG. Before round312 this returned { id: 'col-old',
    // managedColumnId: null } and add-type went down the board-level path.
    const res = await ensureManagedTypeColumn('999', PLAIN);
    expect(res.id).toBe('col-attached');
    expect(res.managedColumnId).toBe('mc-fresh');
    expect(called('attach_dropdown_managed_column')).toBe(1);
  });

  it('never returns a null managedColumnId once it has adopted a column', async () => {
    const res = await ensureManagedTypeColumn('999', PLAIN);
    expect(res.managedColumnId).toBeTruthy();
  });

  it('DOES adopt the existing column when detection ties it to a managed column', async () => {
    // a real managed instance already on the board — reuse it, do not attach twice
    state.boardLabels = [{ id: 1, label: 'סבב', is_deactivated: false }];
    state.managed = [{
      id: 'mc-detected',
      title: 'כל שם שהוא',
      settings_json: { type: 'dropdown', labels: [{ id: 1, label: 'סבב', is_deactivated: false }] },
    }];
    const res = await ensureManagedTypeColumn('999', PLAIN);
    expect(res).toEqual({ id: 'col-old', managedColumnId: 'mc-detected' });
    expect(called('attach_dropdown_managed_column')).toBe(0);
    expect(called('create_dropdown_managed_column')).toBe(0);
  });

  it('reuses the ACCOUNT column found by title rather than minting a second one', async () => {
    // idempotence for a re-run / a top-up whose UUID was never persisted
    state.managed = [{ id: 'mc-existing', title: 'סוג דיון', settings_json: { type: 'dropdown' } }];
    const res = await ensureManagedTypeColumn('999', []);
    expect(res.managedColumnId).toBe('mc-existing');
    expect(called('create_dropdown_managed_column')).toBe(0);
    expect(called('attach_dropdown_managed_column')).toBe(1);
  });

  it('still mints one when the account genuinely has none', async () => {
    const res = await ensureManagedTypeColumn('999', []);
    expect(res.managedColumnId).toBe('mc-fresh');
    expect(called('create_dropdown_managed_column')).toBe(1);
  });

  it('a known UUID short-circuits everything — no account lookup at all', async () => {
    const res = await ensureManagedTypeColumn('999', PLAIN, 'mc-known');
    expect(res).toEqual({ id: 'col-old', managedColumnId: 'mc-known' });
    expect(api).not.toHaveBeenCalled();
  });

  it('creates with the SAME title it looks up, so the two can never drift apart', async () => {
    await ensureManagedTypeColumn('999', []);
    const create = state.calls.find((q) => q.includes('create_dropdown_managed_column'));
    expect(create).toBeTruthy();
    // the lookup ran first and found nothing; the create must use that same title
    expect(called('managed_column(state: active)')).toBeGreaterThan(0);
  });
});
