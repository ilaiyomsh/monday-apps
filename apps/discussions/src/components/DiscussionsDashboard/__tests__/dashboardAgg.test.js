import { describe, it, expect } from 'vitest';
import { buildPeriods, summarize, aggregateDashboard, PERIOD_CONFIG } from '../dashboardAgg.js';

// round154 — the discussions-dashboard aggregation is the feature's whole
// business logic (the trailing-period model that swaps granularity with the
// time pill, dimension filters, the seven metrics, the sum/avg/median toggle,
// and the per-bucket / per-type drill-down lists). These tests pin every branch.

const NOW = new Date(2026, 6, 17, 12, 0); // 17 Jul 2026 (Fri), noon

describe('buildPeriods', () => {
  it('week = 8 trailing weeks, Sunday-started, ending with the week of `now`', () => {
    const { unit, buckets, from } = buildPeriods('week', NOW);
    expect(unit).toBe('week');
    expect(buckets.length).toBe(PERIOD_CONFIG.week.count); // 8
    const last = buckets[buckets.length - 1];
    expect(last.start.getDay()).toBe(0);       // weeks start Sunday
    expect(last.start.getFullYear()).toBe(2026);
    expect(last.start.getMonth()).toBe(6);
    expect(last.start.getDate()).toBe(12);     // Sun 12 Jul contains Fri 17 Jul
    expect(from.getTime()).toBe(buckets[0].start.getTime()); // range opens at the first bucket
    expect(buckets[0].start.getDate()).toBe(24); // 7 weeks before 12 Jul = 24 May
    expect(buckets[0].start.getMonth()).toBe(4);
  });

  it('month / quarter / year use their configured trailing counts', () => {
    expect(buildPeriods('month', NOW).buckets.length).toBe(12);
    expect(buildPeriods('quarter', NOW).buckets.length).toBe(8);
    expect(buildPeriods('year', NOW).buckets.length).toBe(5);
    // month buckets end with the current month (Jul 2026).
    const m = buildPeriods('month', NOW).buckets;
    expect(m[m.length - 1].key).toBe('2026-07');
  });

  it('custom buckets by month across the given ends', () => {
    const { unit, buckets } = buildPeriods('custom', NOW, { from: new Date(2026, 0, 15), to: new Date(2026, 2, 3) });
    expect(unit).toBe('month');
    expect(buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('summarize', () => {
  it('sum / avg(1dp) / median / empty', () => {
    expect(summarize([1, 2, 3, 4], 'sum')).toBe(10);
    expect(summarize([1, 2, 4], 'avg')).toBe(2.3);
    expect(summarize([1, 2, 3, 4], 'median')).toBe(2.5);
    expect(summarize([5, 1, 3], 'median')).toBe(3);
    expect(summarize([], 'sum')).toBe(0);
  });
});

// Two discussions inside the trailing 8 weeks (5 + 12 Jul), one far in the past
// (3 Jan) that only a wide preset (year) reaches.
function fixture() {
  const discussions = [
    { id: '1', name: 'A', date: new Date(2026, 6, 5), type: 'שבועי', lead: [{ id: '10', name: 'דנה' }], participants: [{ id: 'p1', name: 'רות' }, { id: 'p2', name: 'יוסי' }] },
    { id: '2', name: 'B', date: new Date(2026, 6, 12), type: 'צוותי', lead: [{ id: '11', name: 'עידו' }], participants: [{ id: 'p1', name: 'רות' }] },
    { id: '3', name: 'C(old)', date: new Date(2026, 0, 3), type: 'שבועי', lead: [{ id: '10', name: 'דנה' }], participants: [{ id: 'p1', name: 'רות' }] },
  ];
  const tasks = [
    { id: 't1', discussionId: '1', statusID: 1, deadlineID: null },                    // done
    { id: 't2', discussionId: '1', statusID: 0, deadlineID: new Date(2026, 5, 1) },     // delayed (past, not done)
    { id: 't3', discussionId: '2', statusID: 2, deadlineID: null },                     // open
    { id: 't9', discussionId: '3', statusID: 1, deadlineID: null },                     // out of range
  ];
  const decisions = [
    { id: 'd1', discussionId: '1' }, { id: 'd2', discussionId: '1' }, { id: 'd3', discussionId: '2' },
    { id: 'd9', discussionId: '3' },
  ];
  return { discussions, tasks, decisions, doneStatusIds: new Set([1]) };
}

describe('aggregateDashboard — defaults & scope', () => {
  it('opens on the week preset (unit + axis label)', () => {
    const r = aggregateDashboard(fixture(), { now: NOW }); // no preset → default
    expect(r.unit).toBe('week');
    expect(r.axisLabel).toBe('לפי שבוע');
  });

  it('counts only in-window discussions and their tasks/decisions', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW, mode: 'sum' });
    expect(r.totalDiscussions).toBe(2);          // the Jan discussion is outside 8 weeks
    expect(r.decisionsPerDiscussion).toBe(3);    // sum: d1,d2 (disc1) + d3 (disc2)
    expect(r.tasksPerDiscussion).toBe(3);        // sum: t1,t2 (disc1) + t3 (disc2)
    expect(r.participations).toBe(3);            // sum: 2 + 1
  });

  it('avg / median modes operate per discussion', () => {
    const avg = aggregateDashboard(fixture(), { preset: 'week', now: NOW, mode: 'avg' });
    expect(avg.decisionsPerDiscussion).toBe(1.5); // (2+1)/2
    const med = aggregateDashboard(fixture(), { preset: 'week', now: NOW, mode: 'median' });
    expect(med.tasksPerDiscussion).toBe(1.5);     // median of [2,1]
  });

  it('effectiveness: done / delayed / pct over in-scope tasks', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW });
    expect(r.effectiveness.total).toBe(3);
    expect(r.effectiveness.done).toBe(1);
    expect(r.effectiveness.delayed).toBe(1);
    expect(r.effectiveness.pct).toBe(33); // 1/3, delayed NOT in the denominator
  });
});

