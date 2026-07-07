import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import CustomEvent from '../CustomEvent';

const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

const baseTimedEvent = {
    id: 'evt-1',
    title: 'אירוע',
    start: new Date(2026, 1, 15, 10, 0),
    end: new Date(2026, 1, 15, 11, 0),
    allDay: false,
    projectId: '1'
};

const fireTouchPointer = (el, type, x = 100, y = 100) => {
    fireEvent[type](el, { pointerType: 'touch', clientX: x, clientY: y, pointerId: 1 });
};

describe('CustomEvent long-press', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('קורא ל-onLongPress אחרי 500ms של לחיצה רציפה במובייל', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent event={baseTimedEvent} onLongPress={spy} isMobile />
        );
        const wrapper = container.firstChild;
        fireTouchPointer(wrapper, 'pointerDown');
        advance(500);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(baseTimedEvent, expect.objectContaining({ initialClientY: expect.any(Number) }));
    });

    it('מבטל את ה-long-press אם האצבע זזה יותר מ-8px לפני שעבר הזמן', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent event={baseTimedEvent} onLongPress={spy} isMobile />
        );
        const wrapper = container.firstChild;
        fireTouchPointer(wrapper, 'pointerDown', 100, 100);
        advance(200);
        fireTouchPointer(wrapper, 'pointerMove', 100, 120); // dy = 20px > 8px
        advance(400);
        expect(spy).not.toHaveBeenCalled();
    });

    it('מבטל את ה-long-press על pointerup לפני 500ms', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent event={baseTimedEvent} onLongPress={spy} isMobile />
        );
        const wrapper = container.firstChild;
        fireTouchPointer(wrapper, 'pointerDown');
        advance(200);
        fireTouchPointer(wrapper, 'pointerUp');
        advance(500);
        expect(spy).not.toHaveBeenCalled();
    });

    it('לא מפעיל long-press בדסקטופ (isMobile=false)', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent event={baseTimedEvent} onLongPress={spy} isMobile={false} />
        );
        const wrapper = container.firstChild;
        fireTouchPointer(wrapper, 'pointerDown');
        advance(600);
        expect(spy).not.toHaveBeenCalled();
    });

    it('לא מפעיל long-press לאירוע יומי (allDay)', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent
                event={{ ...baseTimedEvent, allDay: true }}
                onLongPress={spy}
                isMobile
            />
        );
        const wrapper = container.firstChild;
        fireTouchPointer(wrapper, 'pointerDown');
        advance(600);
        expect(spy).not.toHaveBeenCalled();
    });

    it('לא מפעיל long-press עבור קלט עכבר (pointerType=mouse)', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent event={baseTimedEvent} onLongPress={spy} isMobile />
        );
        const wrapper = container.firstChild;
        fireEvent.pointerDown(wrapper, { pointerType: 'mouse', clientX: 0, clientY: 0 });
        advance(600);
        expect(spy).not.toHaveBeenCalled();
    });

    it('מוסיף class .gc-event-pressing בזמן הלחיצה ומסיר אחרי הירי', () => {
        const spy = vi.fn();
        const { container } = render(
            <CustomEvent event={baseTimedEvent} onLongPress={spy} isMobile />
        );
        const wrapper = container.firstChild;
        fireTouchPointer(wrapper, 'pointerDown');
        // בזמן ההמתנה — ה-class פעיל
        expect(wrapper.className).toContain('gc-event-pressing');
        advance(500);
        // אחרי הירי — מוסר
        expect(wrapper.className).not.toContain('gc-event-pressing');
    });
});
