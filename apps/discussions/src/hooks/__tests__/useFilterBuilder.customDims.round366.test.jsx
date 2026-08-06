import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterBuilder, customDimsOfColumns } from '../useFilterBuilder.js';

/*
 * round366 — the shared filter state machine handles CUSTOM (non-fixed)
 * columns: typed pristine reset, self-healing mutators for keys missing from
 * an older saved filter, and the new text/date-per-column mutators.
 */

const COLUMNS = [
  { key: 'status', type: 'status', alias: 'statusID', ops: ['is', 'isnot'] },
  { key: 'deadline', type: 'date', alias: 'deadlineID', ops: ['within', 'before', 'after'] },
  { key: 'custom1ID', type: 'status', alias: 'custom1ID', ops: ['is', 'isnot'] },
  { key: 'custom3ID', type: 'date', alias: 'custom3ID', ops: ['within', 'before', 'after'] },
  { key: 'custom4ID', type: 'text', alias: 'custom4ID', ops: ['contains'] },
];

describe('round366 — useFilterBuilder with custom columns', () => {
  it('customDimsOfColumns derives only the non-fixed keys, typed', () => {
    expect(customDimsOfColumns(COLUMNS)).toEqual([
      { key: 'custom1ID', control: 'values' },
      { key: 'custom3ID', control: 'date' },
      { key: 'custom4ID', control: 'text' },
    ]);
  });

  it('seeds pristine typed state for custom keys and mutates them', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: ['status'] }));
    expect(result.current.filter.custom4ID).toEqual({ op: 'contains', text: '' });
    act(() => result.current.toggleFilterVal('custom1ID', 'כספים'));
    expect([...result.current.filter.custom1ID.values]).toEqual(['כספים']);
    act(() => result.current.setFilterText('custom4ID', 'דחוף'));
    expect(result.current.filter.custom4ID.text).toBe('דחוף');
    act(() => result.current.setDateColRange('custom3ID', 'thisWeek'));
    expect(result.current.filter.custom3ID).toEqual({ op: 'within', range: 'thisWeek', date: null });
    act(() => result.current.setDateColDate('custom3ID', new Date(2026, 7, 6)));
    expect(result.current.filter.custom3ID.date instanceof Date).toBe(true);
  });

  it('a saved filter missing the custom keys self-heals on first mutation (no crash)', () => {
    const savedView = { filter: { status: { op: 'is', values: ['1'] } }, filterRows: ['status', 'custom1ID'] };
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: [], savedView }));
    expect(result.current.filterRows).toEqual(['status', 'custom1ID']);
    act(() => result.current.toggleFilterVal('custom1ID', 'x'));
    expect([...result.current.filter.custom1ID.values]).toEqual(['x']);
  });

  it('a RAW setFilter without the custom keys (a caller reset) still mutates safely — the fallback is live', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: [] }));
    // A view-level reset that hands the hook a filter object with NO custom keys
    // (the pre-round366 emptyFilter shape) — the mutators must self-heal.
    act(() => result.current.setFilter({
      status: { op: 'is', values: new Set() },
      priority: { op: 'is', values: new Set() },
      person: { op: 'is', values: new Set() },
      deadline: { op: 'within', range: null, date: null },
    }));
    act(() => result.current.toggleFilterVal('custom1ID', 'x'));
    expect([...result.current.filter.custom1ID.values]).toEqual(['x']);
    act(() => result.current.setFilter({ status: { op: 'is', values: new Set() } }));
    act(() => result.current.setFilterText('custom4ID', 'דחוף'));
    expect(result.current.filter.custom4ID).toEqual({ op: 'contains', text: 'דחוף' });
  });

  it('removeFilterRow resets a custom key to its TYPED pristine state', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: ['custom4ID'] }));
    act(() => result.current.setFilterText('custom4ID', 'דחוף'));
    act(() => result.current.removeFilterRow('custom4ID'));
    expect(result.current.filter.custom4ID).toEqual({ op: 'contains', text: '' });
    // a date custom key resets to the date shape, not a Set
    act(() => result.current.setDateColRange('custom3ID', 'today'));
    act(() => result.current.removeFilterRow('custom3ID'));
    expect(result.current.filter.custom3ID).toEqual({ op: 'within', range: null, date: null });
  });
});
