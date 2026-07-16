import { useCallback, useState } from 'react';
import { emptyFilter, deserializeFilter } from '../components/MyTasksView/controls/controls.js';

/*
 * round137 (audit stage 4) — the ONE filter-panel state machine, extracted from
 * the five byte-identical inline copies (MyTasksView, MyDecisionsView, TasksTab,
 * PreviousTasksTab, DecisionsTab). Only two things ever varied between the
 * copies, and both are parameters:
 *
 *   columns     — the view's filter-column list ({ key, ... } module constant);
 *                 drives addFilterRow's "first not-yet-shown column" pick and
 *                 savedView row validation.
 *   defaultRows — the "Where" rows a fresh/cleared panel shows
 *                 ([] for My Tasks / My Decisions, ['status'] for the tabs).
 *
 * savedView (optional) seeds the initial state exactly like the inline copies
 * did: a saved filter is deserialized (Sets/Date restored), saved rows win over
 * defaultRows and are validated against `columns`.
 *
 * The filter SHAPE ({ status|priority|person: { op, values:Set }, deadline:
 * { op, range, date } }) and the matching engine (filterTasks / filterCount /
 * serializeFilter) stay in MyTasksView/controls/controls.js — this hook owns
 * only the state + mutators. All mutators are immutable updates so the views'
 * pipeline memos re-run; all are useCallback-stable (columns/defaultRows are
 * per-view module constants, so their deps never actually change).
 */
export function useFilterBuilder({ columns, defaultRows = [], savedView = null }) {
  const [filter, setFilter] = useState(() => (
    savedView?.filter ? deserializeFilter(savedView.filter) : emptyFilter()
  ));
  const [filterRows, setFilterRows] = useState(() => (
    Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => columns.some((c) => c.key === k))
      : [...defaultRows]
  ));

  // A column's pristine state — deadline has the date shape, the rest a Set.
  const resetCol = (col) => (col === 'deadline'
    ? { op: 'within', range: null, date: null }
    : { op: 'is', values: new Set() });

  const setFilterOp = useCallback((col, op) => setFilter((f) => ({ ...f, [col]: { ...f[col], op } })), []);
  const toggleFilterVal = useCallback((col, id) => setFilter((f) => {
    const next = new Set(f[col].values);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...f, [col]: { ...f[col], values: next } };
  }), []);
  const setDeadlineRange = useCallback((range) => setFilter((f) => ({ ...f, deadline: { op: 'within', range, date: null } })), []);
  const setDeadlineDate = useCallback((date) => setFilter((f) => ({ ...f, deadline: { ...f.deadline, date } })), []);
  const addFilterRow = useCallback(() => setFilterRows((rows) => {
    const next = columns.map((c) => c.key).find((k) => !rows.includes(k));
    return next ? [...rows, next] : rows;
  }), [columns]);
  const removeFilterRow = useCallback((col) => {
    setFilterRows((rows) => rows.filter((k) => k !== col));
    setFilter((f) => ({ ...f, [col]: resetCol(col) }));
  }, []);
  const retargetFilterRow = useCallback((fromCol, toCol) => {
    if (fromCol === toCol) return;
    setFilterRows((rows) => rows.map((k) => (k === fromCol ? toCol : k)));
    setFilter((f) => ({ ...f, [fromCol]: resetCol(fromCol), [toCol]: resetCol(toCol) }));
  }, []);
  const clearFilter = useCallback(() => {
    setFilter(emptyFilter());
    setFilterRows([...defaultRows]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per-view module constant; keyed by content
  }, [defaultRows.join('|')]);

  return {
    filter, setFilter, filterRows, setFilterRows,
    setFilterOp, toggleFilterVal, setDeadlineRange, setDeadlineDate,
    addFilterRow, removeFilterRow, retargetFilterRow, clearFilter,
  };
}
