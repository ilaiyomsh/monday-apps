import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route the SDK by query shape: board raw-labels read (has `revision`), the
// board update mutation, the managed-column read + managed mutation, and the
// post-write board reload (no `revision`).
const { api } = vi.hoisted(() => {
  const INITIAL = [
    { id: 1, label: 'פגישה', index: 0, color: 'grass_green', is_deactivated: false },
    { id: 2, label: 'סבב', index: 1, color: 'done_green', is_deactivated: false },
  ];
  const AFTER = [...INITIAL, { id: 3, label: 'חדש', index: 2, color: 'stuck_red', is_deactivated: false }];
  const MANAGED = [
    { id: 0, label: 'א', index: 0, color: 0, is_done: false, is_deactivated: false },
    { id: 1, label: 'ב', index: 1, color: 1, is_done: true, is_deactivated: false },
    { id: 9, label: 'ישן', index: 2, color: 2, is_done: false, is_deactivated: true },
  ];
  return {
    api: vi.fn(async (query) => {
      if (query.includes('update_status_managed_column')) return { update_status_managed_column: { id: 'uuid-1', revision: 2 } };
      if (query.includes('update_status_column')) return {};
      if (query.includes('managed_column')) return { managed_column: [{ id: 'uuid-1', revision: 1, settings_json: { labels: MANAGED } }] };
      if (query.includes('revision')) {
        return { boards: [{ columns: [{ id: 'col1', revision: 'rev-1', settings: { labels: INITIAL }, settings_str: '' }] }] };
      }
      return { boards: [{ columns: [{ id: 'col1', settings: { labels: AFTER }, settings_str: '' }] }] };
    }),
  };
});
vi.mock('../../utils/mondayApi/monday-client.js', () => ({ api }));

import { setActiveConfig } from '../../utils/mondayApi/board-config-store.js';
import { addStatusLabel, getVersion } from '../useStatusOptions.js';
import { STATUS_COLOR_ENUMS } from '../../utils/mondayApi/managedColumns.js';

beforeEach(() => {
  api.mockClear();
  setActiveConfig({
    boards: { discussions: { id: 'b1' } },
    columns: { discussions: { discussionTypeID: { id: 'col1' } } },
  });
});

describe('addStatusLabel — regular board column', () => {
  it('re-sends existing labels (with ids) + a new one (no id, valid enum color), bumps version, returns the new id', async () => {
    const before = getVersion();
    const newId = await addStatusLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'חדש' });

    const mutCall = api.mock.calls.find(([q]) => q.includes('update_status_column'));
    expect(mutCall).toBeTruthy();
    const [mutation, vars] = mutCall;
    // Existing labels echoed with ids; new label carries NO id → exactly two `id:`.
    expect((mutation.match(/id:\s*\d+/g) || []).length).toBe(2);
    expect(mutation).toContain('label: "חדש"');
    (mutation.match(/color:\s*(\w+)/g) || []).forEach((m) => {
      expect(STATUS_COLOR_ENUMS).toContain(m.replace(/color:\s*/, ''));
    });
    expect(vars.revision).toBe('rev-1');
    expect(newId).toBe(3);
    expect(getVersion()).toBeGreaterThan(before);
  });

  it('returns the existing id (no mutation) for a duplicate name', async () => {
    const id = await addStatusLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'פגישה' });
    expect(id).toBe(1);
    expect(api.mock.calls.some(([q]) => q.includes('update_status_column'))).toBe(false);
  });

  it('throws when the board/column is unmapped', async () => {
    setActiveConfig({ boards: {}, columns: { discussions: {} } });
    await expect(
      addStatusLabel({ boardKey: 'discussions', alias: 'discussionTypeID', title: 'x' })
    ).rejects.toThrow();
  });
});

describe('addStatusLabel — managed column', () => {
  it('uses update_status_managed_column (int revision), echoes ALL labels incl. deactivated, new label has no id + enum color', async () => {
    const newId = await addStatusLabel({
      boardKey: 'discussions', alias: 'discussionTypeID', title: 'חדש', managedColumnId: 'uuid-1',
    });

    // Board-level update_status_column must NOT be called for a managed column.
    expect(api.mock.calls.some(([q]) => q.includes('update_status_column') && !q.includes('managed'))).toBe(false);

    const mutCall = api.mock.calls.find(([q]) => q.includes('update_status_managed_column'));
    expect(mutCall).toBeTruthy();
    const [, vars] = mutCall;
    expect(vars.rev).toBe(1);                       // integer revision
    expect(vars.id).toBe('uuid-1');
    const labels = vars.s.labels;
    expect(labels).toHaveLength(4);                 // 3 existing (incl. deactivated) + 1 new
    // existing labels keep ids; the deactivated one is preserved
    expect(labels.filter((l) => 'id' in l && l.id != null)).toHaveLength(3);
    expect(labels.find((l) => l.is_deactivated)).toBeTruthy();
    // new label: no id, valid enum color, name
    const created = labels.find((l) => l.label === 'חדש');
    expect(created.id).toBeUndefined();
    expect(STATUS_COLOR_ENUMS).toContain(created.color);
    // colors of existing numeric-index labels are mapped to enum names
    labels.forEach((l) => expect(STATUS_COLOR_ENUMS).toContain(l.color));

    expect(newId).toBe(3);                          // resolved from the reloaded board column
  });
});
