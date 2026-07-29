import { describe, expect, it } from 'vitest';
import {
  NEW_LABEL_NAME,
  buildCreateLabelPayload,
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createLabelsDraft,
  findCreatedLabel,
  hasPendingLabelEdits,
  pruneSettingsForActiveLabels,
  renumberDraftIndexes,
  reorderLabelsDraft,
} from './statusLabelDraft.js';

const LIVE = [
  {
    id: '0',
    index: 0,
    label: 'ממתין',
    color: '#fdab3d',
    colorValue: 0,
    isDeactivated: false,
  },
  {
    id: '1',
    index: 1,
    label: 'בוצע',
    color: '#00c875',
    colorValue: 1,
    isDeactivated: false,
  },
  {
    id: '2',
    index: 2,
    label: 'ארכיון',
    color: '#808080',
    colorValue: 17,
    isDeactivated: true,
  },
];

/**
 * The transient row a create-payload carries: no monday id yet, so the payload omits
 * `id` and monday derives one from the colour. Labels reach the draft with a real id
 * (created on the click), so this shape only ever exists inside one mutation.
 */
const NEW_ROW = {
  clientKey: 'new:1',
  id: 'new:1',
  index: 9,
  label: NEW_LABEL_NAME,
  color: '#9d50dd',
  colorValue: 'purple',
  isNew: true,
};

describe('createLabelsDraft', () => {
  it('keeps only active labels and normalizes colorValue to enum names', () => {
    expect(createLabelsDraft(LIVE)).toEqual([
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'ממתין',
        color: '#fdab3d',
        colorValue: 'working_orange',
        // Carried so a save can send them BACK: update_status_column replaces the
        // labels array, so a field the payload omits is cleared, not preserved.
        isDone: false,
        description: undefined,
        isNew: false,
      },
      {
        clientKey: '1',
        id: '1',
        index: 1,
        label: 'בוצע',
        color: '#00c875',
        colorValue: 'done_green',
        isDone: false,
        description: undefined,
        isNew: false,
      },
    ]);
  });
});

describe('hasPendingLabelEdits', () => {
  it('detects rename, recolor, add, remove, reorder, and reports false for identical drafts', () => {
    const baseline = createLabelsDraft(LIVE);
    expect(hasPendingLabelEdits(baseline, baseline)).toBe(false);
    expect(hasPendingLabelEdits(
      [{ ...baseline[0], label: 'חדש' }, baseline[1]],
      baseline,
    )).toBe(true);
    expect(hasPendingLabelEdits(
      [{ ...baseline[0], colorValue: 'stuck_red' }, baseline[1]],
      baseline,
    )).toBe(true);
    expect(hasPendingLabelEdits([baseline[0]], baseline)).toBe(true);
    expect(hasPendingLabelEdits([...baseline, NEW_ROW], baseline)).toBe(true);
    expect(hasPendingLabelEdits(reorderLabelsDraft(baseline, '0', 1), baseline)).toBe(true);
  });
});

describe('reorderLabelsDraft', () => {
  it('moves a label by delta and renormalizes index to 0..n-1', () => {
    const draft = createLabelsDraft(LIVE);
    expect(reorderLabelsDraft(draft, '0', 1).map((label) => ({
      clientKey: label.clientKey,
      index: label.index,
    }))).toEqual([
      { clientKey: '1', index: 0 },
      { clientKey: '0', index: 1 },
    ]);
  });

  it('is a no-op at the edges and renormalizes stale indexes', () => {
    const draft = createLabelsDraft(LIVE).map((label, i) => ({ ...label, index: (i + 1) * 10 }));
    expect(reorderLabelsDraft(draft, '0', -1).map((label) => ({
      clientKey: label.clientKey,
      index: label.index,
    }))).toEqual([
      { clientKey: '0', index: 0 },
      { clientKey: '1', index: 1 },
    ]);
  });
});

