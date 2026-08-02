/**
 * The grey DEFAULT label — monday's empty status, the one a cell shows before anybody
 * picks anything. The owner asked for its text to be editable here, exactly like a normal
 * status column's settings.
 *
 * What the live API says (probed 2026-07 in the sandbox workspace, boards deleted):
 *  - the grey label is the label whose colour is `explosive`; monday gives it id 5 and
 *    forces hex #c4c4c4 whatever colour was sent;
 *  - a fresh status column does NOT have it — it comes back with 4 labels and no id 5.
 *    The label does not exist in the API until it is given a name;
 *  - renaming works ("יש טקסט" → "טרם עודכן": same id, same hex), and clearing it to
 *    `label: ""` also works, the row coming back with id 5 intact;
 *  - all of it through the same `update_status_column` the app already uses.
 *
 * Two consequences shape everything below. A label created in that slot can never be
 * deleted, so it is only WRITTEN once somebody types a name — an untouched empty default
 * must leave no trace in the payload. And `explosive` is not a colour choice: it is the
 * slot's identity, so nothing may reassign it.
 */

import { describe, expect, it } from 'vitest';

import {
  RESERVED_EMPTY_LABEL_COLOR,
  RESERVED_EMPTY_LABEL_HEX,
  ensureUniqueStatusColors,
  isReservedEmptyLabelId,
} from './statusColors.js';
import {
  buildCreateLabelPayload,
  buildStatusLabelsUpdatePayload,
  buildUpdateStatusColumnMutation,
  createLabelsDraft,
  ensureDefaultLabelRow,
  hasPendingLabelEdits,
  insertLabelBeforeDefault,
  reorderLabelsDraft,
} from './statusLabelDraft.js';

/** A column monday never gave a default label — the shape a fresh column comes back in. */
const LIVE_WITHOUT_DEFAULT = [
  { id: '0', index: 0, label: 'ממתין', color: '#fdab3d', colorValue: 0, isDeactivated: false },
  { id: '1', index: 1, label: 'בוצע', color: '#00c875', colorValue: 1, isDeactivated: false },
];

/** The same column after somebody named the grey label. Note its index: 0, not last. */
const LIVE_WITH_DEFAULT = [
  { id: '5', index: 0, label: 'טרם עודכן', color: '#c4c4c4', colorValue: 5, isDeactivated: false },
  { id: '0', index: 1, label: 'ממתין', color: '#fdab3d', colorValue: 0, isDeactivated: false },
  { id: '1', index: 2, label: 'בוצע', color: '#00c875', colorValue: 1, isDeactivated: false },
];

const settingsList = (live) => ensureDefaultLabelRow(createLabelsDraft(live));
const defaultRowOf = (draft) => draft.find((label) => label.isDefaultEmpty);
const activeOf = (payload) => payload.filter((label) => !label.isDeactivated);

describe('the reserved-slot constants', () => {
  it('are the values the probe recorded, not whatever the module happens to export', () => {
    // Asserted as literals here — and as literals in every row expectation below —
    // because comparing a produced colour against the constant that produced it passes
    // for any value the constant takes (gap pattern P4). `explosive` is the write value
    // monday keys the slot on; #c4c4c4 is the grey it forces and the board shows.
    expect(RESERVED_EMPTY_LABEL_COLOR).toBe('explosive');
    expect(RESERVED_EMPTY_LABEL_HEX).toBe('#c4c4c4');
  });
});

describe('isReservedEmptyLabelId', () => {
  it('matches id 5 as a number and as the string the draft carries, and nothing else', () => {
    expect(isReservedEmptyLabelId(5)).toBe(true);
    expect(isReservedEmptyLabelId('5')).toBe(true);
    expect(isReservedEmptyLabelId(4)).toBe(false);
    expect(isReservedEmptyLabelId('15')).toBe(false);
    // A missing id must not read as the reserved one just because Number('') is 0.
    expect(isReservedEmptyLabelId('')).toBe(false);
    expect(isReservedEmptyLabelId(undefined)).toBe(false);
  });
});

