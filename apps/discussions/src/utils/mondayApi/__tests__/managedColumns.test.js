import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bake the routing implementation into the hoisted mock (this reliably forwards
// the query arg); control the scenario via the mutable `state`.
const { api, state } = vi.hoisted(() => {
  const state = { boardLabels: [], managed: [], reject: false };
  return {
    state,
    api: vi.fn(async (q) => {
      if (state.reject) throw new Error('network');
      const s = String(q);
      if (s.includes('update_status_managed_column')) return { update_status_managed_column: { id: 'u', revision: 2 } };
      if (s.includes('managed_column')) return { managed_column: state.managed };
      return { boards: [{ columns: [{ id: 'c', settings: { labels: state.boardLabels } }] }] };
    }),
  };
});
vi.mock('../monday-client.js', () => ({ api }));

import { detectManagedColumnId, addManagedStatusLabel, renameManagedDropdownLabel, toColorEnum, STATUS_COLOR_ENUMS, VIVID_COLOR_ENUMS, pickNewLabelColor } from '../managedColumns.js';

beforeEach(() => {
  api.mockClear();
  state.boardLabels = [];
  state.managed = [];
  state.reject = false;
});

describe('toColorEnum', () => {
  it('maps a numeric color index via the real StatusColumnColors order', () => {
    expect(toColorEnum(0)).toBe('working_orange');
    expect(toColorEnum(1)).toBe('done_green');
    expect(toColorEnum(2)).toBe('stuck_red');
    expect(toColorEnum(3)).toBe('dark_blue');
  });
  it('passes through a valid enum name and falls back for junk', () => {
    expect(toColorEnum('purple')).toBe('purple');
    expect(STATUS_COLOR_ENUMS).toContain(toColorEnum('#fdab3d', 4));
  });
});

describe('pickNewLabelColor', () => {
  it('never returns a muted/gray enum (esp. explosive → renders default gray)', () => {
    expect(VIVID_COLOR_ENUMS).not.toContain('explosive');
    expect(VIVID_COLOR_ENUMS).not.toContain('american_gray');
    // every vivid color is a valid StatusColumnColors enum name
    VIVID_COLOR_ENUMS.forEach((c) => expect(STATUS_COLOR_ENUMS).toContain(c));
  });
  it('picks the first vivid color not already used', () => {
    const used = ['working_orange', 'done_green', 'stuck_red', 'dark_blue', 'purple'];
    const c = pickNewLabelColor(used, 5);
    expect(used).not.toContain(c);
    expect(VIVID_COLOR_ENUMS).toContain(c);
  });
});

describe('detectManagedColumnId', () => {
  it('returns the managed UUID when the board column label set matches exactly', async () => {
    state.boardLabels = [{ id: 0, label: 'כספים' }, { id: 1, label: 'הנהלה' }];
    state.managed = [
      { id: 'other', settings_json: { labels: [{ id: 0, label: 'x' }] } },
      { id: 'match', settings_json: { labels: [{ id: 0, label: 'כספים' }, { id: 1, label: 'הנהלה' }] } },
    ];
    expect(await detectManagedColumnId('b1', 'c')).toBe('match');
  });

  it('returns null (regular column) when no managed label set matches', async () => {
    state.boardLabels = [{ id: 0, label: 'כספים' }];
    state.managed = [{ id: 'm', settings_json: { labels: [{ id: 0, label: 'other' }] } }];
    expect(await detectManagedColumnId('b1', 'c')).toBeNull();
  });

  it('returns null on API failure (falls back to regular path)', async () => {
    state.reject = true;
    expect(await detectManagedColumnId('b1', 'c')).toBeNull();
  });
});

describe('addManagedStatusLabel', () => {
  it('returns the existing id without mutating on a duplicate name', async () => {
    state.managed = [{ id: 'u', revision: 1, settings_json: { labels: [{ id: 0, label: 'כספים', index: 0, color: 0 }] } }];
    const r = await addManagedStatusLabel({ managedColumnId: 'u', title: 'כספים' });
    expect(r.duplicateId).toBe(0);
    expect(api.mock.calls.some(([q]) => String(q).includes('update_status_managed_column'))).toBe(false);
  });

  it('echoes all labels + appends the new one (no id, enum color) and mutates', async () => {
    state.managed = [{ id: 'u', revision: 3, settings_json: { labels: [
      { id: 0, label: 'א', index: 0, color: 0, is_deactivated: false },
      { id: 7, label: 'ישן', index: 1, color: 2, is_deactivated: true },
    ] } }];
    const r = await addManagedStatusLabel({ managedColumnId: 'u', title: 'משפטי' });
    expect(r.ok).toBe(true);
    const mut = api.mock.calls.find(([q]) => String(q).includes('update_status_managed_column'));
    const vars = mut[1];
    expect(vars.rev).toBe(3);
    expect(vars.s.labels).toHaveLength(3);              // 2 existing (incl. deactivated) + new
    expect(vars.s.labels.find((l) => l.is_deactivated)).toBeTruthy();
    const created = vars.s.labels.find((l) => l.label === 'משפטי');
    expect(created.id).toBeUndefined();
    vars.s.labels.forEach((l) => expect(STATUS_COLOR_ENUMS).toContain(l.color));
  });
});

/*
 * round304 — renaming a label on an account MANAGED dropdown column (how a
 * discussion type, i.e. its template, is renamed when the "סוג דיון" column is a
 * managed instance). The full label set must be re-sent with only the target's
 * TEXT changed: its id is what every item's value points at, and omitting a label
 * is a DELETE attempt.
 */
describe('renameManagedDropdownLabel', () => {
  const column = (labels, revision = 5) => [{ id: 'u', revision, settings_json: { labels } }];
  const LABELS = [
    { id: 1, label: 'סבב', is_deactivated: false },
    { id: 2, label: 'תכנון', is_deactivated: false },
    { id: 9, label: 'ישן', is_deactivated: true },
  ];

  it('re-sends every label with the target renamed, keeping ids and flags, at the read revision', async () => {
    state.managed = column(LABELS);
    const r = await renameManagedDropdownLabel({ managedColumnId: 'u', labelId: 1, title: 'סבב שבועי' });
    expect(r.ok).toBe(true);
    const mut = api.mock.calls.find(([q]) => String(q).includes('update_dropdown_managed_column'));
    expect(mut[1].rev).toBe(5);
    expect(mut[1].s.labels).toEqual([
      { id: 1, label: 'סבב שבועי', is_deactivated: false },
      { id: 2, label: 'תכנון', is_deactivated: false },
      { id: 9, label: 'ישן', is_deactivated: true },
    ]);
  });

  it('does not mutate when the name is unchanged', async () => {
    state.managed = column(LABELS);
    const r = await renameManagedDropdownLabel({ managedColumnId: 'u', labelId: 2, title: ' תכנון ' });
    expect(r).toEqual({ ok: true, unchanged: true });
    expect(api.mock.calls.some(([q]) => String(q).includes('update_dropdown_managed_column'))).toBe(false);
  });

  it('refuses a name another ACTIVE label holds (never merge two types)', async () => {
    state.managed = column(LABELS);
    await expect(renameManagedDropdownLabel({ managedColumnId: 'u', labelId: 1, title: 'תכנון' }))
      .rejects.toMatchObject({ code: 'duplicate' });
    expect(api.mock.calls.some(([q]) => String(q).includes('update_dropdown_managed_column'))).toBe(false);
  });

  it('throws on missing args, a missing column, or an unknown label id', async () => {
    state.managed = column(LABELS);
    await expect(renameManagedDropdownLabel({ managedColumnId: 'u', labelId: 1, title: '  ' }))
      .rejects.toThrow(/missing/);
    await expect(renameManagedDropdownLabel({ managedColumnId: 'u', labelId: 404, title: 'חדש' }))
      .rejects.toThrow(/label not found/);
    state.managed = [];
    await expect(renameManagedDropdownLabel({ managedColumnId: 'u', labelId: 1, title: 'חדש' }))
      .rejects.toThrow(/managed column not found/);
  });
});
