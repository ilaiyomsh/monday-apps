import { describe, it, expect } from 'vitest';
import { groupByGranularity } from '../dashboardAggregation';

/**
 * Contract test for dashboard aggregation's resilience to bad data.
 *
 * Aggregation runs at render. The desired contract — independent of the implementation —
 * is that a single event carrying an invalid or missing date in the dataset must NOT crash
 * the dashboard (a date-fns format() RangeError), it must be skipped while the valid events
 * are still aggregated correctly.
 */
describe('dashboardAggregation — a bad-date event never crashes aggregation', () => {
    it('groupByGranularity aggregates valid events and skips invalid/missing-date events without throwing', () => {
        const events = [
            { date: new Date('2026-05-04T10:00:00'), hours: 3 }, // valid
            { date: new Date('not-a-date'), hours: 5 },          // Invalid Date → must be skipped, not throw
            { date: null, hours: 2 },                            // missing date → skipped
        ];

        let result;
        expect(() => { result = groupByGranularity(events, 'day'); }).not.toThrow();

        // Only the single valid event is grouped, carrying its 3 hours; the bad-date events
        // contributed nothing and did not corrupt the total.
        expect(result.length).toBe(1);
        expect(result.reduce((sum, g) => sum + g.hours, 0)).toBe(3);
    });
});