describe('createLabelsDraft — the default label among the coloured ones', () => {
  it('flags the id-5 row, pins it to explosive/grey, and puts it last despite index 0', () => {
    const draft = createLabelsDraft(LIVE_WITH_DEFAULT);

    expect(draft.map((label) => label.id)).toEqual(['0', '1', '5']);
    expect(draft[2]).toEqual({
      clientKey: '5',
      id: '5',
      // One past the highest coloured index (1, 2 here — the live numbers, kept as they
      // are), so it sorts last through renumberDraftIndexes and a save writes it last.
      index: 3,
      label: 'טרם עודכן',
      color: '#c4c4c4',
      colorValue: 'explosive',
      isDone: false,
      description: undefined,
      isNew: false,
      isDefaultEmpty: true,
    });
  });

  it('leaves coloured labels unflagged and invents no default row of its own', () => {
    // buildCreateLabelPayload resends whatever this returns, so a row invented here
    // would silently create the undeletable label on every "add label" click.
    const draft = createLabelsDraft(LIVE_WITHOUT_DEFAULT);
    expect(draft).toHaveLength(2);
    expect(draft.some((label) => label.isDefaultEmpty)).toBe(false);
    expect(draft[0].isDefaultEmpty).toBeUndefined();
  });
});

describe('ensureDefaultLabelRow', () => {
  it('appends an empty grey row keyed to id 5 when the column has no default label', () => {
    const draft = ensureDefaultLabelRow(createLabelsDraft(LIVE_WITHOUT_DEFAULT));

    expect(draft).toHaveLength(3);
    expect(draft[2]).toEqual({
      clientKey: '5',
      id: '5',
      index: 2,
      label: '',
      color: '#c4c4c4',
      colorValue: 'explosive',
      isDone: false,
      description: undefined,
      isNew: false,
      isDefaultEmpty: true,
    });
  });

  it('keeps the existing default row as it is rather than adding a second one', () => {
    const draft = ensureDefaultLabelRow(createLabelsDraft(LIVE_WITH_DEFAULT));
    expect(draft.filter((label) => label.isDefaultEmpty)).toHaveLength(1);
    expect(defaultRowOf(draft).label).toBe('טרם עודכן');
  });

  it('numbers the appended row above every coloured label, sparse indexes included', () => {
    // A column with a removed label reads back non-contiguous, and the default row has
    // to sort last through renumberDraftIndexes, which orders by index and not position.
    const sparse = [
      { id: '0', index: 0, label: 'א', colorValue: 0, isDeactivated: false },
      { id: '2', index: 7, label: 'ב', colorValue: 2, isDeactivated: false },
    ];
    expect(defaultRowOf(ensureDefaultLabelRow(createLabelsDraft(sparse))).index).toBe(8);
  });

  it('survives a missing draft', () => {
    expect(ensureDefaultLabelRow(null)).toHaveLength(1);
    expect(defaultRowOf(ensureDefaultLabelRow(undefined)).index).toBe(0);
  });
});

