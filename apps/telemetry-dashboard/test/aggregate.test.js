// Unit tests for src/client/lib/aggregate.js — focused on the errors_over_time NaN-binStart
// guard (gap #4). A record whose _time is unparseable yields Date.parse -> NaN -> a NaN
// binStart, and new Date(NaN).toISOString() throws a RangeError that would drop the whole
// dashboard to the ErrorBoundary. aggregateAll must never throw and must drop the
// unbucketable point instead. Also covers the kpi_summary error_rate math it feeds KpiRow.

import { describe, it, expect } from 'vitest';
import { aggregateAll } from '../src/client/lib/aggregate.js';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const DEFAULT_FILTERS = { window: '7d', apps: [], accounts: [], kinds: [], focusError: null };

function errorRec(overrides = {}) {
  return {
    _time: '2026-07-19T12:00:00.000Z',
    kind: 'error',
    app: 'axis-tracker',
    acc: 'acc1',
    err_name: 'TypeError',
    err_msg: 'boom',
    err_code: null,
    ...overrides,
  };
}

describe('aggregateAll — errors_over_time NaN binStart guard (render-crash gap #4)', () => {
  it('does not throw when a record carries an unparseable _time (NaN binStart)', () => {
    const records = [errorRec(), errorRec({ _time: 'not-a-date' })];
    expect(() => aggregateAll(records, DEFAULT_FILTERS, NOW)).not.toThrow();
  });

  it('drops the unbucketable point but keeps the valid ones, all with valid ISO _time', () => {
    const records = [
      errorRec({ _time: '2026-07-19T12:00:00.000Z' }),
      errorRec({ _time: 'not-a-date' }),
      errorRec({ _time: '2026-07-18T12:00:00.000Z' }),
    ];
    const { errors_over_time } = aggregateAll(records, DEFAULT_FILTERS, NOW);
    // The two valid records bucket; the unparseable one is dropped, not carried as null.
    expect(errors_over_time).toHaveLength(2);
    for (const row of errors_over_time) {
      expect(row._time).not.toBeNull();
      expect(Number.isNaN(Date.parse(row._time))).toBe(false);
    }
  });

  it('produces an empty errors_over_time (no crash) when the only error has a bad _time', () => {
    const records = [errorRec({ _time: 'garbage' })];
    const { errors_over_time } = aggregateAll(records, DEFAULT_FILTERS, NOW);
    expect(errors_over_time).toEqual([]);
  });
});

describe('aggregateAll — kpi_summary error_rate (the value KpiRow renders)', () => {
  it('computes error_rate as a rounded percentage of errors over total records', () => {
    // 1 error + 3 usage in-window = 4 total -> 25%
    const records = [
      errorRec(),
      errorRec({ kind: 'usage', err_name: undefined }),
      errorRec({ kind: 'usage', err_name: undefined }),
      errorRec({ kind: 'usage', err_name: undefined }),
    ];
    const { kpi_summary } = aggregateAll(records, DEFAULT_FILTERS, NOW);
    expect(kpi_summary.total).toBe(4);
    expect(kpi_summary.errors).toBe(1);
    expect(kpi_summary.error_rate).toBe(25);
  });

  it('error_rate is 0 (not NaN) for an empty window', () => {
    const { kpi_summary } = aggregateAll([], DEFAULT_FILTERS, NOW);
    expect(kpi_summary.total).toBe(0);
    expect(kpi_summary.error_rate).toBe(0);
  });
});
