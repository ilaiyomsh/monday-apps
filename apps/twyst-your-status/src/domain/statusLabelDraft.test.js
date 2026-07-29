import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNewLabelSeqForTests,
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createBlankLabelDraft,
  createLabelsDraft,
  hasPendingLabelEdits,
  pruneSettingsForActiveLabels,
  remapDraftLabelKeys,
  renumberDraftIndexes,
  reorderLabelsDraft,
  resolveNewLabelIds,
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
        isNew: false,
      },
      {
        clientKey: '1',
        id: '1',
        index: 1,
        label: 'בוצע',
        color: '#00c875',
        colorValue: 'done_green',
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
    expect(hasPendingLabelEdits([...baseline, createBlankLabelDraft(baseline)], baseline)).toBe(true);
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
  beforeEach(() => {
    __resetNewLabelSeqForTests();
  });

  it('keeps existing ids, omits id for new labels, and deactivates removed live labels', () => {
    const draft = [
      {
        clientKey: '0',
        id: '0',
        index: 0,
        label: 'ממתין מחדש',
        color: '#fdab3d',
        colorValue: 'working_orange',
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
        index: 0,
        isDeactivated: false,
      },
      {
        color: 'done_green',
        label: 'חדש',
        index: 1,
        isDeactivated: false,
      },
      {
        id: 1,
        color: 'stuck_red',
        label: 'בוצע',
        index: 2,
        isDeactivated: true,
      },
      {
        id: 2,
        color: 'american_gray',
        label: 'ארכיון',
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
    const withNew = [...draft, createBlankLabelDraft(draft)];

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
   * The caller needs the SAME numbers the payload will carry: resolveNewLabelIds
   * matches a new label to its assigned id by text and index, so a draft still
   * holding `max + 1` while monday stored the packed position would fall back to
   * matching on text alone — and two new labels with the same name would then be
   * unresolvable, costing the user the permissions they just configured.
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
        isNew: false,
      },
      {
        clientKey: '1',
        id: '1',
        index: 1,
        label: 'ב',
        color: '#00c875',
        colorValue: 'done_green',
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
        isDeactivated: false,
      },
      {
        id: 1,
        color: 'working_orange',
        label: 'ב',
        index: 1,
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

/*
 * Permissions on a label that does not exist yet.
 *
 * A brand-new label has no monday id until `update_status_column` has run, and the
 * settings are keyed BY that id — which is why the settings screen used to hide the
 * permissions accordion on a new card entirely. These two functions are what let it
 * be configured in the same visit: rules are held under the draft's `clientKey`
 * ("new:1"), and once monday has answered they are moved to the real id.
 *
 * The move is the dangerous part, so the matching never GUESSES: an unmatched draft
 * stays unresolved (its rules are then dropped by the prune) rather than having
 * someone else's permissions attached to it.
 */
const liveBefore = [
  { id: '0', index: 0, label: 'ממתין', isDeactivated: false },
  { id: '1', index: 1, label: 'בוצע', isDeactivated: false },
];

const newDraft = (clientKey, label, index) => ({
  clientKey, id: clientKey, label, index, isNew: true,
});

describe('resolveNewLabelIds', () => {
  it('maps the new draft to the id monday assigned it', () => {
    const map = resolveNewLabelIds({
      draft: [...createLabelsDraft(liveBefore), newDraft('new:1', 'בבדיקה', 2)],
      liveBefore,
      refreshedLabels: [...liveBefore, { id: '7', index: 2, label: 'בבדיקה', isDeactivated: false }],
    });
    expect(map).toEqual({ 'new:1': '7' });
  });

  it('keeps two new labels apart when they were added in one save', () => {
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'בבדיקה', 2), newDraft('new:2', 'הוקפא', 3)],
      liveBefore,
      refreshedLabels: [
        ...liveBefore,
        { id: '7', index: 2, label: 'בבדיקה', isDeactivated: false },
        { id: '8', index: 3, label: 'הוקפא', isDeactivated: false },
      ],
    });
    expect(map).toEqual({ 'new:1': '7', 'new:2': '8' });
  });

  it('separates two new labels that share a NAME by their index', () => {
    // monday allows duplicate label text, so name alone cannot be the key. Index is
    // what we sent per label, so it is what breaks the tie. Getting this wrong hands
    // one label the other's permissions.
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'כפול', 2), newDraft('new:2', 'כפול', 3)],
      liveBefore,
      refreshedLabels: [
        ...liveBefore,
        { id: '7', index: 2, label: 'כפול', isDeactivated: false },
        { id: '8', index: 3, label: 'כפול', isDeactivated: false },
      ],
    });
    expect(map).toEqual({ 'new:1': '7', 'new:2': '8' });
  });

  it('never claims a label that already existed before the save', () => {
    // The candidate set is what is NEW, not what merely matches. A pre-existing
    // label renamed to the new label's text must not be claimed.
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'ממתין', 5)],
      liveBefore,
      refreshedLabels: [
        { id: '0', index: 0, label: 'ממתין', isDeactivated: false },
        { id: '1', index: 1, label: 'בוצע', isDeactivated: false },
      ],
    });
    expect(map).toEqual({});
  });

  it('ignores a deactivated new id', () => {
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'בבדיקה', 2)],
      liveBefore,
      refreshedLabels: [...liveBefore, { id: '7', index: 2, label: 'בבדיקה', isDeactivated: true }],
    });
    expect(map).toEqual({});
  });

  it('matches on the index alone when monday altered the text', () => {
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', '  בבדיקה  ', 2)],
      liveBefore,
      refreshedLabels: [...liveBefore, { id: '7', index: 2, label: 'בבדיקה', isDeactivated: false }],
    });
    expect(map).toEqual({ 'new:1': '7' });
  });

  it('matches on the text alone when monday altered the index', () => {
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'בבדיקה', 2)],
      liveBefore,
      refreshedLabels: [...liveBefore, { id: '7', index: 9, label: 'בבדיקה', isDeactivated: false }],
    });
    expect(map).toEqual({ 'new:1': '7' });
  });

  it('leaves a draft unresolved rather than guessing, when neither text nor index matches', () => {
    // The whole point of not falling back to "zip them in order": a wrong guess
    // attaches permissions to the wrong status, which is worse than losing them.
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'בבדיקה', 2)],
      liveBefore,
      refreshedLabels: [...liveBefore, { id: '7', index: 9, label: 'משהו אחר', isDeactivated: false }],
    });
    expect(map).toEqual({});
  });

  it('never gives one new id to two drafts', () => {
    const map = resolveNewLabelIds({
      draft: [newDraft('new:1', 'כפול', 2), newDraft('new:2', 'כפול', 2)],
      liveBefore,
      refreshedLabels: [...liveBefore, { id: '7', index: 2, label: 'כפול', isDeactivated: false }],
    });
    expect(Object.values(map)).toEqual(['7']);
  });

  it('returns nothing when the save added no label at all', () => {
    expect(resolveNewLabelIds({
      draft: createLabelsDraft(liveBefore),
      liveBefore,
      refreshedLabels: liveBefore,
    })).toEqual({});
    expect(resolveNewLabelIds({})).toEqual({});
  });
});