describe('buildStatusLabelsUpdatePayload — when the default label gets written', () => {
  it('writes NOTHING for a default row that never existed and was left empty', () => {
    // The point of the whole rule: this label cannot be deleted once created, so an
    // admin who never typed in it must not end up with one.
    const payload = buildStatusLabelsUpdatePayload(
      settingsList(LIVE_WITHOUT_DEFAULT),
      LIVE_WITHOUT_DEFAULT,
    );

    expect(payload.map((label) => label.label)).toEqual(['ממתין', 'בוצע']);
    expect(payload.some((label) => label.color === 'explosive')).toBe(false);
  });

  it('treats whitespace as still-empty and writes nothing for it', () => {
    const draft = settingsList(LIVE_WITHOUT_DEFAULT)
      .map((label) => (label.isDefaultEmpty ? { ...label, label: '   ' } : label));
    expect(buildStatusLabelsUpdatePayload(draft, LIVE_WITHOUT_DEFAULT)).toHaveLength(2);
  });

  it('creates it with no id and colour explosive once a name is typed', () => {
    const draft = settingsList(LIVE_WITHOUT_DEFAULT)
      .map((label) => (label.isDefaultEmpty ? { ...label, label: 'טרם עודכן' } : label));
    const payload = buildStatusLabelsUpdatePayload(draft, LIVE_WITHOUT_DEFAULT);
    const created = payload.find((label) => label.label === 'טרם עודכן');

    expect(created).toEqual({
      color: 'explosive',
      label: 'טרם עודכן',
      // Last of the actives, so it lands where the settings screen shows it.
      index: 2,
      isDone: false,
      description: undefined,
      isDeactivated: false,
      isDefaultEmpty: true,
    });
    // No id: monday derives id 5 from the colour. Sending one would be a guess.
    expect('id' in created).toBe(false);
  });

  it('sends an empty string under id 5 when an EXISTING default label is cleared', () => {
    const draft = settingsList(LIVE_WITH_DEFAULT)
      .map((label) => (label.isDefaultEmpty ? { ...label, label: '' } : label));
    const payload = buildStatusLabelsUpdatePayload(draft, LIVE_WITH_DEFAULT);
    const reserved = payload.find((label) => label.id === 5);

    expect(reserved.label).toBe('');
    expect(reserved.color).toBe('explosive');
    expect(reserved.isDeactivated).toBe(false);
  });

  it('renames an existing default label in place, keeping id 5 and its colour', () => {
    const draft = settingsList(LIVE_WITH_DEFAULT)
      .map((label) => (label.isDefaultEmpty ? { ...label, label: 'עוד לא התחלנו' } : label));
    const payload = buildStatusLabelsUpdatePayload(draft, LIVE_WITH_DEFAULT);

    expect(payload.find((label) => label.id === 5)).toMatchObject({
      label: 'עוד לא התחלנו',
      color: 'explosive',
      index: 2,
    });
    // …and the coloured labels keep their own ids and order.
    expect(activeOf(payload).map((label) => [label.id, label.index]))
      .toEqual([[0, 0], [1, 1], [5, 2]]);
  });

  it('serialises the created default label as an unquoted explosive enum with no id', () => {
    const draft = settingsList(LIVE_WITHOUT_DEFAULT)
      .map((label) => (label.isDefaultEmpty ? { ...label, label: 'טרם עודכן' } : label));
    const mutation = buildUpdateStatusColumnMutation(
      buildStatusLabelsUpdatePayload(draft, LIVE_WITHOUT_DEFAULT),
    );

    expect(mutation).toMatch(/\{ color: explosive, label: "טרם עודכן", index: 2 \}/);
  });
});

describe('buildCreateLabelPayload with a default label on the column', () => {
  it('resends the default label, because a label left out of the payload is a DELETE', () => {
    const payload = buildCreateLabelPayload(LIVE_WITH_DEFAULT, { colorValue: 'dark_blue' });
    const reserved = payload.find((label) => label.id === 5);

    expect(reserved).toBeDefined();
    expect(reserved.label).toBe('טרם עודכן');
    expect(reserved.color).toBe('explosive');
  });
});

describe('hasPendingLabelEdits with the default row on screen', () => {
  it('reports nothing pending for a synthesised row nobody touched', () => {
    // Otherwise merely OPENING settings would fire a labels mutation on every save.
    const baseline = settingsList(LIVE_WITHOUT_DEFAULT);
    expect(hasPendingLabelEdits(settingsList(LIVE_WITHOUT_DEFAULT), baseline)).toBe(false);
  });

  it('reports a pending edit as soon as a name is typed into it', () => {
    const baseline = settingsList(LIVE_WITHOUT_DEFAULT);
    const typed = baseline.map((label) => (
      label.isDefaultEmpty ? { ...label, label: 'טרם עודכן' } : label
    ));
    expect(hasPendingLabelEdits(typed, baseline)).toBe(true);
  });
});