describe('buildStatusLabelsUpdatePayload', () => {
  it('keeps existing ids, omits id for new labels, and deactivates removed live labels', () => {
    const draft = [
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'ממתין מחדש',
        color: '#fdab3d',
        colorValue: 'working_orange',
        // Carried so a save can send them BACK: update_status_column replaces the
        // labels array, so a field the payload omits is cleared, not preserved.
        isDone: false,
        description: undefined,
        isNew: false,
      },
      {
        clientKey: 'new:1',
        id: 'new:1',
        index: 2,
        label: 'חדש',
        color: '#00c875',
        colorValue: 'done_green',
        isNew: true,
      },
    ];

    // monday requires unique colors across the full payload (incl. deactivated).
    // Active keeps done_green; deactivated id:1 is remapped off the collision.
    //
    // The INDEXES asserted here changed in 3.9.1. This expectation used to read
    // `index: 2` on both the new active label and deactivated id:2 — it pinned the
    // payload that monday rejects with "Indexes should be unique" (INVALID_INPUT),
    // reported from production. Indexes are now one unique space across the whole
    // payload: actives 0..n-1 in display order, deactivated packed above them.
    expect(buildStatusLabelsUpdatePayload(draft, LIVE)).toEqual([
      {
        id: 0,
        color: 'working_orange',
        label: 'ממתין מחדש',
        isDone: false,
        description: undefined,
        index: 0,
        isDeactivated: false,
      },
      {
        color: 'done_green',
        label: 'חדש',
        isDone: false,
        description: undefined,
        index: 1,
        isDeactivated: false,
      },
      {
        id: 1,
        color: 'stuck_red',
        label: 'בוצע',
        isDone: false,
        description: undefined,
        index: 2,
        isDeactivated: true,
      },
      {
        id: 2,
        color: 'american_gray',
        label: 'ארכיון',
        isDone: false,
        description: undefined,
        index: 3,
        isDeactivated: true,
      },
    ]);
  });

  /*
   * "Indexes should be unique" — the production failure of 3.9.0, reported on the
   * first attempt to add a label (INVALID_INPUT from update_status_column).
   *
   * `update_status_column` replaces the FULL labels array, deactivated rows
   * included, and monday requires every index in it to be unique. Two independent
   * ways the old assignment broke that, both needing only a label that was removed
   * at some point in the past:
   *
   *  1. A new label takes `max(active index) + 1`, which collides with a DEACTIVATED
   *     label sitting above every active one — i.e. whenever the label removed last
   *     was the last one in the list.
   *  2. A reorder renumbers the actives to 0..n-1, which collides with a deactivated
   *     label whose index falls inside that range — i.e. any removed MIDDLE label.
   *
   * Neither is reachable from the labels the settings screen shows: the deactivated
   * rows are invisible in the UI and only appear in the payload. Both are pinned
   * here against the actual index numbers, since "unique" alone would also pass on a
   * payload that silently reshuffled the admin's order.
   */
  const indexesOf = (payload) => payload.map((label) => label.index);

  it('sends no duplicate index when the label removed last sat above every active one', () => {
    const live = [
      { id: '0', index: 0, label: 'א', colorValue: 0, isDeactivated: false },
      { id: '1', index: 1, label: 'ב', colorValue: 1, isDeactivated: false },
      { id: '2', index: 2, label: 'הוסר', colorValue: 2, isDeactivated: true },
      { id: '3', index: 3, label: 'הוסר2', colorValue: 3, isDeactivated: true },
    ];
    const draft = createLabelsDraft(live);
    const withNew = [...draft, { ...NEW_ROW, index: draft.length }];

    // Was [0, 1, 2, 2, 3] — the new label and deactivated id:2 both on 2.
    expect(indexesOf(buildStatusLabelsUpdatePayload(withNew, live))).toEqual([0, 1, 2, 3, 4]);
  });

  it('sends no duplicate index after a reorder over a removed middle label', () => {
    const live = [
      { id: '0', index: 0, label: 'א', colorValue: 0, isDeactivated: false },
      { id: '1', index: 1, label: 'הוסר', colorValue: 1, isDeactivated: true },
      { id: '2', index: 2, label: 'ב', colorValue: 2, isDeactivated: false },
      { id: '3', index: 3, label: 'ג', colorValue: 3, isDeactivated: false },
    ];
    const reordered = reorderLabelsDraft(createLabelsDraft(live), '3', -1);

    // Was [0, 1, 2, 1] — the reordered actives collided with deactivated id:1.
    expect(indexesOf(buildStatusLabelsUpdatePayload(reordered, live))).toEqual([0, 1, 2, 3]);
  });

  it('numbers the active labels 0..n-1 in the order the admin arranged', () => {
    // The order is the product decision the indexes carry; uniqueness must not be
    // bought by reshuffling it.
    const live = [
      { id: '0', index: 0, label: 'א', colorValue: 0, isDeactivated: false },
      { id: '1', index: 1, label: 'ב', colorValue: 1, isDeactivated: false },
      { id: '2', index: 2, label: 'ג', colorValue: 2, isDeactivated: false },
    ];
    const moved = reorderLabelsDraft(createLabelsDraft(live), '2', -2);
    const payload = buildStatusLabelsUpdatePayload(moved, live);

    expect(payload.map((label) => [label.label, label.index]))
      .toEqual([['ג', 0], ['א', 1], ['ב', 2]]);
  });

  it('packs the deactivated labels above the actives, keeping their relative order', () => {
    const live = [
      { id: '0', index: 0, label: 'א', colorValue: 0, isDeactivated: false },
      { id: '1', index: 1, label: 'ראשון-שהוסר', colorValue: 1, isDeactivated: true },
      { id: '2', index: 2, label: 'שני-שהוסר', colorValue: 2, isDeactivated: true },
    ];
    const payload = buildStatusLabelsUpdatePayload(createLabelsDraft(live), live);

    expect(payload.filter((label) => label.isDeactivated).map((label) => [label.id, label.index]))
      .toEqual([[1, 1], [2, 2]]);
  });
});

