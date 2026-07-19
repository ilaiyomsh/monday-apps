/**
 * Contract tests for @axis/scale-fixtures (src/index.d.ts).
 * Written TDD-red against the declared contract; implementation is stubbed.
 */
import { describe, it, expect } from 'vitest';
import {
  makeRng,
  genUsers,
  genProjects,
  genDashboardEvents,
  genDayOffRequests,
  genEntitlements,
  genAllocationItems,
  genAggregateGroups,
  paginate,
  round2,
} from '../index.js';

// ---------------------------------------------------------------------------
// Shared fixture pools (inputs only — built locally so pool membership checks
// do not depend on the generators under test).
// ---------------------------------------------------------------------------
const EMPLOYEE_IDS = Array.from({ length: 30 }, (_, i) => `emp-${i + 1}`);
const ABSENCE_TYPES = ['vacation', 'sick', 'reserves', 'unpaid'];
const CATEGORIES = ['internalProject', 'externalProject', 'routine'];
const DAY_MS = 24 * 60 * 60 * 1000;

const eventOpts = (overrides = {}) => ({
  count: 5000,
  users: genUsers(30, 1),
  projects: genProjects(40, 1),
  from: '2026-01-01',
  to: '2026-03-31',
  seed: 42,
  ...overrides,
});

/** Serialize events with dates normalized to epoch ms so Invalid Date / Date identity does not skew JSON comparison. */
const serializeEvents = (events) =>
  JSON.stringify(
    events.map((e) => ({ ...e, date: e.date instanceof Date ? e.date.getTime() : e.date }))
  );

const isStringOrNull = (v) => v === null || typeof v === 'string';

