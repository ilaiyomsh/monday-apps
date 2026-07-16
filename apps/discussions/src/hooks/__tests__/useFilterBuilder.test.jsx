// round137 (audit stage 4) — useFilterBuilder: the shared filter-panel state
// machine extracted from the five byte-identical inline copies (MyTasksView,
// MyDecisionsView, TasksTab, PreviousTasksTab, DecisionsTab). These tests pin
// the exact semantics of the inline copies so the extraction is provably
// behavior-preserving.
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterBuilder } from '../useFilterBuilder.js';
import { serializeFilter } from '../../components/MyTasksView/controls/controls.js';

const COLUMNS = [
  { key: 'status', type: 'status' },
  { key: 'priority', type: 'status' },
  { key: 'deadline', type: 'date' },
];

describe('useFilterBuilder', () => {
  it('starts empty with the view defaultRows, and toggleFilterVal adds/removes values immutably', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: ['status'] }));
    expect(result.current.filterRows).toEqual(['status']);
    expect(result.current.filter.status.values.size).toBe(0);

    const before = result.current.filter;
    act(() => result.current.toggleFilterVal('status', 5));
    expect(result.current.filter.status.values.has(5)).toBe(true);
    expect(result.current.filter).not.toBe(before); // immutable update — pipeline memos re-run
    act(() => result.current.toggleFilterVal('status', 5));
    expect(result.current.filter.status.values.size).toBe(0);
  });

  it('addFilterRow appends the FIRST column not already shown; exhausted columns are a no-op', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: ['status'] }));
    act(() => result.current.addFilterRow());
    expect(result.current.filterRows).toEqual(['status', 'priority']);
    act(() => result.current.addFilterRow());
    expect(result.current.filterRows).toEqual(['status', 'priority', 'deadline']);
    act(() => result.current.addFilterRow()); // all columns shown — unchanged
    expect(result.current.filterRows).toEqual(['status', 'priority', 'deadline']);
  });

  it('removeFilterRow drops the row AND resets that column (deadline gets its date shape)', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: [] }));
    act(() => {
      result.current.setFilterRows(['status', 'deadline']);
    });
    act(() => {
      result.current.toggleFilterVal('status', 7);
      result.current.setDeadlineRange('thisWeek');
    });
    act(() => result.current.removeFilterRow('status'));
    expect(result.current.filterRows).toEqual(['deadline']);
    expect(result.current.filter.status.values.size).toBe(0);
    expect(result.current.filter.status.op).toBe('is');
    act(() => result.current.removeFilterRow('deadline'));
    expect(result.current.filter.deadline).toEqual({ op: 'within', range: null, date: null });
  });

  it('retargetFilterRow swaps the row in place and resets BOTH columns; same-col is a no-op', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: ['status'] }));
    act(() => result.current.toggleFilterVal('status', 3));
    const before = result.current.filter;
    act(() => result.current.retargetFilterRow('status', 'status'));
    expect(result.current.filter).toBe(before); // no-op keeps identity
    act(() => result.current.retargetFilterRow('status', 'priority'));
    expect(result.current.filterRows).toEqual(['priority']);
    expect(result.current.filter.status.values.size).toBe(0);
    expect(result.current.filter.priority.values.size).toBe(0);
  });

  it('clearFilter restores the empty filter and the view defaultRows', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: ['status'] }));
    act(() => {
      result.current.setFilterRows(['status', 'priority']);
      result.current.toggleFilterVal('priority', 9);
      result.current.setDeadlineDate(new Date('2026-07-16'));
    });
    act(() => result.current.clearFilter());
    expect(result.current.filterRows).toEqual(['status']);
    expect(result.current.filter.priority.values.size).toBe(0);
    expect(result.current.filter.deadline.date).toBe(null);
  });

  it('seeds from a savedView: filter deserialized, rows validated against columns', () => {
    const saved = {
      filter: serializeFilter({
        status: { op: 'isnot', values: new Set([1]) },
        priority: { op: 'is', values: new Set() },
        person: { op: 'is', values: new Set() },
        deadline: { op: 'within', range: null, date: null },
      }),
      filterRows: ['status', 'person', 'nonsense'], // person is NOT in this view's columns
    };
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: [], savedView: saved }));
    expect(result.current.filterRows).toEqual(['status']);
    expect(result.current.filter.status.op).toBe('isnot');
    // deserializeFilter stringifies ids (JSON round-trip normalization).
    expect([...result.current.filter.status.values]).toEqual(['1']);
  });

  it('setFilterOp / setDeadlineRange follow the inline semantics (range resets date)', () => {
    const { result } = renderHook(() => useFilterBuilder({ columns: COLUMNS, defaultRows: [] }));
    act(() => result.current.setFilterOp('status', 'is_not'));
    expect(result.current.filter.status.op).toBe('is_not');
    act(() => result.current.setDeadlineDate(new Date('2026-07-16')));
    act(() => result.current.setDeadlineRange('nextWeek'));
    expect(result.current.filter.deadline).toEqual({ op: 'within', range: 'nextWeek', date: null });
  });
});
