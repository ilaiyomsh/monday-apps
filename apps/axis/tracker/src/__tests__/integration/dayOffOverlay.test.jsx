/* global globalThis */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { mockBoardWithItems } from '../../test-utils/mondayMock';

/**
 * Integration — שכבת ההיעדרויות של Day-off ביומן (W4.2):
 * חיווט useDayOffAbsences ל-MondayCalendar + guards לקריאה-בלבד.
 *
 * מכסה: (1) ברירות מחדל = אפס שאילתות ללוח החופשות ואפס אירועי overlay
 * (כל ההתקנות הקיימות); (2) מיפוי מלא ⇒ האירועים נטענים כבר לחלון הראשוני
 * (בלי ניווט) וממוזגים ל-events של היומן כאירועי all-day רב-יומיים read-only;
 * (3) ניווט (onRangeChange) מפעיל שליפה חדשה עם גבולות החלון החדש;
 * (4) ה-guards: לחיצה על אירוע Day-off לא פותחת מודל (בעוד אירוע יומי רגיל
 * כן פותח — control), draggable/resizable accessors מחזירים false;
 * (5) showAbsences=false משאיר את השכבה כבויה גם עם מיפוי מלא.
 *
 * נתיב המימוש זהה ל-dragEvent.test.jsx: עוטפים את ה-DnD HOC בסטאב שלוכד את
 * ה-props החיים (events / onSelectEvent / accessors / onRangeChange) על
 * globalThis — כך מפעילים את אותם handlers שה-calendar היה מפעיל, בלי תלות
 * בסינתזת אירועי DOM שאינה זמינה ב-jsdom.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti מנסה לכתוב ל-canvas שלא קיים ב-jsdom — אותה הגנה כמו ב-2.1.1/2.1.3
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

// לכידת ה-props החיים של ה-Calendar (ראו הסבר בכותרת הקובץ)
vi.mock('react-big-calendar/lib/addons/dragAndDrop', () => ({
    default: (Calendar) => function DnDCalendarStub(props) {
        globalThis.__rbcDndProps = props;
        return React.createElement(Calendar, props);
    }
}));

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
    delete globalThis.__rbcDndProps;
});

// ---- מיפוי לוח החופשות (מפתחות W4.5; label IDs כמחרוזות — כמו MappingTab) ----
const DAY_OFF_BOARD_ID = '5005';
const DAYOFF_SETTINGS = {
    showAbsences: true,
    dayOffBoardId: DAY_OFF_BOARD_ID,
    dayOffPersonColumnId: 'person_col',
    dayOffStartDateColumnId: 'start_col',
    dayOffEndDateColumnId: 'end_col',
    dayOffKindColumnId: 'kind_col',
    dayOffKindGeneralLabelId: '1',
    dayOffKindPersonalLabelId: '2',
    dayOffTypeColumnId: 'type_col',
    dayOffApprovalColumnId: 'approval_col',
    dayOffApprovedLabelIds: ['10'],
    dayOffPendingLabelIds: ['11'],
    dayOffRejectedLabelIds: ['12'],
    dayOffApprovalRequired: false
};

// ---- פריטי לוח החופשות (החלון הראשוני: שבוע העבודה 2026-05-03..07) ----
// אישי: 3 ימים (5–7 במאי, כולל) — אירוע רב-יומי אחד עם end בלעדי 8 במאי
const personalDayOffItem = {
    id: '71',
    name: 'Tester - חופשה',
    column_values: [
        { id: 'person_col', text: 'Tester', value: null },
        { id: 'start_col', text: '2026-05-05', value: null, date: '2026-05-05' },
        { id: 'end_col', text: '2026-05-07', value: null, date: '2026-05-07' },
        { id: 'kind_col', text: 'אישי', value: null, index: 2, label: 'אישי' },
        { id: 'type_col', text: 'חופשה', value: null, index: 5, label: 'חופשה', label_style: { color: '#ff642e' } },
        { id: 'approval_col', text: '', value: null, index: null }
    ]
};
// כללי (יום חברה): שם הפריט הוא שדה החוזה (CONTRACT.md §4)
const generalDayOffItem = {
    id: '72',
    name: 'יום גיבוש',
    column_values: [
        { id: 'person_col', text: '', value: null },
        { id: 'start_col', text: '2026-05-06', value: null, date: '2026-05-06' },
        { id: 'end_col', text: '2026-05-06', value: null, date: '2026-05-06' },
        { id: 'kind_col', text: 'כללי', value: null, index: 1, label: 'כללי' },
        { id: 'type_col', text: '', value: null, index: null },
        { id: 'approval_col', text: '', value: null, index: null }
    ]
};

// ---- אירוע יומי רגיל בלוח הדיווחים (ה-control לבדיקת ה-guards) ----
const regularAllDayItem = {
    id: '888',
    name: 'חופשה - Tester',
    column_values: [
        { id: 'date', text: '2026-05-05', value: JSON.stringify({ date: '2026-05-05' }), date: '2026-05-05', time: null },
        { id: 'numbers', text: '1', value: '"1"' },
        { id: 'event_type', text: 'יומי', value: null, index: 2, label: 'יומי' },
        { id: 'all_day_type', text: 'חופשה', value: null, index: 0, label: 'חופשה', label_style: { color: '#33aaff' } },
        { id: 'reporter_people', text: 'Tester', value: JSON.stringify({ personsAndTeams: [{ id: 7, kind: 'person' }] }) }
    ]
};

// תגובת עמודת תת-סוג יומי — נדרשת ל-AllDayEventModal (תפריט הסוגים) ב-control
const allDayTypeColumnResponse = {
    data: {
        boards: [{
            id: '100',
            columns: [{
                id: 'all_day_type',
                type: 'status',
                settings: JSON.stringify({
                    labels: { 0: 'חופשה', 1: 'מחלה', 2: 'מילואים' },
                    labels_colors: {
                        0: { color: '#33aaff' },
                        1: { color: '#ff3333' },
                        2: { color: '#9933cc' }
                    }
                })
            }]
        }]
    }
};

const dayOffPage = (items) => ({ data: { boards: [{ items_page: { cursor: null, items } }] } });

/**
 * ראוטר שאילתות boards: לוח החופשות (לפי board id) קודם — שאילתת ה-person
 * מזוהה לפי assigned_to_me; אחר כך שאילתות עמודות (useColumnOptions);
 * השאר — לוח הדיווחים (100).
 */
