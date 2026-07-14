import { describe, it, expect } from 'vitest';
import { isValidStatus } from '@generated/constants/statusConfig';
import {
  groupMyTasks,
  getTaskDiscussion,
  getTaskGroup,
  NO_STATUS,
  NO_PRIORITY,
  NO_DISCUSSION,
  NO_GROUP,
  DISCUSSION_PALETTE,
} from '../grouping.js';

// Helper to build a task in the BoardSDK.mapItem shape.
const task = (over = {}) => ({
  id: String(over.id ?? Math.random()),
  name: over.name ?? 'משימה',
  created_at: over.created_at ?? '2026-01-01',
  responsibilityID: over.responsibilityID ?? [],
  deadlineID: over.deadlineID ?? null,
  statusID: over.statusID ?? null,
  discussionLinkID: over.discussionLinkID, // board_relation { ids, linkedItems, text }
  taskNotesID: over.taskNotesID ?? '',
  priorityID: over.priorityID ?? null,
  group: over.group, // monday group { id, title }
  ...over,
});

// Mirrors parseValue('board_relation') output: key `linkedItems` (NOT `items`)
// and `text: null` (board_relation text is null in the current monday API).
const rel = (id, name) => ({ linkedItems: id != null ? [{ id: String(id), name }] : [], ids: id != null ? [String(id)] : [], text: null });

const statusOpts = {
  labelById: { 1: 'בעבודה', 2: 'הושלם' },
  colorById: { 1: '#fdab3d', 2: '#00c875' },
  orderById: { 1: 0, 2: 1 },
  isValidStatus,
};

const priorityOpts = {
  priorityLabelById: { 1: 'גבוהה', 2: 'בינונית', 3: 'נמוכה' },
  priorityColorById: { 1: '#e2445c', 2: '#fdab3d', 3: '#579bfc' },
  priorityOrderById: { 1: 0, 2: 1, 3: 2 }, // label display order = priority order
  isValidStatus,
};

describe('getTaskDiscussion', () => {
  it('reads the first linked item id+name', () => {
    expect(getTaskDiscussion(task({ discussionLinkID: rel('D1', 'דיון א') }))).toEqual({ id: 'D1', name: 'דיון א' });
  });
  it('falls back to ids + text when items missing', () => {
    expect(getTaskDiscussion(task({ discussionLinkID: { ids: ['D9'], items: [], text: 'דיון ט' } }))).toEqual({ id: 'D9', name: 'דיון ט' });
  });
  it('returns null with no relation', () => {
    expect(getTaskDiscussion(task({ discussionLinkID: null }))).toBeNull();
    expect(getTaskDiscussion(task({ discussionLinkID: rel(null) }))).toBeNull();
  });
});

describe('getTaskGroup', () => {
  it('reads id + title', () => {
    expect(getTaskGroup(task({ group: { id: 'g1', title: 'קבוצה' } }))).toEqual({ id: 'g1', title: 'קבוצה' });
  });
  it('returns null when absent', () => {
    expect(getTaskGroup(task({ group: undefined }))).toBeNull();
  });
});

describe('groupMyTasks — discussion', () => {
  it('buckets by linked discussion alphabetically (A→Z), no-discussion FIRST', () => {
    const tasks = [
      task({ id: '1', discussionLinkID: rel('D2', 'בית') }),
      task({ id: '2', discussionLinkID: null }),
      task({ id: '3', discussionLinkID: rel('D1', 'אבא') }),
      task({ id: '4', discussionLinkID: rel('D2', 'בית') }),
    ];
    const groups = groupMyTasks(tasks, 'discussion', { noDiscussionLabel: 'ללא דיון', order: 'azAsc' });
    expect(groups.map((g) => g.key)).toEqual([NO_DISCUSSION, 'disc:D1', 'disc:D2']);
    expect(groups[0].label).toBe('ללא דיון');
    expect(groups[2].items.map((t) => t.id)).toEqual(['1', '4']);
  });

  it('order azDesc reverses the alphabetical order (no-discussion LAST)', () => {
    const tasks = [
      task({ id: '1', discussionLinkID: rel('D1', 'אבא') }),
      task({ id: '2', discussionLinkID: rel('D2', 'בית') }),
      task({ id: '3', discussionLinkID: null }),
    ];
    const groups = groupMyTasks(tasks, 'discussion', { noDiscussionLabel: 'ללא דיון', order: 'azDesc' });
    expect(groups.map((g) => g.key)).toEqual(['disc:D2', 'disc:D1', NO_DISCUSSION]);
  });

  it('order dateAsc/dateDesc sorts buckets by injected discussion date, undated LAST', () => {
    const tasks = [
      task({ id: '1', discussionLinkID: rel('D1', 'אבא') }),
      task({ id: '2', discussionLinkID: rel('D2', 'בית') }),
      task({ id: '3', discussionLinkID: rel('D3', 'גן') }), // no date in map -> undated
    ];
    const discussionDateById = { D1: new Date(2026, 0, 10), D2: new Date(2026, 0, 5) };
    const asc = groupMyTasks(tasks, 'discussion', { order: 'dateAsc', discussionDateById });
    expect(asc.map((g) => g.key)).toEqual(['disc:D2', 'disc:D1', 'disc:D3']);
    const desc = groupMyTasks(tasks, 'discussion', { order: 'dateDesc', discussionDateById });
    expect(desc.map((g) => g.key)).toEqual(['disc:D1', 'disc:D2', 'disc:D3']);
  });
});

