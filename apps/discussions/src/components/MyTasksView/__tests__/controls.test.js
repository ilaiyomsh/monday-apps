import { describe, it, expect } from 'vitest';
import { sortTasks, filterTasks, filterCount, emptyFilter } from '../controls/controls.js';

const maps = {
  orderById: { s1: 0, s2: 1 },           // status display rank
  labelById: { s1: 'בעבודה', s2: 'הושלם' },
  priorityOrderById: { p1: 0, p2: 1, p3: 2 }, // priority display rank
  priorityLabelById: { p1: 'דחוף', p2: 'גבוהה', p3: 'נמוכה' },
};
const t = (over) => ({ id: String(over.id), name: over.name, deadlineID: over.deadlineID ?? null, statusID: over.statusID ?? null, priorityID: over.priorityID ?? null });
const ids = (list) => list.map((x) => x.id);

describe('sortTasks', () => {
  it('returns the original list when inactive', () => {
    const list = [t({ id: '1', name: 'ב' }), t({ id: '2', name: 'א' })];
    expect(sortTasks(list, { col: 'name', dir: 'nameAsc', active: false }, maps)).toBe(list);
  });

  it('sorts by task name A→Z and Z→A (Hebrew collation)', () => {
    const list = [t({ id: '1', name: 'גמל' }), t({ id: '2', name: 'אבא' }), t({ id: '3', name: 'בית' })];
    expect(ids(sortTasks(list, { col: 'name', dir: 'nameAsc', active: true }, maps))).toEqual(['2', '3', '1']);
    expect(ids(sortTasks(list, { col: 'name', dir: 'nameDesc', active: true }, maps))).toEqual(['1', '3', '2']);
  });

  it('sorts by deadline earliest/latest with no-deadline always last', () => {
    const list = [
      t({ id: '1', deadlineID: new Date(2026, 0, 10) }),
      t({ id: '2', deadlineID: null }),
      t({ id: '3', deadlineID: new Date(2026, 0, 5) }),
    ];
    expect(ids(sortTasks(list, { col: 'deadline', dir: 'deadlineAsc', active: true }, maps))).toEqual(['3', '1', '2']);
    expect(ids(sortTasks(list, { col: 'deadline', dir: 'deadlineDesc', active: true }, maps))).toEqual(['1', '3', '2']);
  });

  it('sorts status by label display order (labelAsc/labelDesc), no-value last', () => {
    const list = [t({ id: '1', statusID: 's2' }), t({ id: '2', statusID: null }), t({ id: '3', statusID: 's1' })];
    expect(ids(sortTasks(list, { col: 'status', dir: 'labelAsc', active: true }, maps))).toEqual(['3', '1', '2']);
    expect(ids(sortTasks(list, { col: 'status', dir: 'labelDesc', active: true }, maps))).toEqual(['1', '3', '2']);
  });

  it('sorts status alphabetically by label text (azAsc/azDesc), no-value last', () => {
    // s1='בעבודה'(ב), s2='הושלם'(ה) -> A→Z: s1 then s2
    const list = [t({ id: '1', statusID: 's2' }), t({ id: '2', statusID: 's1' }), t({ id: '3', statusID: null })];
    expect(ids(sortTasks(list, { col: 'status', dir: 'azAsc', active: true }, maps))).toEqual(['2', '1', '3']);
    expect(ids(sortTasks(list, { col: 'status', dir: 'azDesc', active: true }, maps))).toEqual(['1', '2', '3']);
  });

  it('sorts priority by its own maps (labelAsc = highest rank first)', () => {
    const list = [t({ id: '1', priorityID: 'p3' }), t({ id: '2', priorityID: 'p1' }), t({ id: '3', priorityID: 'p2' })];
    expect(ids(sortTasks(list, { col: 'priority', dir: 'labelAsc', active: true }, maps))).toEqual(['2', '3', '1']);
  });
});

