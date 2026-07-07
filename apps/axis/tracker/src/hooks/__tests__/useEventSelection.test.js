import { describe, it, expect} from 'vitest';
import { renderHook, act } from '@testing-library/react';


import { useEventSelection } from '../useEventSelection';

describe('useEventSelection', () => {

    // === State התחלתי ===

    it('מתחיל עם מצב בחירה כבוי ו-Set ריק', () => {
        const { result } = renderHook(() => useEventSelection());
        expect(result.current.isSelectionMode).toBe(false);
        expect(result.current.selectedCount).toBe(0);
    });

    // === מצב בחירה ===

    it('toggleSelectionMode מפעיל מצב בחירה', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelectionMode();
        });

        expect(result.current.isSelectionMode).toBe(true);
    });

    it('toggle שנית מכבה ומנקה בחירות', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelectionMode(); // הפעלה
        });

        act(() => {
            result.current.toggleSelection('evt-1');
        });

        expect(result.current.selectedCount).toBe(1);

        act(() => {
            result.current.toggleSelectionMode(); // כיבוי
        });

        expect(result.current.isSelectionMode).toBe(false);
        expect(result.current.selectedCount).toBe(0);
    });

    // === בחירת אירועים ===

    it('toggleSelection מוסיף אירוע ל-Set', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelection('evt-1');
        });

        expect(result.current.selectedCount).toBe(1);
        expect(result.current.isSelected('evt-1')).toBe(true);
    });

    it('toggleSelection על אותו ID מסיר אותו', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelection('evt-1');
        });

        act(() => {
            result.current.toggleSelection('evt-1');
        });

        expect(result.current.selectedCount).toBe(0);
        expect(result.current.isSelected('evt-1')).toBe(false);
    });

    it('בחירת כמה אירועים מצטברת', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelection('evt-1');
        });

        act(() => {
            result.current.toggleSelection('evt-2');
        });

        act(() => {
            result.current.toggleSelection('evt-3');
        });

        expect(result.current.selectedCount).toBe(3);
        expect(result.current.isSelected('evt-1')).toBe(true);
        expect(result.current.isSelected('evt-2')).toBe(true);
        expect(result.current.isSelected('evt-3')).toBe(true);
    });

    // === isSelected ===

    it('isSelected מחזיר false ל-ID שלא נבחר', () => {
        const { result } = renderHook(() => useEventSelection());
        expect(result.current.isSelected('nonexistent')).toBe(false);
    });

    // === getSelectedArray ===

    it('getSelectedArray מחזיר מערך ריק כשאין בחירה', () => {
        const { result } = renderHook(() => useEventSelection());
        expect(result.current.getSelectedArray()).toEqual([]);
    });

    it('getSelectedArray ממיר Set למערך', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelection('evt-1');
            result.current.toggleSelection('evt-2');
        });

        const arr = result.current.getSelectedArray();
        expect(arr).toHaveLength(2);
        expect(arr).toContain('evt-1');
        expect(arr).toContain('evt-2');
    });

    // === clearSelection ===

    it('clearSelection מנקה הכל ומכבה מצב בחירה', () => {
        const { result } = renderHook(() => useEventSelection());

        act(() => {
            result.current.toggleSelectionMode();
            result.current.toggleSelection('evt-1');
        });

        act(() => {
            result.current.clearSelection();
        });

        expect(result.current.selectedCount).toBe(0);
        expect(result.current.isSelectionMode).toBe(false);
    });
});