describe('groupMyTasks — discussion color (deterministic palette accent)', () => {
  const HEX = /^#[0-9a-f]{6}$/i;

  it('assigns a non-null hex color to each real discussion group', () => {
    const groups = groupMyTasks([
      task({ id: '1', discussionLinkID: rel('D1', 'אבא') }),
      task({ id: '2', discussionLinkID: rel('D2', 'בית') }),
    ], 'discussion', { order: 'azAsc' });
    const valued = groups.filter((g) => g.key !== NO_DISCUSSION);
    expect(valued).toHaveLength(2);
    valued.forEach((g) => expect(g.color).toMatch(HEX));
  });

  it('the "No discussion" bucket keeps color null', () => {
    const groups = groupMyTasks([
      task({ id: '1', discussionLinkID: rel('D1', 'אבא') }),
      task({ id: '2', discussionLinkID: null }),
    ], 'discussion', { noDiscussionLabel: 'ללא דיון', order: 'azAsc' });
    const noDisc = groups.find((g) => g.key === NO_DISCUSSION);
    expect(noDisc).toBeDefined();
    expect(noDisc.color).toBeNull();
  });

  it('is DETERMINISTIC — grouping the same tasks twice yields identical colors per key', () => {
    const tasks = [
      task({ id: '1', discussionLinkID: rel('D1', 'אבא') }),
      task({ id: '2', discussionLinkID: rel('D2', 'בית') }),
    ];
    const a = groupMyTasks(tasks, 'discussion', { order: 'azAsc' });
    const b = groupMyTasks(tasks, 'discussion', { order: 'azAsc' });
    const colorOf = (groups, key) => groups.find((g) => g.key === key).color;
    expect(colorOf(a, 'disc:D1')).toBe(colorOf(b, 'disc:D1'));
    expect(colorOf(a, 'disc:D2')).toBe(colorOf(b, 'disc:D2'));
  });

  it('the same discussion id maps to the same color across different task arrays', () => {
    const g1 = groupMyTasks([task({ id: '1', discussionLinkID: rel('D1', 'אבא') })], 'discussion');
    const g2 = groupMyTasks([
      task({ id: '9', discussionLinkID: rel('D1', 'שם אחר לגמרי') }),
      task({ id: '8', discussionLinkID: rel('D2', 'בית') }),
    ], 'discussion');
    const c1 = g1.find((g) => g.key === 'disc:D1').color;
    const c2 = g2.find((g) => g.key === 'disc:D1').color;
    expect(c1).toBe(c2);
  });

  it('every assigned color is a member of the documented monday palette', () => {
    const set = new Set(DISCUSSION_PALETTE);
    const groups = groupMyTasks([
      task({ id: '1', discussionLinkID: rel('D1', 'א') }),
      task({ id: '2', discussionLinkID: rel('D2', 'ב') }),
      task({ id: '3', discussionLinkID: rel('D3', 'ג') }),
    ], 'discussion');
    groups
      .filter((g) => g.key !== NO_DISCUSSION)
      .forEach((g) => expect(set.has(g.color)).toBe(true));
  });

  it('different discussion ids that hash to different buckets get different colors', () => {
    // D1/D2/D3 hash to distinct palette buckets (17/18/19).
    const groups = groupMyTasks([
      task({ id: '1', discussionLinkID: rel('D1', 'א') }),
      task({ id: '2', discussionLinkID: rel('D2', 'ב') }),
      task({ id: '3', discussionLinkID: rel('D3', 'ג') }),
    ], 'discussion');
    const colors = groups
      .filter((g) => g.key !== NO_DISCUSSION)
      .map((g) => g.color);
    expect(new Set(colors).size).toBe(3);
  });
});

