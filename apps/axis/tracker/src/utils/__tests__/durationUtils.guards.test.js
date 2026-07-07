import { describe, it, expect } from 'vitest';
import { calculateDaysDiff, calculateEndDateFromDays, formatDurationForSave } from '../durationUtils';

/**
 * Contract tests for the duration helpers' invalid-input behavior.
 *
 * These functions feed Monday WRITE payloads (numbers column, all-day end dates). The
 * desired contract — independent of how it's implemented — is:
 *   • valid input → computed correctly;
 *   • invalid input → NEVER throws and NEVER emits NaN/garbage into a write
 *     (a NaN written to Monday silently corrupts the record).
 * Expected values for the valid cases are derived from the spec, not read off the code.
 */
describe('durationUtils — write-path safety on invalid input', () => {
    describe('formatDurationForSave', () => {
        it('valid hours format to two decimals', () => {
            expect(formatDurationForSave(2.5, 'שעתי')).toBe('2.50');
            expect(formatDurationForSave(0, 'שעתי')).toBe('0.00');
        });

        it('never writes the literal "NaN" for non-numeric input', () => {
            expect(formatDurationForSave('abc', 'שעתי')).not.toContain('NaN');
            expect(formatDurationForSave(undefined, 'שעתי')).not.toContain('NaN');
            expect(formatDurationForSave(NaN, 'שעתי')).not.toContain('NaN');
        });

        it('does not throw on object/garbage input', () => {
            expect(() => formatDurationForSave({}, 'שעתי')).not.toThrow();
        });
    });

    describe('calculateDaysDiff', () => {
        it('valid range → ceil-ed day count', () => {
            const a = new Date('2026-05-01T00:00:00');
            const b = new Date('2026-05-04T00:00:00');
            expect(calculateDaysDiff(a, b)).toBe(3);
        });

        it('invalid dates → safe minimum of 1 day, no NaN, no throw', () => {
            expect(() => calculateDaysDiff(null, null)).not.toThrow();
            expect(calculateDaysDiff(null, null)).toBe(1);
            expect(calculateDaysDiff(new Date('not-a-date'), new Date('2026-05-04T00:00:00'))).toBe(1);
        });
    });

    describe('calculateEndDateFromDays', () => {
        it('valid start → exclusive end N days later at local midnight', () => {
            const start = new Date('2026-05-01T09:30:00');
            const end = calculateEndDateFromDays(start, 3);
            expect(end.getDate()).toBe(4);
            expect(end.getHours()).toBe(0);
        });

        it('invalid start → Invalid Date sentinel (caught downstream by the write formatters), no throw', () => {
            expect(() => calculateEndDateFromDays(null, 2)).not.toThrow();
            const end = calculateEndDateFromDays(new Date('not-a-date'), 2);
            expect(Number.isNaN(end.getTime())).toBe(true);
        });
    });
});
