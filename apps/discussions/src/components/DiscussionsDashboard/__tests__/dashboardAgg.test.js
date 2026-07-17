import { describe, it, expect } from 'vitest';
import { rangeBounds, summarize, aggregateDashboard } from '../dashboardAgg.js';

// round152 — the discussions-dashboard aggregation is the feature's whole
// business logic (time bounds, dimension filters, the seven metrics, the
// sum/avg/median toggle). These tests pin every branch.

const NOW = new Date(2026, 6, 17, 12, 0); // 17 Jul 2026, noon

describe('rangeBounds', () => {
  it('week = trailing 7 days inclusive', () => {
    const { from, to } = rangeBounds('week', NOW);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(6);
    expect(from.getDate()).toBe(11); // 17 - 6
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(17);
    expect(to.getHours()).toBe(23);
  });
  it('month / quarter / year subtract 1 / 3 / 12 months', () => {
    expect(rangeBounds('month', NOW).from.getMonth()).toBe(5);   // Jun
    expect(rangeBounds('quarter', NOW).from.getMonth()).toBe(3); // Apr
    const y = rangeBounds('year', NOW).from;
    expect(y.getFullYear()).toBe(2025);
    expect(y.getMonth()).toBe(6);
  });
  it('custom uses the given ends; incomplete custom falls back to month', () => {
    const c = rangeBounds('custom', NOW, { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) });
    expect(c.from.getMonth()).toBe(0);
    expect(c.to.getDate()).toBe(31);
    expect(rangeBounds('custom', NOW, null).from.getMonth()).toBe(5); // fallback = month
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

// Two discussions in range (Jul), one out of range (Jan).
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

describe('aggregateDashboard — scope & metrics', () => {
  it('counts only in-range discussions and their tasks/decisions', () => {
    const r = aggregateDashboard(fixture(), { preset: 'month', now: NOW, mode: 'sum' });
    expect(r.totalDiscussions).toBe(2);          // the Jan discussion is excluded
    expect(r.decisionsPerDiscussion).toBe(3);    // sum: d1,d2 (disc1) + d3 (disc2)
    expect(r.tasksPerDiscussion).toBe(3);        // sum: t1,t2 (disc1) + t3 (disc2)
    expect(r.participations).toBe(3);            // sum: 2 + 1
  });

  it('avg / median modes operate per discussion', () => {
    const avg = aggregateDashboard(fixture(), { preset: 'month', now: NOW, mode: 'avg' });
    expect(avg.decisionsPerDiscussion).toBe(1.5); // (2+1)/2
    const med = aggregateDashboard(fixture(), { preset: 'month', now: NOW, mode: 'median' });
    expect(med.tasksPerDiscussion).toBe(1.5);     // median of [2,1]
  });

  it('effectiveness: done / delayed / pct over in-scope tasks', () => {
    const r = aggregateDashboard(fixture(), { preset: 'month', now: NOW });
    expect(r.effectiveness.total).toBe(3);
    expect(r.effectiveness.done).toBe(1);
    expect(r.effectiveness.delayed).toBe(1);
    expect(r.effectiveness.pct).toBe(33); // 1/3
  });

  it('byType is discussion counts per type, sorted desc', () => {
    const r = aggregateDashboard(fixture(), { preset: 'month', now: NOW });
    expect(r.byType).toEqual([{ label: 'שבועי', count: 1 }, { label: 'צוותי', count: 1 }]);
  });

  it('byParticipant ranks people by discussions attended', () => {
    const r = aggregateDashboard(fixture(), { preset: 'month', now: NOW });
    expect(r.byParticipant[0]).toMatchObject({ id: 'p1', count: 2 }); // רות attends both
  });

  it('byMonth is continuous & zero-filled across the range', () => {
    const r = aggregateDashboard(fixture(), { preset: 'year', now: NOW });
    expect(r.byMonth.length).toBe(13);           // Jul 2025 .. Jul 2026 inclusive
    const jul = r.byMonth.find((b) => b.key === '2026-07');
    const jan = r.byMonth.find((b) => b.key === '2026-01');
    expect(jul.count).toBe(2);
    expect(jan.count).toBe(1);                    // the old discussion shows in a year range
  });
});

describe('aggregateDashboard — dimension filters', () => {
  it('lead filter keeps only that lead’s discussions', () => {
    const r = aggregateDashboard(fixture(), { preset: 'year', now: NOW, leadId: '10' });
    expect(r.totalDiscussions).toBe(2); // discussions 1 and 3 (both led by דנה), across the year
  });
  it('type filter narrows to one type', () => {
    const r = aggregateDashboard(fixture(), { preset: 'year', now: NOW, typeValue: 'צוותי' });
    expect(r.totalDiscussions).toBe(1);
  });
  it('participant filter keeps discussions that person attended', () => {
    const r = aggregateDashboard(fixture(), { preset: 'month', now: NOW, participantId: 'p2' });
    expect(r.totalDiscussions).toBe(1); // only discussion 1 has יוסי
  });
});
