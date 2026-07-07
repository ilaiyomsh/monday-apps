import { describe, it, expect } from 'vitest';
import { buildDateFilterRule, getEffectiveDateRange, formatPeriodLabel } from '../dateFilterUtils';

/**
 * Contract tests for the dashboard date-filter helpers.
 *
 * These feed user-triggered dashboard queries and labels. The desired contract —
 * independent of the implementation — is:
 *   • valid anchor → the correct period range / label;
 *   • a malformed dateFrom must NOT throw a RangeError (date-fns format on an Invalid
 *     Date), it must degrade to a safe fallback so a user keystroke can't crash the view.
 * Expected values for valid cases are computed from the calendar spec, not read off the code.
 */
describe('dateFilterUtils — malformed input degrades safely', () => {
    describe('buildDateFilterRule', () => {
        it('valid month anchor → start/end of that month', () => {
            const rule = buildDateFilterRule('month', 'date_col', '2026-05-15', '');
            expect(rule.column_id).toBe('date_col');
            expect(rule.operator).toBe('between');
            expect(rule.compare_value).toEqual(['2026-05-01', '2026-05-31']);
        });

        it('malformed dateFrom never throws and returns the between-fallback', () => {
            expect(() => buildDateFilterRule('month', 'date_col', 'not-a-date', 'x')).not.toThrow();
            expect(buildDateFilterRule('month', 'date_col', 'not-a-date', 'x')).toEqual({
                column_id: 'date_col',
                compare_value: ['not-a-date', 'x'],
                operator: 'between',
            });
        });

        it('week/year with a garbage anchor do not throw', () => {
            expect(() => buildDateFilterRule('week', 'c', 'garbage')).not.toThrow();
            expect(() => buildDateFilterRule('year', 'c', '')).not.toThrow();
        });
    });

    describe('getEffectiveDateRange', () => {
        it('valid month anchor → the month range', () => {
            expect(getEffectiveDateRange('month', '2026-05-15', '')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
        });

        it('malformed dateFrom → fallback range, no throw', () => {
            expect(() => getEffectiveDateRange('week', 'nope', 'y')).not.toThrow();
            expect(getEffectiveDateRange('week', 'nope', 'y')).toEqual({ from: 'nope', to: 'y' });
        });
    });

    describe('formatPeriodLabel', () => {
        it('valid Date → a non-empty label', () => {
            expect(formatPeriodLabel('month', new Date('2026-05-15T00:00:00'))).not.toBe('');
        });

        it('Invalid Date → empty string, never a RangeError', () => {
            expect(() => formatPeriodLabel('month', new Date('not-a-date'))).not.toThrow();
            expect(formatPeriodLabel('month', new Date('not-a-date'))).toBe('');
            expect(formatPeriodLabel('week', null)).toBe('');
        });
    });
});
