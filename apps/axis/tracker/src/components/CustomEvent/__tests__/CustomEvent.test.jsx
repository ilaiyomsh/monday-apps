import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CustomEvent from '../CustomEvent';

// אירוע שעתי בסיסי
const timedEvent = {
    title: 'פגישת צוות',
    start: new Date(2026, 1, 15, 10, 0),
    end: new Date(2026, 1, 15, 12, 0),
    allDay: false,
    projectId: '123'
};

// אירוע יומי (חופשה)
const allDayEvent = {
    title: 'חופשה',
    start: new Date(2026, 1, 15),
    end: new Date(2026, 1, 16),
    allDay: true,
    eventType: 'חופשה'
};

describe('CustomEvent', () => {

    // === רינדור בסיסי ===

    it('מציג את כותרת האירוע', () => {
        render(<CustomEvent event={timedEvent} />);
        expect(screen.getByText('פגישת צוות')).toBeInTheDocument();
    });

    it('מציג טווח שעות לאירוע שעתי', () => {
        render(<CustomEvent event={timedEvent} />);
        // RTL: end - start
        expect(screen.getByText('12:00 - 10:00')).toBeInTheDocument();
    });

    it('לא מציג שעות לאירוע יומי', () => {
        render(<CustomEvent event={allDayEvent} />);
        expect(screen.queryByText(/\d{2}:\d{2} - \d{2}:\d{2}/)).not.toBeInTheDocument();
    });

    // === הערות ===

    it('לא מציג הערות לאירוע שעתי', () => {
        render(<CustomEvent event={{ ...timedEvent, notes: 'הערה חשובה' }} />);
        expect(screen.queryByText('הערה חשובה')).not.toBeInTheDocument();
    });

    it('לא מציג הערות לאירוע יומי', () => {
        render(<CustomEvent event={{ ...allDayEvent, notes: 'הערה' }} />);
        expect(screen.queryByText('הערה')).not.toBeInTheDocument();
    });

    // === CSS Classes ===

    it('מוסיף class לאירוע יומי', () => {
        const { container } = render(<CustomEvent event={allDayEvent} />);
        expect(container.firstChild.className).toContain('gc-event-allday');
    });

    it('לא מוסיף class allDay לאירוע שעתי', () => {
        const { container } = render(<CustomEvent event={timedEvent} />);
        expect(container.firstChild.className).not.toContain('gc-event-allday');
    });

    it('מוסיף class לאירוע קצר (30 דקות או פחות)', () => {
        const shortEvent = {
            ...timedEvent,
            end: new Date(2026, 1, 15, 10, 30) // 30 דקות
        };
        const { container } = render(<CustomEvent event={shortEvent} />);
        expect(container.firstChild.className).toContain('gc-event-short');
    });

    it('לא מוסיף class short לאירוע ארוך', () => {
        const { container } = render(<CustomEvent event={timedEvent} />);
        expect(container.firstChild.className).not.toContain('gc-event-short');
    });

    it('מוסיף class לאירוע נבחר', () => {
        const { container } = render(
            <CustomEvent event={{ ...timedEvent, isSelected: true }} />
        );
        expect(container.firstChild.className).toContain('gc-event-selected');
    });

    it('מוסיף class לאירוע מתוכנן', () => {
        const { container } = render(
            <CustomEvent event={{ ...timedEvent, isTemporary: true }} />
        );
        expect(container.firstChild.className).toContain('gc-event-temporary');
    });

    it('מוסיף class לאירוע שנבחר לאישור', () => {
        const { container } = render(
            <CustomEvent event={{ ...timedEvent, isApprovalSelected: true }} />
        );
        expect(container.firstChild.className).toContain('gc-event-approval-selected');
    });

    // === סטטוס אישור ===

    it('מציג X אדום לאירוע שנדחה', () => {
        render(<CustomEvent event={{ ...timedEvent, isRejected: true }} />);
        expect(screen.getByText('✕')).toBeInTheDocument();
    });

    it('לא מציג X כשלא נדחה', () => {
        render(<CustomEvent event={timedEvent} />);
        expect(screen.queryByText('✕')).not.toBeInTheDocument();
    });

    it('מציג checkbox ריק במצב בחירה לאישור', () => {
        render(
            <CustomEvent event={{
                ...timedEvent,
                isInApprovalSelection: true,
                isApprovalSelected: false
            }} />
        );
        // ☐ = \u2610
        expect(screen.getByText('\u2610')).toBeInTheDocument();
    });

    it('מציג checkbox מסומן כשנבחר לאישור', () => {
        render(
            <CustomEvent event={{
                ...timedEvent,
                isInApprovalSelection: true,
                isApprovalSelected: true
            }} />
        );
        // ☑ = \u2611
        expect(screen.getByText('\u2611')).toBeInTheDocument();
    });

    it('לא מציג checkbox כשלא במצב בחירה', () => {
        render(<CustomEvent event={timedEvent} />);
        expect(screen.queryByText('\u2610')).not.toBeInTheDocument();
        expect(screen.queryByText('\u2611')).not.toBeInTheDocument();
    });

    // === סגנונות ===

    it('מחיל opacity חצי שקוף לאירוע ממתין', () => {
        const { container } = render(
            <CustomEvent event={{ ...timedEvent, isPending: true }} />
        );
        expect(container.firstChild.style.opacity).toBe('0.5');
    });

    it('מחיל opacity מלא לאירוע רגיל', () => {
        const { container } = render(
            <CustomEvent event={timedEvent} />
        );
        expect(container.firstChild.style.opacity).toBe('1');
    });

    it('מחיל רקע שקוף לאירוע מתוכנן', () => {
        const { container } = render(
            <CustomEvent event={{ ...timedEvent, isTemporary: true }} />
        );
        expect(container.firstChild.style.backgroundColor).toBe('transparent');
    });

    it('מחיל רקע צבעוני לאירוע רגיל', () => {
        const { container } = render(
            <CustomEvent event={timedEvent} />
        );
        // צבע מבוסס על projectId, צריך להיות hex
        expect(container.firstChild.style.backgroundColor).not.toBe('transparent');
        expect(container.firstChild.style.backgroundColor).toBeTruthy();
    });

    // === היעדרויות Day-off (W4.3) — רינדור מלא מול חלול לפי D2 ===

    // אירוע היעדרות רב-ימי מה-hook useDayOffAbsences (W4.1):
    // allDay תמיד, end בלעדי, צבע מתווית הסוג (eventTypeColor)
    const dayOffEvent = {
        id: 'dayoff_999',
        title: 'חופשה',
        start: new Date(2026, 1, 15),
        end: new Date(2026, 1, 18),
        allDay: true,
        isDayOff: true,
        readOnly: true,
        dayOffKind: 'personal',
        eventType: 'חופשה',
        eventTypeColor: '#ff642e',
        isPending: false,
        isApproved: false
    };

    it('מוסיף class gc-event-dayoff לאירוע היעדרות', () => {
        const { container } = render(<CustomEvent event={dayOffEvent} />);
        expect(container.firstChild.className).toContain('gc-event-dayoff');
        expect(container.firstChild.className).toContain('gc-event-allday');
    });

    it('לא מוסיף class dayoff לאירוע יומי רגיל', () => {
        const { container } = render(<CustomEvent event={allDayEvent} />);
        expect(container.firstChild.className).not.toContain('gc-event-dayoff');
    });

    it('היעדרות מאושרת (מדיניות אישור פעילה) מרונדרת מלאה', () => {
        const { container } = render(
            <CustomEvent event={{ ...dayOffEvent, isApproved: true }} />
        );
        const el = container.firstChild;
        expect(el.className).toContain('gc-event-dayoff');
        expect(el.className).not.toContain('gc-event-dayoff-pending');
        // רינדור מלא: רקע צבעוני (מתווית הסוג), שקיפות מלאה
        expect(el.style.backgroundColor).not.toBe('transparent');
        expect(el.style.backgroundColor).toBeTruthy();
        expect(el.style.opacity).toBe('1');
    });

    it('היעדרות ממתינה לאישור מרונדרת חלולה (hollow) ולא חצי-שקופה', () => {
        const { container } = render(
            <CustomEvent event={{ ...dayOffEvent, isPending: true }} />
        );
        const el = container.firstChild;
        expect(el.className).toContain('gc-event-dayoff-pending');
        // חלול: רקע שקוף, מסגרת + טקסט בצבע הסוג (דרך משתנה ה-CSS וה-inline style)
        expect(el.style.backgroundColor).toBe('transparent');
        expect(el.style.getPropertyValue('--event-color')).toBeTruthy();
        expect(el.style.borderColor).toBeTruthy();
        // הטקסט בצבע ההיעדרות (זהה למסגרת), לא לבן
        expect(el.style.color).toBe(el.style.borderColor);
        // ההיעדרות החלולה לא מקבלת את שקיפות ה-0.5 הגנרית של ממתין (W4.3, D2)
        expect(el.style.opacity).toBe('1');
    });

    it('כשמדיניות האישור כבויה (שני הדגלים כבויים) — רינדור מלא', () => {
        // כש-dayOffApprovalRequired כבוי ה-hook לא מסמן isPending/isApproved (D2 OFF)
        const { container } = render(<CustomEvent event={dayOffEvent} />);
        const el = container.firstChild;
        expect(el.className).toContain('gc-event-dayoff');
        expect(el.className).not.toContain('gc-event-dayoff-pending');
        expect(el.style.backgroundColor).not.toBe('transparent');
        expect(el.style.opacity).toBe('1');
    });

    it('אירוע יומי רגיל (לא day-off) ממתין עדיין מקבל opacity 0.5', () => {
        // נועל את הגבול: רק day-off פטור משקיפות הממתין הגנרית
        const { container } = render(
            <CustomEvent event={{ ...allDayEvent, isPending: true }} />
        );
        const el = container.firstChild;
        expect(el.style.opacity).toBe('0.5');
        expect(el.style.backgroundColor).not.toBe('transparent');
    });
});
