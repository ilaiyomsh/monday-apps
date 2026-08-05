import { describe, it, expect } from 'vitest';
import { evaluateStatusChange } from '../src/guard/evaluateStatusChange.js';

// Column labels used across the suite. ids are STRINGS, per the contract.
// '4' is deactivated on the column; '5' is the reserved empty/grey identity
// and is deliberately NOT present on the column unless a test adds it.
const LABELS = [
  { id: '0', label: 'ממתין' },
  { id: '1', label: 'בעבודה' },
  { id: '2', label: 'נסתר' },
  { id: '3', label: 'בוצע' },
  { id: '4', label: 'מבוטל', isDeactivated: true },
];

function makeSettings(labelRules = {}, hiddenLabelIds = []) {
  return { version: 1, hiddenLabelIds, labels: labelRules };
}

function makeInput(overrides = {}) {
  return {
    settings: makeSettings(),
    labels: LABELS,
    actor: { userId: '7', teamIds: ['20'] },
    previousLabelId: '0',
    newLabelId: '1',
    peopleByColumnId: {},
    requiredFieldValues: [],
    ...overrides,
  };
}

describe('defaults and purity', () => {
  it('allows any change when there are no settings at all (settings null)', () => {
    const verdict = evaluateStatusChange(
      makeInput({ settings: null, previousLabelId: '3', newLabelId: '1' })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it('is pure: the same input evaluated twice yields the identical verdict without throwing', () => {
    const input = makeInput({
      settings: makeSettings({ '0': { nextLabelIds: [] } }),
      previousLabelId: '0',
      newLabelId: '3',
    });
    const first = evaluateStatusChange(input);
    const second = evaluateStatusChange(input);
    expect(first).toEqual({ allowed: false, reason: 'not-offered' });
    expect(second).toEqual(first);
  });
});

describe('transitions (nextLabelIds of the source rule)', () => {
  it('allows a change when the source rule lists the target in nextLabelIds', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '0': { nextLabelIds: ['1', '3'] } }),
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it('blocks a change to a label the source rule does not list in nextLabelIds', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '0': { nextLabelIds: ['1'] } }),
        previousLabelId: '0',
        newLabelId: '3',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('blocks every change out of a terminal label (nextLabelIds is an empty array)', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '3': { nextLabelIds: [] } }),
        previousLabelId: '3',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('treats an ABSENT nextLabelIds field as unrestricted (unlike the empty array)', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '3': { allowedUserIds: [], allowedTeamIds: [] } }),
        previousLabelId: '3',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it("governs a change out of an EMPTY cell by rule '5': targets it lists pass, others do not", () => {
    const settings = makeSettings({ '5': { nextLabelIds: ['1'] } });
    expect(
      evaluateStatusChange(
        makeInput({ settings, previousLabelId: null, newLabelId: '1' })
      )
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluateStatusChange(
        makeInput({ settings, previousLabelId: null, newLabelId: '3' })
      )
    ).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it("blocks picking id '5' from an empty cell (empty ≡ grey — it is already the current state)", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings(),
        labels: [...LABELS, { id: '5', label: '' }],
        previousLabelId: null,
        newLabelId: '5',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('allows re-setting the SAME label (no-op event), even when transitions would forbid it', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '1': { nextLabelIds: [] } }),
        previousLabelId: '1',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });
});

describe('hidden labels, deactivated labels and allowlists', () => {
  it('blocks a change to a label listed in hiddenLabelIds', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({}, ['2']),
        previousLabelId: '0',
        newLabelId: '2',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('blocks a change to a deactivated label and to an id that does not exist on the column', () => {
    expect(
      evaluateStatusChange(
        makeInput({ previousLabelId: '0', newLabelId: '4' })
      )
    ).toEqual({ allowed: false, reason: 'not-offered' });
    expect(
      evaluateStatusChange(
        makeInput({ previousLabelId: '0', newLabelId: '99' })
      )
    ).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('allows everyone when both allowedUserIds and allowedTeamIds are empty', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '1': { allowedUserIds: [], allowedTeamIds: [] } }),
        actor: { userId: '999', teamIds: [] },
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it('allows an actor who matches only via team membership (userId not in allowedUserIds)', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '1': { allowedUserIds: ['42'], allowedTeamIds: ['20'] },
        }),
        actor: { userId: '7', teamIds: ['20'] },
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it('blocks an actor who is in neither allowedUserIds nor any allowed team', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '1': { allowedUserIds: ['42'], allowedTeamIds: ['30'] },
        }),
        actor: { userId: '7', teamIds: ['20'] },
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('passes the requiredPeopleColumnIds gate when the actor is on the column via a team', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '1': { requiredPeopleColumnIds: ['owner_col'] },
        }),
        actor: { userId: '7', teamIds: ['20'] },
        peopleByColumnId: { owner_col: { personIds: [], teamIds: ['20'] } },
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it('fails closed when a listed people column has no entry in peopleByColumnId', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '1': { requiredPeopleColumnIds: ['owner_col', 'reviewer_col'] },
        }),
        actor: { userId: '7', teamIds: ['20'] },
        peopleByColumnId: { owner_col: { personIds: ['7'], teamIds: [] } },
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it('blocks the actor when they are missing from every listed people column', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '1': { requiredPeopleColumnIds: ['owner_col'] },
        }),
        actor: { userId: '7', teamIds: ['20'] },
        peopleByColumnId: { owner_col: { personIds: ['42'], teamIds: ['30'] } },
        previousLabelId: '0',
        newLabelId: '1',
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });
});

