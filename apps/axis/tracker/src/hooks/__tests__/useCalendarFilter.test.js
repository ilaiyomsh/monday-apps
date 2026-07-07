import { describe, it, expect} from 'vitest';
import { renderHook, act } from '@testing-library/react';


import { useCalendarFilter } from '../useCalendarFilter';

const mockSettings = {
    reporterColumnId: 'person_col',
    projectColumnId: 'connect_col'
};

const mockContext = { boardId: '123' };

describe('useCalendarFilter', () => {

    // === State התחלתי ===

    it('מתחיל עם מערכים ריקים ולא פעיל', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));
        expect(result.current.selectedReporterIds).toEqual([]);
        expect(result.current.selectedProjectIds).toEqual([]);
        expect(result.current.hasActiveFilter).toBe(false);
        expect(result.current.filterRules).toEqual([]);
    });

    // === בחירת מדווחים ===

    it('בוחר מדווחים ומייצר filter rule עם פורמט person-{id}', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));

        act(() => {
            result.current.setSelectedReporterIds([42, 55]);
        });

        expect(result.current.filterRules).toHaveLength(1);
        expect(result.current.filterRules[0]).toEqual({
            column_id: 'person_col',
            compare_value: ['person-42', 'person-55'],
            operator: 'any_of'
        });
    });

    it('hasActiveFilter = true כשיש מדווחים נבחרים', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));

        act(() => {
            result.current.setSelectedReporterIds([1]);
        });

        expect(result.current.hasActiveFilter).toBe(true);
    });

    // === בחירת פרויקטים ===

    it('בוחר פרויקטים ומייצר filter rule עם מספרים שלמים', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));

        act(() => {
            result.current.setSelectedProjectIds(['100', '200']);
        });

        expect(result.current.filterRules).toHaveLength(1);
        expect(result.current.filterRules[0]).toEqual({
            column_id: 'connect_col',
            compare_value: [100, 200],
            operator: 'any_of'
        });
    });

    // === שילוב שני פילטרים ===

    it('שני פילטרים יחד מייצרים 2 חוקים', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));

        act(() => {
            result.current.setSelectedReporterIds([1]);
            result.current.setSelectedProjectIds(['100']);
        });

        expect(result.current.filterRules).toHaveLength(2);
        expect(result.current.filterRules[0].column_id).toBe('person_col');
        expect(result.current.filterRules[1].column_id).toBe('connect_col');
    });

    // === ניקוי ===

    it('clearFilters מנקה את כל הפילטרים', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));

        act(() => {
            result.current.setSelectedReporterIds([1, 2]);
            result.current.setSelectedProjectIds(['100']);
        });

        expect(result.current.hasActiveFilter).toBe(true);

        act(() => {
            result.current.clearFilters();
        });

        expect(result.current.selectedReporterIds).toEqual([]);
        expect(result.current.selectedProjectIds).toEqual([]);
        expect(result.current.hasActiveFilter).toBe(false);
        expect(result.current.filterRules).toEqual([]);
    });

    it('resetToDefaults מנקה פילטרים', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));

        act(() => {
            result.current.setSelectedReporterIds([1]);
        });

        act(() => {
            result.current.resetToDefaults();
        });

        expect(result.current.selectedReporterIds).toEqual([]);
        expect(result.current.hasActiveFilter).toBe(false);
    });

    // === Edge cases ===

    it('לא מייצר rule כשאין reporterColumnId בהגדרות', () => {
        const { result } = renderHook(() =>
            useCalendarFilter({}, mockContext)
        );

        act(() => {
            result.current.setSelectedReporterIds([1]);
        });

        expect(result.current.filterRules).toEqual([]);
    });

    it('לא מייצר rule כשאין projectColumnId בהגדרות', () => {
        const { result } = renderHook(() =>
            useCalendarFilter({}, mockContext)
        );

        act(() => {
            result.current.setSelectedProjectIds(['100']);
        });

        expect(result.current.filterRules).toEqual([]);
    });

    it('לא קורס עם settings null', () => {
        const { result } = renderHook(() => useCalendarFilter(null, mockContext));
        expect(result.current.filterRules).toEqual([]);
        expect(result.current.hasActiveFilter).toBe(false);
    });

    it('isInitialized מתחיל כ-false ומשתנה אחרי settings', () => {
        const { result } = renderHook(() => useCalendarFilter(mockSettings, mockContext));
        // לאחר render עם settings, צריך להתאתחל
        expect(result.current.isInitialized).toBe(true);
    });
});