const buildBoardsRouter = ({ dayOffItems = { personal: [], general: [] }, eventItems = [] } = {}) => {
    const eventsResponse = mockBoardWithItems({ boardId: 100, items: eventItems });
    return (query) => {
        if (typeof query !== 'string') return eventsResponse;
        if (query.includes(`[${DAY_OFF_BOARD_ID}]`)) {
            return query.includes('assigned_to_me')
                ? dayOffPage(dayOffItems.personal)
                : dayOffPage(dayOffItems.general);
        }
        if (query.includes('columns(ids:')) {
            if (query.includes('"all_day_type"')) return allDayTypeColumnResponse;
            return { data: { boards: [{ id: '100', columns: [] }] } };
        }
        return eventsResponse;
    };
};

/** שאילתות שנשלחו ללוח החופשות בלבד */
const dayOffQueries = (monday) =>
    monday.api.mock.calls.filter(([query]) =>
        typeof query === 'string' && query.includes(`[${DAY_OFF_BOARD_ID}]`));

describe('Integration — Day-off overlay wiring (W4.2)', () => {

    it('ברירות מחדל (ללא מיפוי) — אפס שאילתות ללוח חופשות ואפס אירועי overlay', async () => {
        const { monday } = await renderCalendar({
            apiResponsesByOp: { boards: buildBoardsRouter({ eventItems: [regularAllDayItem] }) }
        });

        // ממתינים שהאירועים הרגילים ייטענו — מוכיח שהאפליקציה חיה
        await waitFor(() => {
            const events = globalThis.__rbcDndProps?.events || [];
            if (!events.some(ev => ev.id === '888')) throw new Error('regular events not loaded yet');
        }, { timeout: 15000 });

        expect(dayOffQueries(monday)).toHaveLength(0);
        const events = globalThis.__rbcDndProps.events;
        expect(events.some(ev => ev.isDayOff)).toBe(false);
    }, 30000);

    it('מיפוי מלא — השכבה נטענת לחלון הראשוני וממוזגת ל-events כאירועים רב-יומיים read-only', async () => {
        await renderCalendar({
            settings: DAYOFF_SETTINGS,
            apiResponsesByOp: {
                boards: buildBoardsRouter({
                    dayOffItems: { personal: [personalDayOffItem], general: [generalDayOffItem] },
                    eventItems: [regularAllDayItem]
                })
            }
        });

        // נטען כבר לחלון הראשוני — בלי שום ניווט (onRangeChange לא נורה ב-mount)
        await waitFor(() => {
            const events = globalThis.__rbcDndProps?.events || [];
            if (!events.some(ev => ev.id === 'dayoff_71')) throw new Error('day-off overlay not merged yet');
        }, { timeout: 15000 });

        const events = globalThis.__rbcDndProps.events;
        const personal = events.find(ev => ev.id === 'dayoff_71');
        const general = events.find(ev => ev.id === 'dayoff_72');
        const regular = events.find(ev => ev.id === '888');

        // אישי: אירוע רב-יומי אחד (5–7 במאי), end בלעדי 8 במאי, read-only
        expect(personal).toBeTruthy();
        expect(personal.allDay).toBe(true);
        expect(personal.isDayOff).toBe(true);
        expect(personal.readOnly).toBe(true);
        expect(personal.title).toBe('חופשה');
        expect([personal.start.getFullYear(), personal.start.getMonth(), personal.start.getDate()]).toEqual([2026, 4, 5]);
        expect([personal.end.getFullYear(), personal.end.getMonth(), personal.end.getDate()]).toEqual([2026, 4, 8]);

        // כללי: שם הפריט הוא הכותרת (CONTRACT.md §4)
        expect(general).toBeTruthy();
        expect(general.title).toBe('יום גיבוש');
        expect(general.dayOffKind).toBe('general');

        // האירוע הרגיל נשאר לצד ה-overlay (מיזוג, לא החלפה)
        expect(regular).toBeTruthy();
        expect(regular.isDayOff).toBeFalsy();
    }, 30000);

    it('ניווט (onRangeChange) מפעיל שליפה חדשה ללוח החופשות עם גבולות החלון החדש', async () => {
        const { monday } = await renderCalendar({
            settings: DAYOFF_SETTINGS,
            apiResponsesByOp: {
                boards: buildBoardsRouter({
                    dayOffItems: { personal: [personalDayOffItem], general: [generalDayOffItem] }
                })
            }
        });

        await waitFor(() => {
            const events = globalThis.__rbcDndProps?.events || [];
            if (!events.some(ev => ev.id === 'dayoff_71')) throw new Error('initial overlay not loaded yet');
        }, { timeout: 15000 });

        const callsBefore = dayOffQueries(monday).length;
        expect(callsBefore).toBeGreaterThanOrEqual(2); // שאילתת person + שאילתת general לחלון הראשוני

        // ניווט לשבוע הבא — onRangeChange בצורת מערך (תצוגת שבוע)
        const nextWeek = [
            new Date(2026, 4, 10),
            new Date(2026, 4, 11),
            new Date(2026, 4, 12),
            new Date(2026, 4, 13),
            new Date(2026, 4, 14)
        ];
        await act(async () => {
            globalThis.__rbcDndProps.onRangeChange(nextWeek);
        });

        await waitFor(() => {
            const newCalls = dayOffQueries(monday).slice(callsBefore);
            if (newCalls.length < 2) throw new Error('range-change day-off queries not fired yet');
        }, { timeout: 15000 });

        const newCalls = dayOffQueries(monday).slice(callsBefore);
        // שתי השאילתות (person + general) נורות עם סוף החלון החדש בחוק התאריך
        expect(newCalls.length).toBeGreaterThanOrEqual(2);
        for (const [query] of newCalls) {
            expect(query).toContain('2026-05-14');
        }
        expect(newCalls.some(([query]) => query.includes('assigned_to_me'))).toBe(true);
    }, 30000);

    it('guards: לחיצה על אירוע Day-off לא פותחת מודל (control: אירוע יומי רגיל כן), וגרירה/resize חסומים', async () => {
        await renderCalendar({
            settings: DAYOFF_SETTINGS,
            apiResponsesByOp: {
                boards: buildBoardsRouter({
                    dayOffItems: { personal: [personalDayOffItem], general: [generalDayOffItem] },
                    eventItems: [regularAllDayItem]
                })
            }
        });

        await waitFor(() => {
            const events = globalThis.__rbcDndProps?.events || [];
            if (!events.some(ev => ev.id === 'dayoff_71') || !events.some(ev => ev.id === '888')) {
                throw new Error('events not loaded yet');
            }
        }, { timeout: 15000 });

        const { events, onSelectEvent, draggableAccessor, resizableAccessor } = globalThis.__rbcDndProps;
        const dayOffEvent = events.find(ev => ev.id === 'dayoff_71');
        const regularEvent = events.find(ev => ev.id === '888');

        // drag/resize accessors — false לאירוע Day-off, true לאירוע רגיל (parity עם חגים)
        expect(draggableAccessor(dayOffEvent)).toBe(false);
        expect(resizableAccessor(dayOffEvent)).toBe(false);
        expect(draggableAccessor(regularEvent)).toBe(true);
        expect(resizableAccessor(regularEvent)).toBe(true);

        // לחיצה על אירוע Day-off — לא נפתח שום מודל ('מילואים' מופיע רק בתפריט
        // הסוגים של AllDayEventModal; ממתינים מספיק זמן שגם lazy chunk היה נטען)
        await act(async () => {
            onSelectEvent(dayOffEvent);
            await new Promise(resolve => setTimeout(resolve, 400));
        });
        expect(screen.queryByRole('button', { name: 'מילואים' })).toBeNull();

        // control: לחיצה על אירוע יומי רגיל פותחת את AllDayEventModal — מוכיח
        // שהסביבה מסוגלת לפתוח את המודל, ולכן ההיעדרות נחסמה ע"י ה-guard
        await act(async () => {
            onSelectEvent(regularEvent);
        });
        const menuButton = await screen.findByRole('button', { name: 'מילואים' }, { timeout: 10000 });
        expect(menuButton).toBeTruthy();
    }, 40000);

    it('showAbsences=false — השכבה כבויה גם עם מיפוי מלא (אפס שאילתות, אפס אירועים)', async () => {
        const { monday } = await renderCalendar({
            settings: { ...DAYOFF_SETTINGS, showAbsences: false },
            apiResponsesByOp: {
                boards: buildBoardsRouter({
                    dayOffItems: { personal: [personalDayOffItem], general: [generalDayOffItem] },
                    eventItems: [regularAllDayItem]
                })
            }
        });

        await waitFor(() => {
            const events = globalThis.__rbcDndProps?.events || [];
            if (!events.some(ev => ev.id === '888')) throw new Error('regular events not loaded yet');
        }, { timeout: 15000 });

        expect(dayOffQueries(monday)).toHaveLength(0);
        expect(globalThis.__rbcDndProps.events.some(ev => ev.isDayOff)).toBe(false);
    }, 30000);
});
