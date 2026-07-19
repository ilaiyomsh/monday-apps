/**
 * fetchCriticalBundle at scale (30+ users / dozens of projects / 1,200
 * current+future allocations) — the planner's single critical-path load (#90).
 *
 * Pins the three volume behaviors the Gantt depends on:
 *  1. Cursor DRAIN — allocations beyond the first 500-item page are fetched to
 *     exhaustion via next_items_page(limit: 500); nothing lost, nothing duped.
 *  2. Reported-hours aggregate 500-GROUP CAP — monday's aggregate returns at
 *     most REPORTED_HOURS_AGG_LIMIT groups and the parser only WARNS (#90
 *     pagination TODO). This test CHARACTERIZES the current truncation contract;
 *     when #90 lands, the warn assertion below must flip — that is deliberate.
 *  3. Project id CHUNKING — >100 distinct project ids are fetched in ≤100-id
 *     chunks with an explicit limit:100 (the root items(ids:) 25-item default
 *     silently drops names otherwise), every id exactly once.
 *
 * Same apiQueue funnel mock as mondayService.projectMetrics.test.ts; response
 * shapes come from @axis/scale-fixtures and mirror the proven captures.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../apiQueue', () => ({ apiQueue: { execute } }));
vi.mock('monday-sdk-js', () => ({ default: () => ({}) }));

import { mondayService } from '../mondayService';
import { logger } from '../../utils/Logger';
import type { PlannerSettings } from '../../types/settings.types';
import {
  genUsers,
  genProjects,
  genAllocationItems,
  genAggregateGroups,
  paginate,
} from '@axis/scale-fixtures';

const SETTINGS = {
  allocationsBoardId: '900100',
  employeesBoardId: '900200',
  projectsBoardId: '900300',
  startDateColumnId: 'start_col',
  endDateColumnId: 'end_col',
  hoursPerDayColumnId: 'hpd_col',
  totalHoursColumnId: 'total_col',
  projectColumnId: 'rel_proj',
  employeeColumnId: 'people_col',
  roleColumnId: 'role_col',
  reportedHoursColumnId: 'mirror_reported',
  timeLogsAllocationColumnId: 'rel_alloc_logs',
} as unknown as PlannerSettings;

/** Allocations-board columns incl. the reported-hours mirror the aggregate
 *  config is derived from (settings-field shape: displayed_linked_columns as
 *  the ARRAY variant the live API returns). */
const ALLOC_COLUMNS = [
  {
    id: 'mirror_reported',
    title: 'שעות בפועל',
    type: 'mirror',
    settings: { displayed_linked_columns: [{ board_id: '800100', column_ids: ['dur_col'] }] },
  },
  { id: 'rel_proj', title: 'פרויקט', type: 'board_relation', settings: { boardIds: ['900300'] } },
];

const USERS = genUsers(30, 1);
const PROJECTS = genProjects(250, 1);
const ALLOC_ITEMS = genAllocationItems({
  count: 1200,
  projects: PROJECTS,
  users: USERS,
  projectColumnId: 'rel_proj',
  employeeColumnId: 'people_col',
  seed: 11,
});
const ALLOC_PAGES = paginate(ALLOC_ITEMS, 500);
const EMP_ITEMS = USERS.map((u, i) => ({
  id: `emp-item-${i + 1}`,
  name: u.name,
  column_values: [{ id: 'linked_user', text: u.name, persons_and_teams: [{ id: u.id }] }],
}));

/** Distinct project ids actually referenced by the fixture allocations —
 *  expectations derive from the data, not from an assumed count. */
const DISTINCT_PROJECT_IDS = Array.from(
  new Set(
    ALLOC_ITEMS.map(
      (it) => it.column_values.find((c) => c.id === 'rel_proj')!.linked_item_ids![0]
    )
  )
);
const PROJECT_BY_ID = new Map(PROJECTS.map((p) => [p.id, p]));

// 499 real aggregate groups + the null (unlinked-logs) bucket = exactly 500
// results — the cap boundary monday's aggregate limit produces.
const AGG_IDS = ALLOC_ITEMS.slice(0, 499).map((it) => it.id);
const AGG_GROUPS = genAggregateGroups({ ids: AGG_IDS, seed: 5, nullGroupHours: 2728.8 });