describe('clearing the cell (newLabelId null ≡ transition into id 5)', () => {
  it("allows clearing when the source rule lists '5', even though no id-5 label exists on the column", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '0': { nextLabelIds: ['5'] } }),
        labels: LABELS, // no '5' on the column — by design
        previousLabelId: '0',
        newLabelId: null,
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it("blocks clearing when the source rule's nextLabelIds does not include '5'", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '0': { nextLabelIds: ['1', '3'] } }),
        previousLabelId: '0',
        newLabelId: null,
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it("blocks clearing when rule '5''s own allowlist excludes the actor", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '5': { allowedUserIds: ['42'], allowedTeamIds: [] },
        }),
        actor: { userId: '7', teamIds: ['20'] },
        previousLabelId: '0',
        newLabelId: null,
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });
});

describe('required fields of the target rule', () => {
  const requireText = makeSettings({
    '1': { requiredColumnIds: ['text_col'] },
  });

  it("returns 'required-fields-unknown' when the caller could not read the item (requiredFieldValues null)", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: requireText,
        previousLabelId: '0',
        newLabelId: '1',
        requiredFieldValues: null,
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'required-fields-unknown' });
  });

  it('counts a required column that is missing from requiredFieldValues as empty (fail closed)', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: requireText,
        previousLabelId: '0',
        newLabelId: '1',
        requiredFieldValues: [
          { columnId: 'other_col', type: 'text', columnValue: { text: 'שלום' } },
        ],
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'required-fields-empty' });
  });

  it("returns 'required-fields-empty' when a required text column holds an empty value", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: requireText,
        previousLabelId: '0',
        newLabelId: '1',
        requiredFieldValues: [
          { columnId: 'text_col', type: 'text', columnValue: { text: '' } },
        ],
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'required-fields-empty' });
  });

  it('counts an UNCHECKED checkbox as empty even though it is a valid value', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({ '1': { requiredColumnIds: ['check_col'] } }),
        previousLabelId: '0',
        newLabelId: '1',
        requiredFieldValues: [
          { columnId: 'check_col', type: 'checkbox', columnValue: { text: '' } },
        ],
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'required-fields-empty' });
  });

  it('allows the change when every required column is filled, across all column types (status label id 0 counts as filled)', () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '1': {
            requiredColumnIds: [
              'text_col',
              'num_col',
              'date_col',
              'check_col',
              'people_col',
              'status_col',
              'rating_col',
            ],
          },
        }),
        previousLabelId: '0',
        newLabelId: '1',
        requiredFieldValues: [
          { columnId: 'text_col', type: 'text', columnValue: { text: 'שלום' } },
          { columnId: 'num_col', type: 'numbers', columnValue: { text: '5' } },
          { columnId: 'date_col', type: 'date', columnValue: { date: '2026-01-05' } },
          // checkbox/rating carry TYPED fragment fields (checked/rating) — the
          // registry reads those, not text (amend 2026-08-03: wrong shape specified).
          { columnId: 'check_col', type: 'checkbox', columnValue: { checked: true } },
          {
            columnId: 'people_col',
            type: 'people',
            columnValue: { persons_and_teams: [{ id: 7, kind: 'person' }] },
          },
          { columnId: 'status_col', type: 'status', columnValue: { index: 0, text: 'ממתין' } },
          { columnId: 'rating_col', type: 'rating', columnValue: { rating: 3 } },
        ],
      })
    );
    expect(verdict).toEqual({ allowed: true, reason: null });
  });

  it("lets the permission verdict win: a target that is both not offered and missing fields reports 'not-offered'", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings(
          { '1': { requiredColumnIds: ['text_col'] } },
          ['1'] // target is also hidden
        ),
        previousLabelId: '0',
        newLabelId: '1',
        requiredFieldValues: [
          { columnId: 'text_col', type: 'text', columnValue: { text: '' } },
        ],
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-offered' });
  });

  it("applies rule '5''s requiredColumnIds when clearing the cell: empty required date blocks the clear", () => {
    const verdict = evaluateStatusChange(
      makeInput({
        settings: makeSettings({
          '5': { requiredColumnIds: ['date_col'] },
        }),
        previousLabelId: '0',
        newLabelId: null,
        requiredFieldValues: [
          { columnId: 'date_col', type: 'date', columnValue: { date: null, text: '' } },
        ],
      })
    );
    expect(verdict).toEqual({ allowed: false, reason: 'required-fields-empty' });
  });
});
