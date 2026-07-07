import { describe, it, expect } from 'vitest';
import { applyColumnOrder, moveColumn } from '../columnOrder.js';

describe('applyColumnOrder', () => {
  const VISIBLE = ['name', 'deadline', 'priority', 'status', 'discussion'];

  it('returns the default order when nothing is stored', () => {
    expect(applyColumnOrder(VISIBLE, [])).toEqual(VISIBLE);
    expect(applyColumnOrder(VISIBLE, undefined)).toEqual(VISIBLE);
  });

  it('applies a stored order, keeping name pinned first', () => {
    const stored = ['status', 'priority', 'discussion', 'deadline'];
    expect(applyColumnOrder(VISIBLE, stored)).toEqual(['name', 'status', 'priority', 'discussion', 'deadline']);
  });

  it('never lets name be moved out of first even if stored says so', () => {
    const stored = ['status', 'name', 'deadline', 'priority', 'discussion'];
    expect(applyColumnOrder(VISIBLE, stored)[0]).toBe('name');
  });

  it('appends a newly-visible column missing from storage (default order)', () => {
    const stored = ['status', 'deadline'];
    // priority + discussion were not stored -> appended in their natural order
    expect(applyColumnOrder(VISIBLE, stored)).toEqual(['name', 'status', 'deadline', 'priority', 'discussion']);
  });

  it('drops stored keys that are no longer visible', () => {
    const stored = ['notes', 'status', 'priority', 'deadline', 'discussion'];
    // 'notes' is not visible -> dropped
    expect(applyColumnOrder(VISIBLE, stored)).toEqual(['name', 'status', 'priority', 'deadline', 'discussion']);
  });

  it('supports multiple pinned keys', () => {
    const visible = ['sel', 'name', 'status', 'priority'];
    const out = applyColumnOrder(visible, ['priority', 'status'], ['sel', 'name']);
    expect(out).toEqual(['sel', 'name', 'priority', 'status']);
  });
});

describe('moveColumn', () => {
  const ORDER = ['name', 'deadline', 'priority', 'status'];

  it('moves a column to the target position', () => {
    expect(moveColumn(ORDER, 'priority', 'deadline')).toEqual(['name', 'priority', 'deadline', 'status']);
    expect(moveColumn(ORDER, 'deadline', 'status')).toEqual(['name', 'priority', 'status', 'deadline']);
  });

  it('is a no-op when keys are equal or missing', () => {
    expect(moveColumn(ORDER, 'status', 'status')).toEqual(ORDER);
    expect(moveColumn(ORDER, 'nope', 'status')).toEqual(ORDER);
    expect(moveColumn(ORDER, 'status', 'nope')).toEqual(ORDER);
  });
});