describe('remapDraftLabelKeys', () => {
  const draftSettings = {
    version: 1,
    hiddenLabelIds: ['0', 'new:1'],
    labels: {
      0: { allowedUserIds: ['1'], allowedTeamIds: [], requiredColumnIds: [] },
      'new:1': { allowedUserIds: ['4'], allowedTeamIds: [], requiredColumnIds: ['text_1'] },
    },
  };

  it('moves the new label rule onto the id monday assigned', () => {
    expect(remapDraftLabelKeys(draftSettings, { 'new:1': '7' })).toEqual({
      version: 1,
      hiddenLabelIds: ['0', '7'],
      labels: {
        0: { allowedUserIds: ['1'], allowedTeamIds: [], requiredColumnIds: [] },
        7: { allowedUserIds: ['4'], allowedTeamIds: [], requiredColumnIds: ['text_1'] },
      },
    });
  });

  it('leaves the settings untouched when nothing was remapped', () => {
    expect(remapDraftLabelKeys(draftSettings, {})).toEqual(draftSettings);
  });

  it('lets the remapped rule win over a stale rule already under that id', () => {
    // The id monday just handed out can be one a deactivated label used to hold, and
    // storage may still carry its rule. The rule the user just configured wins.
    const withStale = {
      version: 1,
      hiddenLabelIds: [],
      labels: {
        7: { allowedUserIds: ['999'], allowedTeamIds: [], requiredColumnIds: [] },
        'new:1': { allowedUserIds: ['4'], allowedTeamIds: [], requiredColumnIds: [] },
      },
    };
    expect(remapDraftLabelKeys(withStale, { 'new:1': '7' }).labels).toEqual({
      7: { allowedUserIds: ['4'], allowedTeamIds: [], requiredColumnIds: [] },
    });
  });

  it('does not list a hidden id twice after the remap', () => {
    const bothHidden = { version: 1, hiddenLabelIds: ['7', 'new:1'], labels: {} };
    expect(remapDraftLabelKeys(bothHidden, { 'new:1': '7' }).hiddenLabelIds).toEqual(['7']);
  });

  it('survives settings it cannot read', () => {
    expect(remapDraftLabelKeys(null, { 'new:1': '7' })).toBeNull();
    expect(remapDraftLabelKeys({ version: 1 }, { 'new:1': '7' }))
      .toEqual({ version: 1, hiddenLabelIds: [], labels: {} });
  });
});