describe('groupMyTasks — status', () => {
  it('buckets by display order (labelAsc), no-status LAST, with labels/colors', () => {
    const tasks = [
      task({ id: '1', statusID: 2 }),
      task({ id: '2', statusID: null }),
      task({ id: '3', statusID: 1 }),
      task({ id: '4', statusID: 99 }), // unknown id -> treated as no-status
    ];
    const groups = groupMyTasks(tasks, 'status', { ...statusOpts, order: 'labelAsc', noStatusLabel: 'ללא סטאטוס' });
    expect(groups.map((g) => g.key)).toEqual(['1', '2', NO_STATUS]);
    expect(groups[0]).toMatchObject({ label: 'בעבודה', color: '#fdab3d', status: 1 });
    expect(groups[1]).toMatchObject({ label: 'הושלם', color: '#00c875', status: 2 });
    expect(groups[2].items.map((t) => t.id).sort()).toEqual(['2', '4']);
  });

  it('order labelDesc reverses the rank order (no-status still LAST)', () => {
    const tasks = [task({ id: '1', statusID: 1 }), task({ id: '2', statusID: 2 }), task({ id: '3', statusID: null })];
    const groups = groupMyTasks(tasks, 'status', { ...statusOpts, order: 'labelDesc', noStatusLabel: 'ללא סטאטוס' });
    expect(groups.map((g) => g.key)).toEqual(['2', '1', NO_STATUS]);
  });

  it('order azAsc/azDesc sorts buckets alphabetically by label text', () => {
    // labels: 1='בעבודה', 2='הושלם' -> A→Z: בעבודה(ב) before הושלם(ה)
    const tasks = [task({ id: '1', statusID: 2 }), task({ id: '2', statusID: 1 })];
    const az = groupMyTasks(tasks, 'status', { ...statusOpts, order: 'azAsc' });
    expect(az.map((g) => g.key)).toEqual(['1', '2']);
    const za = groupMyTasks(tasks, 'status', { ...statusOpts, order: 'azDesc' });
    expect(za.map((g) => g.key)).toEqual(['2', '1']);
  });

  it('treats status id 0 as a valid (not no-status) bucket', () => {
    const opts = { ...statusOpts, labelById: { 0: 'תקוע', ...statusOpts.labelById }, orderById: { 0: 0, 1: 1, 2: 2 } };
    const groups = groupMyTasks([task({ id: '1', statusID: 0 })], 'status', opts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '0', status: 0, label: 'תקוע' });
  });
});

describe('groupMyTasks — priority', () => {
  it('buckets by priority label order (highest first), no-priority LAST', () => {
    const tasks = [
      task({ id: '1', priorityID: 3 }), // נמוכה
      task({ id: '2', priorityID: null }), // no priority
      task({ id: '3', priorityID: 1 }), // גבוהה
      task({ id: '4', priorityID: 2 }), // בינונית
    ];
    const groups = groupMyTasks(tasks, 'priority', { ...priorityOpts, noPriorityLabel: 'ללא עדיפות' });
    // label display order defines priorityID: 1 (rank0) < 2 (rank1) < 3 (rank2),
    // and the no-priority bucket sorts last.
    expect(groups.map((g) => g.key)).toEqual(['1', '2', '3', NO_PRIORITY]);
    expect(groups[0]).toMatchObject({ label: 'גבוהה', color: '#e2445c', status: 1 });
    expect(groups[groups.length - 1].label).toBe('ללא עדיפות');
    expect(groups[groups.length - 1].items.map((t) => t.id)).toEqual(['2']);
  });

  it('does not collide with the statusID status maps', () => {
    // Only priority maps are provided; statusID status maps absent. Grouping by
    // priority must still resolve labels from the priority* maps.
    const groups = groupMyTasks([task({ id: '1', priorityID: 2 })], 'priority', priorityOpts);
    expect(groups[0]).toMatchObject({ key: '2', label: 'בינונית' });
  });
});

describe('groupMyTasks — board group', () => {
  it('buckets by monday group, no-group first, rest alphabetical', () => {
    const tasks = [
      task({ id: '1', group: { id: 'g2', title: 'ב' } }),
      task({ id: '2', group: undefined }),
      task({ id: '3', group: { id: 'g1', title: 'א' } }),
    ];
    const groups = groupMyTasks(tasks, 'group', { noGroupLabel: 'ללא קבוצה' });
    expect(groups.map((g) => g.key)).toEqual([NO_GROUP, 'group:g1', 'group:g2']);
    expect(groups[0].label).toBe('ללא קבוצה');
  });
});

describe('groupMyTasks — none', () => {
  it('puts every task into a single group titled by allTasksLabel', () => {
    const tasks = [task({ id: '1', statusID: 1 }), task({ id: '2', statusID: null }), task({ id: '3' })];
    const groups = groupMyTasks(tasks, 'none', { allTasksLabel: 'משימות' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '__all__', label: 'משימות', color: null });
    expect(groups[0].items.map((t) => t.id)).toEqual(['1', '2', '3']);
  });
});

describe('groupMyTasks — defaults', () => {
  it('returns empty array for empty input', () => {
    expect(groupMyTasks([], 'discussion')).toEqual([]);
    expect(groupMyTasks(undefined, 'status', statusOpts)).toEqual([]);
  });
  it('unknown mode falls back to status grouping', () => {
    const groups = groupMyTasks([task({ id: '1', statusID: 1 })], 'bogus', statusOpts);
    expect(groups[0].key).toBe('1');
  });
});
