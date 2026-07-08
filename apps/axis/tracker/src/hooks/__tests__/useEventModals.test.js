import { describe, it, expect} from 'vitest';
import { renderHook, act } from '@testing-library/react';


import { useEventModals } from '../useEventModals';

const mockSlot = {
    start: new Date(2026, 1, 15, 10, 0),
    end: new Date(2026, 1, 15, 12, 0)
};

const mockEvent = {
    id: 'evt-1',
    title: 'פגישה',
    start: new Date(2026, 1, 15, 10, 0),
    end: new Date(2026, 1, 15, 12, 0),
    notes: 'הערה קיימת'
};

const mockTemporaryEvent = {
    id: 'evt-tmp-1',
    title: 'אירוע מתוכנן',
    start: new Date(2026, 1, 15, 14, 0),
    end: new Date(2026, 1, 15, 16, 0),
    notes: '',
    isTemporary: true
};

describe('useEventModals', () => {

    // === State התחלתי ===

    it('מתחיל עם הכל סגור וריק', () => {
        const { result } = renderHook(() => useEventModals());
        expect(result.current.eventModal.isOpen).toBe(false);
        expect(result.current.eventModal.pendingSlot).toBeNull();
        expect(result.current.eventModal.eventToEdit).toBeNull();
        expect(result.current.eventModal.isEditMode).toBe(false);
        expect(result.current.eventModal.isConvertMode).toBe(false);
        expect(result.current.allDayModal.isOpen).toBe(false);
        expect(result.current.allDayModal.date).toBeNull();
    });

    // === פתיחת מודל רגיל ===

    it('openEventModal פותח מודל עם slot ומנקה עריכה', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModal(mockSlot);
        });

        expect(result.current.eventModal.isOpen).toBe(true);
        expect(result.current.eventModal.pendingSlot).toEqual(mockSlot);
        expect(result.current.eventModal.isEditMode).toBe(false);
        expect(result.current.eventModal.eventToEdit).toBeNull();
    });

    // === פתיחת מודל יומי ===

    it('openAllDayModal פותח מודל יומי עם תאריך', () => {
        const { result } = renderHook(() => useEventModals());
        const date = new Date(2026, 1, 15);

        act(() => {
            result.current.openAllDayModal(date);
        });

        expect(result.current.allDayModal.isOpen).toBe(true);
        expect(result.current.allDayModal.date).toEqual(date);
        expect(result.current.allDayModal.isEditMode).toBe(false);
        expect(result.current.allDayModal.eventToEdit).toBeNull();
    });

    // === מצב עריכה ===

    it('openEventModalForEdit מגדיר isEditMode=true ואת האירוע', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModalForEdit(mockEvent);
        });

        expect(result.current.eventModal.isOpen).toBe(true);
        expect(result.current.eventModal.isEditMode).toBe(true);
        expect(result.current.eventModal.eventToEdit).toEqual(mockEvent);
        expect(result.current.eventModal.pendingSlot).toEqual({
            start: mockEvent.start,
            end: mockEvent.end
        });
        expect(result.current.eventModal.newEventTitle).toBe('פגישה');
    });

    it('openAllDayModalForEdit מגדיר isEditMode ותאריך', () => {
        const { result } = renderHook(() => useEventModals());
        const allDayEvent = { ...mockEvent, start: new Date(2026, 1, 15) };

        act(() => {
            result.current.openAllDayModalForEdit(allDayEvent);
        });

        expect(result.current.allDayModal.isOpen).toBe(true);
        expect(result.current.allDayModal.isEditMode).toBe(true);
        expect(result.current.allDayModal.eventToEdit).toEqual(allDayEvent);
        expect(result.current.allDayModal.date).toEqual(allDayEvent.start);
    });

    // === מצב המרה (convert) ===

    it('openEventModalForConvert מגדיר isConvertMode ומנקה כותרת', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModalForConvert(mockTemporaryEvent);
        });

        expect(result.current.eventModal.isOpen).toBe(true);
        expect(result.current.eventModal.isConvertMode).toBe(true);
        expect(result.current.eventModal.isEditMode).toBe(true);
        expect(result.current.eventModal.newEventTitle).toBe('');
    });

    it('convert שומר כותרת מקורית בהערות', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModalForConvert(mockTemporaryEvent);
        });

        const editEvent = result.current.eventModal.eventToEdit;
        expect(editEvent.notes).toContain('אירוע מקורי: אירוע מתוכנן');
        expect(editEvent.originalTitle).toBe('אירוע מתוכנן');
    });

    it('convert עם הערות קיימות משלב כותרת + הערות', () => {
        const { result } = renderHook(() => useEventModals());
        const eventWithNotes = { ...mockTemporaryEvent, notes: 'הערה ישנה' };

        act(() => {
            result.current.openEventModalForConvert(eventWithNotes);
        });

        const editEvent = result.current.eventModal.eventToEdit;
        expect(editEvent.notes).toBe('אירוע מקורי: אירוע מתוכנן\n\nהערה ישנה');
    });

    it('convert נועל את הזמנים (pendingSlot)', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModalForConvert(mockTemporaryEvent);
        });

        expect(result.current.eventModal.pendingSlot).toEqual({
            start: mockTemporaryEvent.start,
            end: mockTemporaryEvent.end
        });
    });

    // === סגירת מודלים ===

    it('closeEventModal סוגר רק מודל רגיל, לא יומי', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModal(mockSlot);
            result.current.openAllDayModal(new Date());
        });

        act(() => {
            result.current.closeEventModal();
        });

        expect(result.current.eventModal.isOpen).toBe(false);
        expect(result.current.allDayModal.isOpen).toBe(true); // עדיין פתוח
    });

    it('closeAllDayModal סוגר רק מודל יומי, לא רגיל', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModal(mockSlot);
            result.current.openAllDayModal(new Date());
        });

        act(() => {
            result.current.closeAllDayModal();
        });

        expect(result.current.allDayModal.isOpen).toBe(false);
        expect(result.current.eventModal.isOpen).toBe(true); // עדיין פתוח
    });

    it('closeAllModals סוגר הכל ומנקה state', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModalForEdit(mockEvent);
            result.current.openAllDayModal(new Date());
        });

        act(() => {
            result.current.closeAllModals();
        });

        expect(result.current.eventModal.isOpen).toBe(false);
        expect(result.current.eventModal.pendingSlot).toBeNull();
        expect(result.current.eventModal.eventToEdit).toBeNull();
        expect(result.current.eventModal.isEditMode).toBe(false);
        expect(result.current.eventModal.isConvertMode).toBe(false);
        expect(result.current.eventModal.newEventTitle).toBe('');
        expect(result.current.eventModal.selectedItem).toBeNull();
        expect(result.current.allDayModal.isOpen).toBe(false);
        expect(result.current.allDayModal.date).toBeNull();
        expect(result.current.allDayModal.eventToEdit).toBeNull();
        expect(result.current.allDayModal.isEditMode).toBe(false);
    });

    it('closeEventModal מנקה isConvertMode', () => {
        const { result } = renderHook(() => useEventModals());

        act(() => {
            result.current.openEventModalForConvert(mockTemporaryEvent);
        });

        expect(result.current.eventModal.isConvertMode).toBe(true);

        act(() => {
            result.current.closeEventModal();
        });

        expect(result.current.eventModal.isConvertMode).toBe(false);
    });
});
