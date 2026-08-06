import { describe, it, expect } from 'vitest';
import { canAddCustomColumn, CUSTOM_COLUMN_TYPE_GROUPS } from '../customColumns.js';
import { customFilterDims, customComparableValues, pristineFilterCol } from '../../components/MyTasksView/controls/controls.js';

/*
 * round372 (owner report) — TWO symptoms, ONE cause.
 *
 *   1. the mapping screen's "סטטוסים" group had no "+ הוספת עמודה מהלוח" button
 *   2. on the DISCUSSIONS board the "סטטוסים" group did not appear at all
 *
 * Both came from `status` being absent from CUSTOM_COLUMN_TYPE_GROUPS (the round364
 * spec said "NOT statuses"). The sidebar keeps a folder only when it has schema
 * entries OR custom columns may be added there, and the discussions schema has
 * ZERO status-type columns — so not-eligible meant the whole folder vanished.
 * The owner reversed that spec: statuses are now a first-class custom type
 * (checkboxes and computed fields deliberately stay out).
 */
describe('round372 — status is an eligible custom column type', () => {
  it('exposes status with monday\'s canonical type name', () => {
    expect(CUSTOM_COLUMN_TYPE_GROUPS.status).toBe('status');
  });

  it('allows adding a custom status column on BOTH boards', () => {
    expect(canAddCustomColumn('discussions', 'status')).toBe(true);
    expect(canAddCustomColumn('tasks', 'status')).toBe(true);
  });

  it('leaves the deliberately-excluded groups excluded', () => {
    // checkbox: owner chose to keep it out for now. formula/mirror are computed —
    // monday has no write path for them, so mapping one as editable is a trap.
    expect(canAddCustomColumn('tasks', 'checkbox')).toBe(false);
    expect(canAddCustomColumn('tasks', 'formula')).toBe(false);
  });

  it('still refuses boards outside the custom-column set', () => {
    expect(canAddCustomColumn('topics', 'status')).toBe(false);
  });
});

describe('round372 — a custom status column filters like a value set', () => {
  it('maps status to the "values" control, same as dropdown', () => {
    const dims = customFilterDims([
      { alias: 'custom1ID', type: 'status', title: 'שלב' },
      { alias: 'custom2ID', type: 'dropdown', title: 'תגיות' },
    ]);
    expect(dims).toEqual([
      { key: 'custom1ID', control: 'values', title: 'שלב' },
      { key: 'custom2ID', control: 'values', title: 'תגיות' },
    ]);
  });

  it('also accepts monday\'s legacy "color" type name for a status column', () => {
    // COLUMN_TYPE_GROUPS groups 'status' and 'color' together, so a board whose
    // column reports the older name must not silently lose its filter.
    const dims = customFilterDims([{ alias: 'custom3ID', type: 'color', title: 'שלב' }]);
    expect(dims).toEqual([{ key: 'custom3ID', control: 'values', title: 'שלב' }]);
  });

  it('compares a status value by its stable LABEL ID, including id 0', () => {
    // parseValue returns the label index (a number). id 0 is a real label, so it
    // must survive — a truthiness test here would drop it.
    expect(customComparableValues(0)).toEqual(['0']);
    expect(customComparableValues(5)).toEqual(['5']);
    expect(customComparableValues(null)).toEqual([]);
  });

  it('gets the same pristine value-set state as the other value dims', () => {
    const p = pristineFilterCol('values');
    expect(p.op).toBe('is');
    expect(p.values instanceof Set).toBe(true);
    expect(p.values.size).toBe(0);
  });
});
