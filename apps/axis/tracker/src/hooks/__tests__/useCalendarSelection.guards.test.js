/**
 * useCalendarSelection — guards של תפריט ההקשר (W4.2):
 * אירועי Day-off (isDayOff) הם read-only — תפריט לחיצה ימנית לא נפתח עבורם,
 * במקביל ל-guard הקיים של אירועים בטעינה (isLoading).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCalendarSelection } from '../useCalendarSelection';

const buildHook = () => renderHook(() => useCalendarSelection({
    events: [],
    createEvent: vi.fn(),
    removeEventsFromState: vi.fn(() => []),
    undoDelete: { scheduleDelete: vi.fn() },
    monthlyHours: { refetch: vi.fn() },
    showSuccess: vi.fn(),
    showErrorWithDetails: vi.fn(),
    t: (key) => key
}));

const fakeMouseEvent = () => ({ preventDefault: vi.fn(), clientX: 11, clientY: 22 });

describe('useCalendarSelection — context-menu guards (W4.2)', () => {

    it('אירוע רגיל — התפריט נפתח', () => {
        const { result } = buildHook();
        act(() => {
            result.current.handlers.handleEventContextMenu(fakeMouseEvent(), { id: '1', title: 'רגיל' });
        });
        expect(result.current.contextMenu.isOpen).toBe(true);
        expect(result.current.contextMenu.event.id).toBe('1');
    });

    it('היעדרות Day-off (isDayOff) — התפריט לא נפתח (guard מקביל, W4.2)', () => {
        const { result } = buildHook();
        act(() => {
            result.current.handlers.handleEventContextMenu(fakeMouseEvent(), { id: 'dayoff_71', isDayOff: true, readOnly: true });
        });
        expect(result.current.contextMenu.isOpen).toBe(false);
    });

    it('אירוע בטעינה (isLoading) — התפריט לא נפתח', () => {
        const { result } = buildHook();
        act(() => {
            result.current.handlers.handleEventContextMenu(fakeMouseEvent(), { id: 'l1', isLoading: true });
        });
        expect(result.current.contextMenu.isOpen).toBe(false);
    });
});