describe('filterTasks', () => {
  const now = new Date(2026, 0, 15); // Thu Jan 15 2026 (week = Sun Jan 11 .. Sat Jan 17)
  const tasks = [
    t({ id: 'today', deadlineID: new Date(2026, 0, 15), statusID: 's1', priorityID: 'p1' }),
    t({ id: 'week', deadlineID: new Date(2026, 0, 13), statusID: 's2', priorityID: 'p2' }),
    t({ id: 'month', deadlineID: new Date(2026, 0, 10), statusID: 's1', priorityID: null }),
    t({ id: 'next', deadlineID: new Date(2026, 1, 1), statusID: null, priorityID: 'p3' }),
    t({ id: 'none', deadlineID: null, statusID: 's1', priorityID: 'p1' }),
  ];
  const withStatus = (op, vals) => ({ ...emptyFilter(), status: { op, values: new Set(vals) } });
  const withDeadline = (op, extra) => ({ ...emptyFilter(), deadline: { op, range: null, date: null, ...extra } });

  it('returns the original list when nothing is active', () => {
    expect(filterTasks(tasks, emptyFilter(), { now })).toBe(tasks);
  });

  it('status "is" keeps any-of selected, "is not" excludes them', () => {
    expect(ids(filterTasks(tasks, withStatus('is', ['s1']), { now }))).toEqual(['today', 'month', 'none']);
    expect(ids(filterTasks(tasks, withStatus('isnot', ['s1']), { now }))).toEqual(['week', 'next']);
  });

  it('deadline within: today / this week / this month / overdue', () => {
    expect(ids(filterTasks(tasks, withDeadline('within', { range: 'today' }), { now }))).toEqual(['today']);
    expect(ids(filterTasks(tasks, withDeadline('within', { range: 'thisWeek' }), { now }))).toEqual(['today', 'week']);
    expect(ids(filterTasks(tasks, withDeadline('within', { range: 'thisMonth' }), { now }))).toEqual(['today', 'week', 'month']);
    expect(ids(filterTasks(tasks, withDeadline('within', { range: 'overdue' }), { now }))).toEqual(['week', 'month']);
  });

  it('deadline before/after a specific date', () => {
    const d = new Date(2026, 0, 14);
    expect(ids(filterTasks(tasks, withDeadline('before', { date: d }), { now }))).toEqual(['week', 'month']);
    expect(ids(filterTasks(tasks, withDeadline('after', { date: d }), { now }))).toEqual(['today', 'next']);
  });

  it('ANDs across columns (status AND deadline)', () => {
    const f = { ...emptyFilter(), status: { op: 'is', values: new Set(['s1']) }, deadline: { op: 'within', range: 'thisMonth', date: null } };
    expect(ids(filterTasks(tasks, f, { now }))).toEqual(['today', 'month']);
  });

  it('filterCount sums selected values + an active deadline', () => {
    const f = { ...emptyFilter(), status: { op: 'is', values: new Set(['s1', 's2']) }, deadline: { op: 'within', range: 'today', date: null } };
    expect(filterCount(f)).toBe(3);
    expect(filterCount(emptyFilter())).toBe(0);
  });
});

// Person/people filter column (used by the Previous-tasks tab). Task value is an
// array of { id, name }; "is" = has any selected person, "is not" = has none.
describe('filterTasks — person column', () => {
  const pTasks = [
    { id: 'a', responsibilityID: [{ id: 1, name: 'דנה' }] },
    { id: 'b', responsibilityID: [{ id: 2, name: 'יוסי' }, { id: 1, name: 'דנה' }] },
    { id: 'c', responsibilityID: [{ id: 3, name: 'רון' }] },
    { id: 'd', responsibilityID: [] },           // unassigned
    { id: 'e' },                                  // no people field at all
  ];
  const withPerson = (op, vals) => ({ ...emptyFilter(), person: { op, values: new Set(vals.map(String)) } });

  it('"is" keeps tasks that include ANY selected person', () => {
    expect(ids(filterTasks(pTasks, withPerson('is', [1])))).toEqual(['a', 'b']);
    expect(ids(filterTasks(pTasks, withPerson('is', [1, 3])))).toEqual(['a', 'b', 'c']);
  });

  it('"is not" excludes tasks that include any selected person (keeps unassigned)', () => {
    expect(ids(filterTasks(pTasks, withPerson('isnot', [1])))).toEqual(['c', 'd', 'e']);
  });

  it('an empty person value set is inactive (returns all)', () => {
    expect(filterTasks(pTasks, emptyFilter())).toBe(pTasks);
  });

  it('filterCount counts person values and ANDs with other columns', () => {
    const f = { ...emptyFilter(), person: { op: 'is', values: new Set(['1', '2']) } };
    expect(filterCount(f)).toBe(2);
    // person AND status together
    const tasks2 = [
      { id: 'x', responsibilityID: [{ id: 1, name: 'דנה' }], statusID: 's1' },
      { id: 'y', responsibilityID: [{ id: 1, name: 'דנה' }], statusID: 's2' },
    ];
    const g = { ...emptyFilter(), person: { op: 'is', values: new Set(['1']) }, status: { op: 'is', values: new Set(['s1']) } };
    expect(ids(filterTasks(tasks2, g))).toEqual(['x']);
  });
});
