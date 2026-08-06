import { useCallback, useState } from 'react';
import { emptyFilter, deserializeFilter, pristineFilterCol } from '../components/MyTasksView/controls/controls.js';

/*
 * round366 — custom-column dims (any column key beyond the four fixed ones)
 * as [{ key, control }], derived from the view's column list. The column
 * `type` vocabulary maps to the controls.js CONTROL vocabulary; 'status' and
 * any unknown type behave as a value-set column.
 */
const FIXED_KEYS = new Set(['status', 'priority', 'person', 'deadline']);
const controlOf = (type) => (type === 'person' ? 'person' : type === 'date' ? 'date' : type === 'text' ? 'text' : 'values');
export function customDimsOfColumns(columns) {
  return (columns || [])
    .filter((c) => !FIXED_KEYS.has(c.key))
    .map((c) => ({ key: c.key, control: controlOf(c.type) }));
}

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
  // round366 — the non-fixed (custom) dims seed/restore their own typed keys.
  const customDims = customDimsOfColumns(columns);
  const [filter, setFilter] = useState(() => (
    savedView?.filter ? deserializeFilter(savedView.filter, customDims) : emptyFilter(customDims)
  ));
  const [filterRows, setFilterRows] = useState(() => (
    Array.isArray(savedView?.filterRows)
      ? savedView.filterRows.filter((k) => columns.some((c) => c.key === k))
      : [...defaultRows]
  ));

  // A column's pristine state, by its declared type ('deadline' keeps its
  // hardcoded date shape for the fixed lists that predate typed columns).
  const resetCol = (col) => {
    if (col === 'deadline') return pristineFilterCol('date');
    const def = columns.find((c) => c.key === col);
    return pristineFilterCol(controlOf(def?.type));
  };
  // A custom key may be missing from a filter restored before the column
  // existed — self-heal to pristine instead of crashing the mutator.
  const colState = (f, col) => f[col] || resetCol(col);

  const setFilterOp = useCallback((col, op) => setFilter((f) => ({ ...f, [col]: { ...colState(f, col), op } })), []);
  const toggleFilterVal = useCallback((col, id) => setFilter((f) => {
    const cur = colState(f, col);
    const next = new Set(cur.values);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...f, [col]: { ...cur, values: next } };
  }), []);
  // round366 — free-text contains value for a text custom column.
  const setFilterText = useCallback((col, text) => setFilter((f) => ({ ...f, [col]: { ...colState(f, col), text } })), []);
  const setDeadlineRange = useCallback((range) => setFilter((f) => ({ ...f, deadline: { op: 'within', range, date: null } })), []);
  const setDeadlineDate = useCallback((date) => setFilter((f) => ({ ...f, deadline: { ...f.deadline, date } })), []);
  // round366 — a DATE custom column needs the same range/date mutators as deadline, per column.
  const setDateColRange = useCallback((col, range) => setFilter((f) => ({ ...f, [col]: { op: 'within', range, date: null } })), []);
  const setDateColDate = useCallback((col, date) => setFilter((f) => ({ ...f, [col]: { ...colState(f, col), date } })), []);
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
    setFilter(emptyFilter(customDimsOfColumns(columns)));
    setFilterRows([...defaultRows]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per-view constants; keyed by content
  }, [defaultRows.join('|'), columns]);

  return {
    filter, setFilter, filterRows, setFilterRows,
    setFilterOp, toggleFilterVal, setFilterText, setDeadlineRange, setDeadlineDate,
    setDateColRange, setDateColDate,
    addFilterRow, removeFilterRow, retargetFilterRow, clearFilter,
  };
}