// ---------------------------------------------------------------------------
// makeRng
// ---------------------------------------------------------------------------
describe('makeRng', () => {
  it('returns a function', () => {
    expect(typeof makeRng(1)).toBe('function');
  });

  it('produces values in [0, 1)', () => {
    const rng = makeRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('yields the same first 5 values for the same seed', () => {
    const a = makeRng(77);
    const b = makeRng(77);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('yields a different sequence for a different seed', () => {
    const a = makeRng(77);
    const b = makeRng(78);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });
});

// ---------------------------------------------------------------------------
// genUsers
// ---------------------------------------------------------------------------
describe('genUsers', () => {
  it('returns exactly 30 users for count 30', () => {
    expect(genUsers(30, 1)).toHaveLength(30);
  });

  it('assigns sequential numeric ids 1001..1030', () => {
    const users = genUsers(30, 1);
    expect(users.map((u) => u.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => 1001 + i)
    );
  });

  it('gives every user a non-empty name, unique across the set', () => {
    const users = genUsers(30, 1);
    for (const u of users) {
      expect(typeof u.name).toBe('string');
      expect(u.name.length).toBeGreaterThan(0);
    }
    expect(new Set(users.map((u) => u.name)).size).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// genProjects
// ---------------------------------------------------------------------------
describe('genProjects', () => {
  it('returns exactly 40 projects for count 40', () => {
    expect(genProjects(40, 1)).toHaveLength(40);
  });

  it('assigns sequential string item ids starting at "9000001"', () => {
    const projects = genProjects(40, 1);
    expect(projects.map((p) => p.id)).toEqual(
      Array.from({ length: 40 }, (_, i) => String(9000001 + i))
    );
  });

  it('gives every project a non-empty name', () => {
    for (const p of genProjects(40, 1)) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// genDashboardEvents
// ---------------------------------------------------------------------------
describe('genDashboardEvents', () => {
  it('returns exactly `count` events when includeEdgeCases is off', () => {
    expect(genDashboardEvents(eventOpts())).toHaveLength(5000);
  });

  it('places every event date as a valid Date inside the inclusive from/to window', () => {
    const events = genDashboardEvents(eventOpts());
    const min = new Date('2026-01-01T00:00:00.000Z').getTime();
    const max = new Date('2026-03-31T23:59:59.999Z').getTime();
    for (const e of events) {
      expect(e.date).toBeInstanceOf(Date);
      const t = e.date.getTime();
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBeGreaterThanOrEqual(min);
      expect(t).toBeLessThanOrEqual(max);
    }
  });

  it('reports hours as positive multiples of 0.25 on every event', () => {
    for (const e of genDashboardEvents(eventOpts())) {
      expect(e.hours).toBeGreaterThan(0);
      expect(Number.isInteger(e.hours * 4)).toBe(true);
    }
  });

  it('draws every reporterId from the supplied user pool', () => {
    const opts = eventOpts();
    const userIds = new Set(opts.users.map((u) => u.id));
    for (const e of genDashboardEvents(opts)) {
      expect(userIds.has(e.reporterId)).toBe(true);
    }
  });

  it('uses only the three allowed categories and covers all three across 5000 events', () => {
    const events = genDashboardEvents(eventOpts());
    const seen = new Set();
    for (const e of events) {
      expect(CATEGORIES).toContain(e.category);
      seen.add(e.category);
    }
    expect([...seen].sort()).toEqual([...CATEGORIES].sort());
  });

  it('produces both billable and non-billable events', () => {
    const events = genDashboardEvents(eventOpts());
    expect(events.some((e) => e.isBillable === true)).toBe(true);
    expect(events.some((e) => e.isBillable === false)).toBe(true);
  });

  it('fills id, eventTypeLabel and eventTypeColor as non-empty strings with unique ids', () => {
    const events = genDashboardEvents(eventOpts());
    for (const e of events) {
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(typeof e.eventTypeLabel).toBe('string');
      expect(e.eventTypeLabel.length).toBeGreaterThan(0);
      expect(typeof e.eventTypeColor).toBe('string');
      expect(e.eventTypeColor.length).toBeGreaterThan(0);
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it('types stageLabel/stageColor/nonBillableType/nonBillableColor as string or null on every event', () => {
    for (const e of genDashboardEvents(eventOpts())) {
      expect(isStringOrNull(e.stageLabel)).toBe(true);
      expect(isStringOrNull(e.stageColor)).toBe(true);
      expect(isStringOrNull(e.nonBillableType)).toBe(true);
      expect(isStringOrNull(e.nonBillableColor)).toBe(true);
    }
  });

  it('appends edge-case events after the count regular ones when includeEdgeCases is true', () => {
    const events = genDashboardEvents(eventOpts({ includeEdgeCases: true }));
    expect(events.length).toBeGreaterThan(5000);
    const tail = events.slice(5000);
    expect(tail.some((e) => e.date === null)).toBe(true);
    expect(
      tail.some((e) => e.date instanceof Date && Number.isNaN(e.date.getTime()))
    ).toBe(true);
    expect(tail.some((e) => e.reporterId === null)).toBe(true);
    expect(tail.some((e) => e.hours === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// genDayOffRequests
// ---------------------------------------------------------------------------
describe('genDayOffRequests', () => {
  const opts = {
    employeeIds: EMPLOYEE_IDS,
    types: ABSENCE_TYPES,
    year: 2026,
    count: 1000,
    seed: 7,
  };

  it('returns exactly 1000 requests for count 1000', () => {
    expect(genDayOffRequests(opts)).toHaveLength(1000);
  });

  it('starts every request on a YYYY-MM-DD date inside 2026', () => {
    for (const r of genDayOffRequests(opts)) {
      expect(r.start).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(r.start))).toBe(false);
    }
  });

  it('keeps start <= end with a range span of at most 10 calendar days', () => {
    for (const r of genDayOffRequests(opts)) {
      expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.start <= r.end).toBe(true);
      const spanDays = (Date.parse(r.end) - Date.parse(r.start)) / DAY_MS + 1;
      expect(spanDays).toBeGreaterThanOrEqual(1);
      expect(spanDays).toBeLessThanOrEqual(10);
    }
  });

  it('uses only the three allowed statuses and covers all three across 1000 requests', () => {
    const allowed = ['pending', 'approved', 'rejected'];
    const requests = genDayOffRequests(opts);
    const seen = new Set();
    for (const r of requests) {
      expect(allowed).toContain(r.status);
      seen.add(r.status);
    }
    expect([...seen].sort()).toEqual([...allowed].sort());
  });

  it('draws employeeId and type from the supplied pools on every request', () => {
    const empSet = new Set(EMPLOYEE_IDS);
    const typeSet = new Set(ABSENCE_TYPES);
    for (const r of genDayOffRequests(opts)) {
      expect(empSet.has(r.employeeId)).toBe(true);
      expect(typeSet.has(r.type)).toBe(true);
    }
  });

  it('fills id (unique) and submittedAt as non-empty strings', () => {
    const requests = genDayOffRequests(opts);
    for (const r of requests) {
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.submittedAt).toBe('string');
      expect(r.submittedAt.length).toBeGreaterThan(0);
    }
    expect(new Set(requests.map((r) => r.id)).size).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// genEntitlements
// ---------------------------------------------------------------------------
describe('genEntitlements', () => {
  const opts = { employeeIds: EMPLOYEE_IDS, types: ABSENCE_TYPES, year: 2026, seed: 3 };

  it('returns exactly employeeIds.length x types.length rows (30 x 4 = 120)', () => {
    expect(genEntitlements(opts)).toHaveLength(120);
  });

  it('emits exactly one row for the (emp-7, reserves) pair', () => {
    const matches = genEntitlements(opts).filter(
      (e) => e.employeeId === 'emp-7' && e.type === 'reserves'
    );
    expect(matches).toHaveLength(1);
  });

  it('sets entitled to an integer in [5, 30] on every row', () => {
    for (const e of genEntitlements(opts)) {
      expect(Number.isInteger(e.entitled)).toBe(true);
      expect(e.entitled).toBeGreaterThanOrEqual(5);
      expect(e.entitled).toBeLessThanOrEqual(30);
    }
  });

  it('stamps the requested year on every row', () => {
    for (const e of genEntitlements(opts)) {
      expect(e.year).toBe(2026);
    }
  });
});

// ---------------------------------------------------------------------------
// genAllocationItems
// ---------------------------------------------------------------------------
describe('genAllocationItems', () => {
  // Built lazily so the module's pool generators run inside each test, not at collection.
  const allocOpts = () => ({
    count: 1200,
    projects: genProjects(40, 1),
    users: genUsers(30, 1),
    projectColumnId: 'rel_proj',
    employeeColumnId: 'people_col',
    seed: 11,
  });

  it('returns exactly 1200 items for count 1200', () => {
    expect(genAllocationItems(allocOpts())).toHaveLength(1200);
  });

  it('gives every item a unique id and a non-empty name', () => {
    const items = genAllocationItems(allocOpts());
    for (const item of items) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.name).toBe('string');
      expect(item.name.length).toBeGreaterThan(0);
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(1200);
  });

  it('links each item to exactly one pool project via the rel_proj column', () => {
    const opts = allocOpts();
    const projectIds = new Set(opts.projects.map((p) => p.id));
    for (const item of genAllocationItems(opts)) {
      const cv = item.column_values.find((c) => c.id === 'rel_proj');
      expect(cv).toBeDefined();
      expect(typeof cv.text).toBe('string');
      expect(Array.isArray(cv.linked_item_ids)).toBe(true);
      expect(cv.linked_item_ids).toHaveLength(1);
      expect(projectIds.has(cv.linked_item_ids[0])).toBe(true);
    }
  });

  it('assigns each item a pool user via the people_col column', () => {
    const opts = allocOpts();
    const userIds = new Set(opts.users.map((u) => u.id));
    for (const item of genAllocationItems(opts)) {
      const cv = item.column_values.find((c) => c.id === 'people_col');
      expect(cv).toBeDefined();
      expect(typeof cv.text).toBe('string');
      expect(Array.isArray(cv.persons_and_teams)).toBe(true);
      expect(userIds.has(cv.persons_and_teams[0].id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// genAggregateGroups
// ---------------------------------------------------------------------------
describe('genAggregateGroups', () => {
  const IDS = Array.from({ length: 500 }, (_, i) => `alloc-${i + 1}`);
  const findEntry = (group, alias) => group.entries.find((e) => e.alias === alias);

  it('returns one group per id (500 in, 500 out)', () => {
    expect(genAggregateGroups({ ids: IDS, seed: 5 })).toHaveLength(500);
  });

  it('shapes each group with an alloc_id entry {value:{value:id}} and an hrs entry {value:{result:number}}', () => {
    const idSet = new Set(IDS);
    for (const group of genAggregateGroups({ ids: IDS, seed: 5 })) {
      const idEntry = findEntry(group, 'alloc_id');
      const hrsEntry = findEntry(group, 'hrs');
      expect(idEntry).toBeDefined();
      expect(hrsEntry).toBeDefined();
      expect(idSet.has(idEntry.value.value)).toBe(true);
      expect(typeof hrsEntry.value.result).toBe('number');
    }
  });

  it('keeps every hrs result in [1, 200] with at most 2 decimal places', () => {
    for (const group of genAggregateGroups({ ids: IDS, seed: 5 })) {
      const result = findEntry(group, 'hrs').value.result;
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(200);
      expect(Math.round(result * 100) / 100).toBe(result);
    }
  });

  it('emits each input id exactly once across the groups', () => {
    const emitted = genAggregateGroups({ ids: IDS, seed: 5 }).map(
      (g) => findEntry(g, 'alloc_id').value.value
    );
    expect(emitted.slice().sort()).toEqual(IDS.slice().sort());
    expect(new Set(emitted).size).toBe(500);
  });

  it('prepends a null-id bucket with the given hours when nullGroupHours is set', () => {
    const groups = genAggregateGroups({ ids: IDS, seed: 5, nullGroupHours: 2728.8 });
    expect(groups).toHaveLength(501);
    const first = groups[0];
    expect(findEntry(first, 'alloc_id').value.value).toBeNull();
    expect(findEntry(first, 'hrs').value.result).toBe(2728.8);
  });

  it('uses custom idAlias/valueAlias for the entry aliases when provided', () => {
    const groups = genAggregateGroups({
      ids: ['x-1', 'x-2'],
      seed: 5,
      idAlias: 'group_key',
      valueAlias: 'total_hours',
    });
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(findEntry(group, 'group_key')).toBeDefined();
      expect(findEntry(group, 'total_hours')).toBeDefined();
      expect(findEntry(group, 'alloc_id')).toBeUndefined();
      expect(findEntry(group, 'hrs')).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// paginate
// ---------------------------------------------------------------------------
describe('paginate', () => {
  const ITEMS = Array.from({ length: 1050 }, (_, i) => i + 1);

  it('splits 1050 items at pageSize 500 into pages of 500/500/50', () => {
    const pages = paginate(ITEMS, 500);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.items.length)).toEqual([500, 500, 50]);
  });

  it('assigns cursors "cursor-1", "cursor-2", null in order', () => {
    const pages = paginate(ITEMS, 500);
    expect(pages.map((p) => p.cursor)).toEqual(['cursor-1', 'cursor-2', null]);
  });

  it('preserves item order and boundaries across pages', () => {
    const pages = paginate(ITEMS, 500);
    expect(pages[0].items[0]).toBe(1);
    expect(pages[0].items[499]).toBe(500);
    expect(pages[1].items[0]).toBe(501);
    expect(pages[1].items[499]).toBe(1000);
    expect(pages[2].items[0]).toBe(1001);
    expect(pages[2].items[49]).toBe(1050);
  });

  it('yields one empty page with a null cursor for an empty items array', () => {
    expect(paginate([], 500)).toEqual([{ cursor: null, items: [] }]);
  });

  it('yields a single null-cursor page when items fit inside one page', () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(paginate(ten, 500)).toEqual([{ cursor: null, items: ten }]);
  });
});

// ---------------------------------------------------------------------------
// round2
// ---------------------------------------------------------------------------
describe('round2', () => {
  it('rounds 10.256 to 10.26', () => {
    expect(round2(10.256)).toBe(10.26);
  });

  it('rounds 3.14159 down to 3.14', () => {
    expect(round2(3.14159)).toBe(3.14);
  });

  it('leaves the integer 2 unchanged', () => {
    expect(round2(2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same seed reproduces byte-identical output, different seed
// diverges, for every generator.
// ---------------------------------------------------------------------------
describe('determinism across seeds', () => {
  it('genUsers: same seed reproduces identical output; different seed diverges', () => {
    expect(JSON.stringify(genUsers(30, 9))).toBe(JSON.stringify(genUsers(30, 9)));
    expect(JSON.stringify(genUsers(30, 9))).not.toBe(JSON.stringify(genUsers(30, 10)));
  });

  it('genProjects: same seed reproduces identical output; different seed diverges', () => {
    expect(JSON.stringify(genProjects(40, 9))).toBe(JSON.stringify(genProjects(40, 9)));
    expect(JSON.stringify(genProjects(40, 9))).not.toBe(
      JSON.stringify(genProjects(40, 10))
    );
  });

  it('genDashboardEvents: same seed reproduces identical output (dates compared via getTime); different seed diverges', () => {
    const a = genDashboardEvents(eventOpts({ seed: 9 }));
    const b = genDashboardEvents(eventOpts({ seed: 9 }));
    const c = genDashboardEvents(eventOpts({ seed: 10 }));
    expect(serializeEvents(a)).toBe(serializeEvents(b));
    expect(serializeEvents(a)).not.toBe(serializeEvents(c));
  });

  it('genDayOffRequests: same seed reproduces identical output; different seed diverges', () => {
    const base = { employeeIds: EMPLOYEE_IDS, types: ABSENCE_TYPES, year: 2026, count: 1000 };
    const a = genDayOffRequests({ ...base, seed: 9 });
    const b = genDayOffRequests({ ...base, seed: 9 });
    const c = genDayOffRequests({ ...base, seed: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('genEntitlements: same seed reproduces identical output; different seed diverges', () => {
    const base = { employeeIds: EMPLOYEE_IDS, types: ABSENCE_TYPES, year: 2026 };
    const a = genEntitlements({ ...base, seed: 9 });
    const b = genEntitlements({ ...base, seed: 9 });
    const c = genEntitlements({ ...base, seed: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('genAllocationItems: same seed reproduces identical output; different seed diverges', () => {
    const base = {
      count: 1200,
      projects: genProjects(40, 1),
      users: genUsers(30, 1),
      projectColumnId: 'rel_proj',
      employeeColumnId: 'people_col',
    };
    const a = genAllocationItems({ ...base, seed: 9 });
    const b = genAllocationItems({ ...base, seed: 9 });
    const c = genAllocationItems({ ...base, seed: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('genAggregateGroups: same seed reproduces identical output; different seed diverges', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `alloc-${i + 1}`);
    const a = genAggregateGroups({ ids, seed: 9 });
    const b = genAggregateGroups({ ids, seed: 9 });
    const c = genAggregateGroups({ ids, seed: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});