describe('renumberDraftIndexes', () => {
  /*
   * The draft has to hold the SAME numbers the payload will carry, because the payload
   * sends positions: deactivated rows are packed above the actives so no two indexes
   * collide, and a draft still holding a live column's sparse indexes would describe a
   * different order from the one being written.
   */
  it('renumbers to 0..n-1 in display order', () => {
    const draft = [
      { clientKey: 'a', index: 0 },
      { clientKey: 'b', index: 3 },
      { clientKey: 'c', index: 7 },
    ];
    expect(renumberDraftIndexes(draft)).toEqual([
      { clientKey: 'a', index: 0 },
      { clientKey: 'b', index: 1 },
      { clientKey: 'c', index: 2 },
    ]);
  });

  it('orders by index, not by array position', () => {
    const draft = [
      { clientKey: 'b', index: 5 },
      { clientKey: 'a', index: 2 },
    ];
    expect(renumberDraftIndexes(draft).map((label) => label.clientKey)).toEqual(['a', 'b']);
  });

  it('keeps every other field, and copies rather than mutating', () => {
    const draft = [{ clientKey: 'a', id: 'a', index: 9, label: 'א', isNew: true }];
    const out = renumberDraftIndexes(draft);
    expect(out[0]).toEqual({ clientKey: 'a', id: 'a', index: 0, label: 'א', isNew: true });
    expect(draft[0].index).toBe(9);
  });

  it('survives a missing draft', () => {
    expect(renumberDraftIndexes(null)).toEqual([]);
    expect(renumberDraftIndexes(undefined)).toEqual([]);
  });

  it('remaps duplicate colors on active labels so the second keeps a free enum', () => {
    const draft = [
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'א',
        color: '#00c875',
        colorValue: 'done_green',
        isDone: false,
        description: undefined,
        isNew: false,
      },
      {
        clientKey: '1',
        id: '1',
        index: 1,
        label: 'ב',
        color: '#00c875',
        colorValue: 'done_green',
        isDone: false,
        description: undefined,
        isNew: false,
      },
    ];
    const live = [
      { id: '0', index: 0, label: 'א', color: '#00c875', colorValue: 1 },
      { id: '1', index: 1, label: 'ב', color: '#00c875', colorValue: 1 },
    ];
    expect(buildStatusLabelsUpdatePayload(draft, live)).toEqual([
      {
        id: 0,
        color: 'done_green',
        label: 'א',
        index: 0,
        isDone: false,
        description: undefined,
        isDeactivated: false,
      },
      {
        id: 1,
        color: 'working_orange',
        label: 'ב',
        index: 1,
        isDone: false,
        description: undefined,
        isDeactivated: false,
      },
    ]);
  });
});