function installDispatch() {
  const drainQueue = [ALLOC_PAGES[1], ALLOC_PAGES[2]];
  execute.mockImplementation(async (query: string, opts?: { variables?: Record<string, unknown> }) => {
    if (query.includes('allocations: boards')) {
      return {
        data: {
          allocations: [{ items_page: { cursor: ALLOC_PAGES[0].cursor, items: ALLOC_PAGES[0].items } }],
          employees: [{ items_page: { cursor: null, items: EMP_ITEMS } }],
          cols: [{ columns: ALLOC_COLUMNS }],
        },
      };
    }
    if (query.includes('next_items_page')) {
      const page = drainQueue.shift();
      if (!page) throw new Error('next_items_page called after the cursor chain ended');
      return { data: { next_items_page: { cursor: page.cursor, items: page.items } } };
    }
    if (query.includes('aggregate(')) {
      // docB: reported aggregate + first 100-project chunk in one document.
      const requestedIds = (query.match(/"\d{7}"/g) || []).map((s) => s.replaceAll('"', ''));
      return {
        data: {
          reported: { results: AGG_GROUPS },
          projects: requestedIds.map((id) => ({ id, name: PROJECT_BY_ID.get(id)!.name })),
        },
      };
    }
    if (query.includes('items (ids: $ids')) {
      const ids = (opts?.variables as { ids: string[] }).ids;
      return { data: { items: ids.map((id) => ({ id, name: PROJECT_BY_ID.get(id)!.name })) } };
    }
    throw new Error(`unexpected query: ${query.slice(0, 120)}`);
  });
}

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  installDispatch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchCriticalBundle with 1,200 allocations / 30 employees / 250 projects', () => {
  it('drains the allocations cursor to exhaustion — 1,200 unique items across 3 pages of 500', async () => {
    const bundle = await mondayService.fetchCriticalBundle(SETTINGS);

    expect(bundle.allocItems).toHaveLength(1200);
    expect(new Set(bundle.allocItems.map((it: { id: string }) => it.id)).size).toBe(1200);
    expect(bundle.empItems).toHaveLength(30);

    const drainCalls = execute.mock.calls.filter(([q]) => (q as string).includes('next_items_page'));
    expect(drainCalls).toHaveLength(2);
    for (const [q] of drainCalls) expect(q as string).toContain('next_items_page(limit: 500');
    expect(drainCalls.map(([, o]) => (o as { variables: { cursor: string } }).variables.cursor))
      .toEqual(['cursor-1', 'cursor-2']);
  });

  it('parses the reported-hours aggregate at the 500-group cap: null bucket dropped, 499 mapped, cap WARNING logged (#90 — flip when pagination lands)', async () => {
    const bundle = await mondayService.fetchCriticalBundle(SETTINGS);

    expect(bundle.reportedByAllocId.size).toBe(499);
    expect(bundle.reportedByAllocId.has('null')).toBe(false);
    // Spot-check an exact join: first aggregate id carries its generated hours.
    const firstRealGroup = AGG_GROUPS[1];
    const firstId = (firstRealGroup.entries[0] as { value: { value: string } }).value.value;
    const firstHours = (firstRealGroup.entries[1] as { value: { result: number } }).value.result;
    expect(bundle.reportedByAllocId.get(firstId)).toBe(firstHours);

    // CHARACTERIZATION of the #90 truncation: at exactly 500 result groups the
    // service only warns. If this assertion fails because the warning is gone,
    // aggregate pagination presumably landed — update this test to assert full
    // coverage instead.
    const warnCalls = vi.mocked(logger.warn).mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('500-group cap'))).toBe(true);
  });

  it('fetches all >100 distinct project ids in ≤100-id chunks with limit:100, each id exactly once', async () => {
    const bundle = await mondayService.fetchCriticalBundle(SETTINGS);

    expect(DISTINCT_PROJECT_IDS.length).toBeGreaterThan(100); // dataset sanity — chunking must engage
    expect(bundle.projectItems).toHaveLength(DISTINCT_PROJECT_IDS.length);
    expect(new Set(bundle.projectItems.map((p: { id: string }) => p.id))).toEqual(
      new Set(DISTINCT_PROJECT_IDS)
    );
    for (const p of bundle.projectItems as Array<{ id: string; name: string }>) {
      expect(p.name).toBe(PROJECT_BY_ID.get(p.id)!.name);
    }

    // docB carries the first chunk: exactly 100 quoted ids with limit: 100.
    const docB = execute.mock.calls.find(([q]) => (q as string).includes('aggregate('))![0] as string;
    const docBIds = docB.match(/"\d{7}"/g) || [];
    expect(docBIds).toHaveLength(100);
    expect(docB).toContain('limit: 100');

    // Overflow chunks: ≤100 ids each, together covering the rest exactly once.
    const chunkCalls = execute.mock.calls.filter(([q]) => (q as string).includes('items (ids: $ids'));
    expect(chunkCalls.length).toBe(Math.ceil((DISTINCT_PROJECT_IDS.length - 100) / 100));
    const chunkIds = chunkCalls.flatMap(
      ([, o]) => (o as { variables: { ids: string[] } }).variables.ids
    );
    for (const [q] of chunkCalls) expect(q as string).toContain('limit: 100');
    for (const [, o] of chunkCalls) {
      expect((o as { variables: { ids: string[] } }).variables.ids.length).toBeLessThanOrEqual(100);
    }
    expect(chunkIds.length + 100).toBe(DISTINCT_PROJECT_IDS.length);
    expect(new Set(chunkIds).size).toBe(chunkIds.length);
  });
});