describe('reorderLabelsDraft — the default row is pinned last', () => {
  it('refuses to move the last coloured label past it', () => {
    const draft = settingsList(LIVE_WITHOUT_DEFAULT);
    const moved = reorderLabelsDraft(draft, '1', 1);

    expect(moved.map((label) => label.id)).toEqual(['0', '1', '5']);
    expect(moved.map((label) => label.index)).toEqual([0, 1, 2]);
  });

  it('refuses to move the default row itself, and still renumbers 0..n-1', () => {
    const draft = settingsList(LIVE_WITHOUT_DEFAULT);
    expect(reorderLabelsDraft(draft, '5', -1).map((label) => label.id)).toEqual(['0', '1', '5']);
  });

  it('still reorders the coloured labels among themselves', () => {
    const moved = reorderLabelsDraft(settingsList(LIVE_WITHOUT_DEFAULT), '0', 1);
    expect(moved.map((label) => label.id)).toEqual(['1', '0', '5']);
    expect(moved.map((label) => label.index)).toEqual([0, 1, 2]);
  });
});

describe('insertLabelBeforeDefault', () => {
  const NEW_ROW = {
    clientKey: '3', id: '3', index: 99, label: 'חדש', colorValue: 'dark_blue', isNew: false,
  };

  it('puts the new label above the default row and pushes the default one further up', () => {
    const next = insertLabelBeforeDefault(settingsList(LIVE_WITHOUT_DEFAULT), NEW_ROW);

    expect(next.map((label) => label.id)).toEqual(['0', '1', '3', '5']);
    expect(next.map((label) => label.index)).toEqual([0, 1, 2, 3]);
  });

  it('leaves the coloured labels — and any unsaved rename on them — untouched', () => {
    const edited = settingsList(LIVE_WITHOUT_DEFAULT)
      .map((label) => (label.id === '0' ? { ...label, label: 'בהמתנה' } : label));
    const next = insertLabelBeforeDefault(edited, NEW_ROW);

    expect(next[0].label).toBe('בהמתנה');
    expect(defaultRowOf(next).label).toBe('');
  });

  it('appends at the end when no default row is present', () => {
    const next = insertLabelBeforeDefault(createLabelsDraft(LIVE_WITHOUT_DEFAULT), NEW_ROW);
    expect(next.map((label) => label.id)).toEqual(['0', '1', '3']);
    expect(next[2].index).toBe(2);
  });
});

describe('ensureUniqueStatusColors — explosive belongs to the default label', () => {
  it('moves the colliding coloured label, never the default one', () => {
    // A colour clash is resolved by whoever is NOT the reserved slot: reassigning the
    // default row's colour would quietly turn it into an ordinary label.
    const unique = ensureUniqueStatusColors([
      { id: 2, color: 'explosive', label: 'תקוע', index: 0, isDeactivated: false },
      {
        color: 'explosive', label: 'טרם עודכן', index: 1, isDeactivated: false, isDefaultEmpty: true,
      },
    ]);

    expect(unique.find((label) => label.isDefaultEmpty).color).toBe('explosive');
    expect(unique.find((label) => label.id === 2).color).not.toBe('explosive');
    expect(unique.find((label) => label.id === 2).label).toBe('תקוע');
  });

  it('leaves an uncontested payload alone', () => {
    const unique = ensureUniqueStatusColors([
      { id: 0, color: 'working_orange', label: 'א', index: 0, isDeactivated: false },
      {
        id: 5, color: 'explosive', label: 'ריק', index: 1, isDeactivated: false, isDefaultEmpty: true,
      },
    ]);
    expect(unique.map((label) => label.color)).toEqual(['working_orange', 'explosive']);
  });
});