describe('buildUpdateStatusColumnMutation', () => {
  it('emits unquoted StatusColumnColors enums and includes deactivated flags', () => {
    const mutation = buildUpdateStatusColumnMutation([
      {
        id: 0,
        color: 'working_orange',
        label: 'ממתין',
        index: 0,
        isDeactivated: false,
      },
      {
        color: 'done_green',
        label: 'חדש',
        isDone: false,
        description: undefined,
        index: 1,
        isDeactivated: false,
      },
      {
        id: 2,
        color: 'american_gray',
        label: 'ישן',
        index: 2,
        isDeactivated: true,
      },
    ]);

    expect(mutation).toContain('update_status_column(');
    expect(mutation).toContain('color: working_orange');
    expect(mutation).toContain('color: done_green');
    expect(mutation).toContain('is_deactivated: true');
    expect(mutation).not.toContain('id: undefined');
    expect(mutation).toContain('label: "ממתין"');
    // New label must not invent an id field.
    expect(mutation).toMatch(/\{\s*color: done_green, label: "חדש"/);
  });
});

describe('pruneSettingsForActiveLabels', () => {
  it('drops rules and hidden ids for labels that are no longer active', () => {
    expect(pruneSettingsForActiveLabels(
      {
        version: 1,
        hiddenLabelIds: ['0', '1'],
        labels: {
          0: { allowedUserIds: ['1'], allowedTeamIds: [], requiredColumnIds: [] },
          1: { allowedUserIds: [], allowedTeamIds: ['9'], requiredColumnIds: ['text'] },
        },
      },
      ['0'],
    )).toEqual({
      version: 1,
      hiddenLabelIds: ['0'],
      labels: {
        0: {
          allowedUserIds: ['1'],
          allowedTeamIds: [],
          requiredColumnIds: [],
          requiredPeopleColumnIds: [],
        },
      },
    });
  });

  it('treats null settings as empty rules when pruning', () => {
    expect(pruneSettingsForActiveLabels(null, ['0', '1'])).toEqual({
      version: 1,
      hiddenLabelIds: [],
      labels: {},
    });
  });
});

describe('buildCreateLabelPayload', () => {
  it('resends every existing label — omitting one would DELETE it — and appends the new one', () => {
    const payload = buildCreateLabelPayload(LIVE, { colorValue: 'dark_blue' });

    // Both actives kept their ids; the deactivated row is still in the payload.
    expect(payload.filter((label) => !label.isDeactivated).map((label) => label.id))
      .toEqual([0, 1, undefined]);
    expect(payload.find((label) => label.isDeactivated).id).toBe(2);
  });

  it('sends the new label with NO id, so monday derives it from the colour', () => {
    const payload = buildCreateLabelPayload(LIVE, { colorValue: 'dark_blue' });
    const created = payload.find((label) => label.id === undefined);
    expect(created.color).toBe('dark_blue');
    expect(created.label).toBe(NEW_LABEL_NAME);
  });

  it('gives every row a unique index, the deactivated one packed above the actives', () => {
    const payload = buildCreateLabelPayload(LIVE, { colorValue: 'dark_blue' });
    const indexes = payload.map((label) => label.index);
    expect(indexes).toEqual([...new Set(indexes)]);
    expect(payload.find((label) => label.isDeactivated).index)
      .toBeGreaterThan(Math.max(...payload.filter((l) => !l.isDeactivated).map((l) => l.index)));
  });

  it('preserves is_done on the labels it resends', () => {
    const live = [{
      id: '1', index: 0, label: 'בוצע', colorValue: 1, isDone: true, isDeactivated: false,
    }];
    const payload = buildCreateLabelPayload(live, { colorValue: 'dark_blue' });
    expect(payload.find((label) => label.id === 1).isDone).toBe(true);
  });

  it('accepts an explicit name', () => {
    const payload = buildCreateLabelPayload(LIVE, { colorValue: 'dark_blue', label: 'בבדיקה' });
    expect(payload.find((label) => label.id === undefined).label).toBe('בבדיקה');
  });
});

describe('findCreatedLabel', () => {
  const before = [{ id: '0' }, { id: '1' }];

  it('returns the label the refresh has that the pre-mutation read did not', () => {
    const created = findCreatedLabel(before, [{ id: '0' }, { id: '1' }, { id: '3', label: 'חדש' }]);
    expect(created.id).toBe('3');
  });

  it('never returns a label that already existed, however well it matches', () => {
    expect(findCreatedLabel(before, [{ id: '0', label: 'חדש' }, { id: '1' }])).toBeNull();
  });

  it('ignores a deactivated row that happens to be new to us', () => {
    expect(findCreatedLabel(before, [...before, { id: '3', isDeactivated: true }])).toBeNull();
  });

  it('refuses to guess when TWO labels are new — a concurrent editor', () => {
    // Picking either would hand this admin's rename to somebody else's label.
    expect(findCreatedLabel(before, [...before, { id: '3' }, { id: '4' }])).toBeNull();
  });

  it('returns null when the refresh shows nothing new', () => {
    expect(findCreatedLabel(before, before)).toBeNull();
    expect(findCreatedLabel()).toBeNull();
  });
});
