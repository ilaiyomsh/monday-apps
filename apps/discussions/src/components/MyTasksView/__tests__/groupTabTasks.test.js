// round142 (audit stage 4) — groupTabTasks: the ONE grouping engine for the
// discussion task tabs (TasksTab + PreviousTasksTab), extracted from their
// near-identical groupedRaw blocks. These tests pin the tabs' exact semantics.
import { describe, it, expect } from 'vitest';
import {
  groupTabTasks, buildPersonGroup, NO_ASSIGNEE, TAB_NO_DISCUSSION, NO_STATUS, ALL_TASKS,
} from '../grouping.js';

const labelById = { 1: 'בעבודה', 2: 'בוצע' };
const colorById = { 1: '#fdab3d', 2: '#00c875' };
const orderById = { 1: 0, 2: 1 };

const t = (over) => ({ id: 'x', name: 'משימה', responsibilityID: [], ...over });

describe('buildPersonGroup', () => {
  it('keys by the SORTED person ids with the people: prefix and carries an assignee seed', () => {
    const g = buildPersonGroup(t({ responsibilityID: [{ id: 9, name: 'ב' }, { id: 3, name: 'א' }] }));
    expect(g.key).toBe('people:3|9');
    expect(g.label).toBe('א, ב');
    expect(g.assignee).toEqual([
      { id: '3', kind: 'person', name: 'א' },
      { id: '9', kind: 'person', name: 'ב' },
    ]);
  });
  it('no assignees → the unassigned bucket', () => {
    expect(buildPersonGroup(t())).toEqual({ key: NO_ASSIGNEE, label: 'לא הוקצה', assignee: [] });
  });
});

describe('groupTabTasks', () => {
  it("'status' buckets by valid statusID with label/color/status fields; no-status bucket stays FIRST", () => {
    const tasks = [
      t({ id: 'a', statusID: 2 }),
      t({ id: 'b', statusID: 1 }),
      t({ id: 'c', statusID: null }),
      t({ id: 'd', statusID: 7 }), // unknown label id → no-status bucket
    ];
    const groups = groupTabTasks(tasks, { by: 'status', order: 'labelAsc', labelById, colorById, orderById });
    expect(groups.map((g) => g.key)).toEqual([NO_STATUS, '1', '2']);
    const none = groups[0];
    expect(none.label).toBe('ללא סטאטוס');
    expect(none.items.map((x) => x.id)).toEqual(['c', 'd']);
    expect(groups[1]).toMatchObject({ label: 'בעבודה', color: '#fdab3d', status: 1 });
    expect(groups[2].items.map((x) => x.id)).toEqual(['a']);
  });

  it("'person' buckets by the people: key, carries the assignee seed, unassigned first", () => {
    const p1 = [{ id: 5, name: 'דנה' }];
    const tasks = [t({ id: 'a', responsibilityID: p1 }), t({ id: 'b' }), t({ id: 'c', responsibilityID: p1 })];
    const groups = groupTabTasks(tasks, { by: 'person', order: 'azAsc' });
    expect(groups.map((g) => g.key)).toEqual([NO_ASSIGNEE, 'people:5']);
    expect(groups[1].assignee).toEqual([{ id: '5', kind: 'person', name: 'דנה' }]);
    expect(groups[1].items.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it("'discussion' buckets by the sorted linked-discussion ids; unlinked bucket first with its Hebrew label", () => {
    const linked = { linkedItems: [{ id: 22, name: 'דיון ב' }, { id: 11, name: 'דיון א' }] };
    const tasks = [t({ id: 'a', discussionLinkID: linked }), t({ id: 'b' })];
    const groups = groupTabTasks(tasks, { by: 'discussion', order: 'azAsc' });
    expect(groups.map((g) => g.key)).toEqual([TAB_NO_DISCUSSION, '11|22']);
    expect(groups[0].label).toBe('ללא דיון מקור');
    expect(groups[1].label).toBe('דיון ב, דיון א');
  });

  it("default ('none') returns the single unlabeled bucket, uncolored", () => {
    const tasks = [t({ id: 'a' }), t({ id: 'b' })];
    const groups = groupTabTasks(tasks, { by: 'none' });
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(ALL_TASKS);
    expect(groups[0].label).toBe('');
    expect(groups[0].items).toHaveLength(2);
  });

  it('every LABELED group leaves with a color (ensureGroupColors pass)', () => {
    const groups = groupTabTasks([t({ id: 'a' })], { by: 'person', order: 'azAsc' });
    expect(groups[0].color).toBeTruthy(); // the unassigned bucket gets a hashed palette color
  });
});
