/**
 * A new label's COLOUR decides its ID, so picking one is an identity decision.
 *
 * monday derives a created label's `id` from the numeric id of the colour sent, and
 * rejects the whole mutation when that id is already taken — deactivated rows included
 * (probe-verified 2026-07-29, live board; the rejection reads
 * `INVALID_ARGUMENT_EXCEPTION` / "request to change default status label color", naming
 * neither the colour nor the id). See monday-api references/column-formats.md.
 *
 * The trap this suite exists for: removing a label frees its COLOUR while its ID stays
 * taken forever, so a picker that only avoids colours-in-use reaches for exactly the
 * colour that will collide. On a default column that made "add a label" fail every time
 * after any removal.
 */

import { describe, expect, it } from 'vitest';

import {
  RESERVED_EMPTY_LABEL_ID,
  pickColorForNewLabel,
  statusColorEnumId,
} from './statusColors.js';

/** ids 0..n with colour == id — the shape a column has when monday created the labels. */
const naturalColumn = (ids) => ids.map((id) => ({ id: String(id), colorValue: id }));

describe('statusColorEnumId', () => {
  it('maps an enum name to the numeric id monday will assign a label created with it', () => {
    expect(statusColorEnumId('working_orange')).toBe(0);
    expect(statusColorEnumId('done_green')).toBe(1);
    expect(statusColorEnumId('purple')).toBe(4);
    expect(statusColorEnumId('explosive')).toBe(5);
    expect(statusColorEnumId('blackish')).toBe(10);
    expect(statusColorEnumId('teal')).toBe(160);
  });

  it('returns null for anything that is not a status colour enum', () => {
    expect(statusColorEnumId('not_a_colour')).toBeNull();
    expect(statusColorEnumId(undefined)).toBeNull();
  });
});

describe('pickColorForNewLabel', () => {
  it('skips the colour whose id belongs to a DEACTIVATED label', () => {
    // id 4 removed: colour purple(4) is free but id 4 is taken -> must not be picked.
    const labels = [
      ...naturalColumn([0, 1, 2, 3]),
      { id: '4', colorValue: 14, isDeactivated: true },
    ];
    const picked = pickColorForNewLabel(labels);
    expect(picked).not.toBe('purple');
    expect(statusColorEnumId(picked)).not.toBe(4);
  });

  it('never picks the reserved empty-label id 5 (monday forces it grey and it cannot be deleted)', () => {
    // ids 0..4 taken, so a naive lowest-free walk lands on explosive(5).
    const picked = pickColorForNewLabel(naturalColumn([0, 1, 2, 3, 4]));
    expect(picked).not.toBe('explosive');
    expect(statusColorEnumId(picked)).not.toBe(RESERVED_EMPTY_LABEL_ID);
  });

  it('picks the lowest colour that is free as BOTH a colour and an id', () => {
    // ids 0,1,2 with their own colours; 3 is free as id and colour.
    expect(pickColorForNewLabel(naturalColumn([0, 1, 2]))).toBe('dark_blue');
  });

  it('skips a colour that is in use even when its id is free', () => {
    // id 9 recoloured to dark_blue(3): id 3 is free but the colour is taken.
    const labels = [
      ...naturalColumn([0, 1, 2]),
      { id: '9', colorValue: 3 },
    ];
    const picked = pickColorForNewLabel(labels);
    expect(picked).not.toBe('dark_blue');
    expect(statusColorEnumId(picked)).not.toBe(9);
  });

  it('is safe on a default column after ANY single label is removed', () => {
    // The regression: every one of these used to yield the removed label's own colour.
    [0, 1, 2, 3].forEach((removed) => {
      const labels = naturalColumn([0, 1, 2, 3]).map((label) => (
        Number(label.id) === removed ? { ...label, isDeactivated: true } : label
      ));
      const picked = pickColorForNewLabel(labels);
      const takenIds = labels.map((label) => Number(label.id));
      expect(takenIds).not.toContain(statusColorEnumId(picked));
    });
  });

  it('treats a column with no labels at all as fully open, minus the reserved id', () => {
    expect(pickColorForNewLabel([])).toBe('working_orange');
  });

  it('throws rather than returning a colliding colour when nothing is left', () => {
    // Every colour id taken -> there is no safe choice to return.
    const allIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      151, 152, 153, 154, 155, 156, 157, 158, 159, 160];
    expect(() => pickColorForNewLabel(naturalColumn(allIds))).toThrow(/no .*colou?r/i);
  });
});