describe('aggregateDashboard — charts & drill-down', () => {
  it('byPeriod is continuous, zero-filled, and carries the drill-down list per bucket', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW });
    expect(r.byPeriod.length).toBe(8);
    const wk12 = r.byPeriod.find((b) => b.key === '2026-07-12');
    const wk05 = r.byPeriod.find((b) => b.key === '2026-07-05');
    expect(wk12.count).toBe(1);
    expect(wk12.items).toEqual([{ id: '2', name: 'B', date: new Date(2026, 6, 12) }]);
    expect(wk05.count).toBe(1);
    expect(wk05.items[0].id).toBe('1');
    // an empty bucket is present with a zeroed count and no items (drill-down safe)
    const empty = r.byPeriod.find((b) => b.count === 0);
    expect(empty.items).toEqual([]);
  });

  it('byType counts discussions per type, sorted desc, each carrying its list', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW });
    expect(r.byType.map((t) => t.label)).toEqual(['שבועי', 'צוותי']);
    const weekly = r.byType.find((t) => t.label === 'שבועי');
    expect(weekly.count).toBe(1);
    expect(weekly.items).toEqual([{ id: '1', name: 'A', date: new Date(2026, 6, 5) }]);
  });

  it('byParticipant ranks people by discussions attended', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW });
    expect(r.byParticipant[0]).toMatchObject({ id: 'p1', count: 2 }); // רות attends both
  });
});

describe('aggregateDashboard — dimension filters', () => {
  it('lead filter keeps only that lead’s discussions (across a wide window)', () => {
    const r = aggregateDashboard(fixture(), { preset: 'year', now: NOW, leadId: '10' });
    expect(r.totalDiscussions).toBe(2); // discussions 1 and 3 (both led by דנה), within 5 years
  });
  it('type filter narrows to one type', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW, typeValue: 'צוותי' });
    expect(r.totalDiscussions).toBe(1);
  });
  it('participant filter keeps discussions that person attended', () => {
    const r = aggregateDashboard(fixture(), { preset: 'week', now: NOW, participantId: 'p2' });
    expect(r.totalDiscussions).toBe(1); // only discussion 1 has יוסי
  });
});
