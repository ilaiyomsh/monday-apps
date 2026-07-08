/* global globalThis */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { act } from 'react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';

/**
 * Integration test 2.1.3 — flow גרירת אירוע שעתי לזמן חדש end-to-end:
 *   אירוע שעתי קיים נטען ל-state → onEventDrop נקרא עם start/end חדשים →
 *   updateEventPosition שולח change_multiple_column_values עם date + duration.
 *
 * נתיב מימוש: jsdom לא מסנתז אירועי Drag-and-Drop של HTML5 שב-react-big-calendar
 * ה-addon מסתמך עליהם (mousedown/mousemove/mouseup דרכי Selection class שדורשת
 * getBoundingClientRect לא-אפסיים). במקום לרדוף אחר אירועי DOM, אנחנו עוטפים
 * את `withDragAndDrop` HOC בפסטרו-פאסטרו שלוכד את ה-props (`events`, `onEventDrop`)
 * על globalThis ומעביר אותם ל-Calendar הרגיל. זה מוודא שהקריאה החיה ל-onEventDrop
 * מ-rbc תפעיל את אותה שרשרת handlers (useCalendarHandlers.onEventDrop →
 * useMondayEvents.updateEventPosition → updateItemColumnValues), בלי תלות
 * בשכבת ה-DnD שאינה ניתנת לסינתזה תחת jsdom. ה-spec של 2.1.3 מאפשר במפורש
 * את הנתיב הזה ("fall back to invoking onEventDrop directly via the Calendar instance").
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti מנסה לכתוב ל-canvas שלא קיים ב-jsdom — אותה הגנה כמו ב-2.1.1/2.1.2.
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

// עוקפים את ה-DnD HOC: מחזירים פונקציה שלוקחת את ה-Calendar המקורי וגוטוטה אותו
// כל-יודע. ה-props נשמרים על globalThis כדי שהטסט יוכל להפעיל onEventDrop ישירות.
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

describe('Integration — drag event to new time (2.1.3)', () => {
    it('onEventDrop משלח change_multiple_column_values עם date + duration חדשים', async () => {
        // אירוע קיים: 2026-05-06 07:00 → 08:00 (שעה אחת, billable).
        // שדה date/time מוחזר כמחרוזת מקומית (לא UTC) כי mapItemToEvent בונה
        // Date דרך `new Date(year, month-1, day, h, m, s)` (local).
        const seededItem = {
            id: '999',
            name: 'Existing timed event',
            column_values: [
                {
                    id: 'date',
                    date: '2026-05-06',
                    time: '07:00:00',
                    value: JSON.stringify({ date: '2026-05-06', time: '07:00:00' }),
                    text: '2026-05-06 07:00:00'
                },
                {
                    id: 'numbers',
                    value: '"1.00"',
                    text: '1.00'
                },
                {
                    id: 'event_type',
                    index: 0,
                    label: 'שעתי',
                    text: 'שעתי',
                    value: JSON.stringify({ index: 0 }),
                    label_style: { color: '#00ff00' }
                },
                {
                    id: 'project_link',
                    text: 'Acme Project',
                    value: JSON.stringify({ linkedPulseIds: [{ linkedPulseId: 11 }] }),
                    linked_items: [{ id: '11', name: 'Acme Project' }]
                }
            ]
        };

        const eventsResponse = mockBoardWithItems({ boardId: 100, items: [seededItem] });
        const projectsResponse = mockProjectsResponse({ boardId: 200, projects: [] });

        const { monday } = await renderCalendar({
            apiResponsesByOp: {
                // אותו op-name "boards" משרת גם projects וגם events; דיספאצ' לפי תוכן.
                boards: (query) => {
                    // useMondayEvents.loadEvents מזהה לפי `query_params` (החוק assigned_to_me
                    // הדיפולטיבי שמגיע מ-buildAllRules גורם גם ל-events query להכיל
                    // `assigned_to_me`, ולכן לא מספיק להבדיל לפי המחרוזת הזו לבד).
                    if (typeof query === 'string' && query.includes('query_params')) {
                        return eventsResponse;
                    }
                    if (typeof query === 'string' && query.includes('assigned_to_me')) {
                        return projectsResponse;
                    }
                    return eventsResponse;
                }
            }
        });

        const capture = createApiPayloadCapture(monday);

        // ממתינים שה-DnD HOC ייקלוט את ה-props ו-events יוזרם פנימה (אחרי loadEvents).
        await waitFor(() => {
            const props = globalThis.__rbcDndProps;
            expect(props).toBeTruthy();
            expect(Array.isArray(props.events)).toBe(true);
            expect(props.events.length).toBeGreaterThan(0);
        }, { timeout: 10000 });

        const props = globalThis.__rbcDndProps;
        const event = props.events.find(e => e.mondayItemId === '999');
        expect(event).toBeDefined();
        expect(event.allDay).toBe(false);

        // יעד הגרירה: 2026-05-06 09:00 → 11:00 (משך חדש: שעתיים, עדיין בעבר
        // ביחס ל-now הקבוע ב-2026-05-07T09:00). מבטיח שאין trip ל-future-guard.
        const newStart = new Date(2026, 4, 6, 9, 0, 0);
        const newEnd = new Date(2026, 4, 6, 11, 0, 0);

        // הקריאה הישירה ל-prop היא בדיוק מה ש-react-big-calendar עושה אחרי גרירה
        // מוצלחת — מעבירים גם isAllDay: false כדי לעבור את ה-guard המתאים.
        await act(async () => {
            await props.onEventDrop({ event, start: newStart, end: newEnd, isAllDay: false });
        });

        // ממתינים ל-mutation; updateItemColumnValues שולח mutation אנונימית
        // שמכילה change_multiple_column_values.
        await waitFor(
            () => expect(capture.find(/change_multiple_column_values/)).toBeDefined(),
            { timeout: 5000 }
        );

        const call = capture.find(/change_multiple_column_values/);
        const queryStr = call.query;

        // (1) item_id ו-board_id מוטמעים ישירות ב-mutation string (לא דרך variables).
        expect(queryStr).toMatch(/item_id:\s*999\b/);
        expect(queryStr).toMatch(/board_id:\s*100\b/);

        // (2) חילוץ ה-column_values: ה-mutation עוטף את ה-JSON ב-double-stringify
        //     (`JSON.stringify(JSON.stringify(columnValues))`) — נשלוף את המחרוזת
        //     הפנימית ונפענח פעמיים.
        const cvMatch = queryStr.match(/column_values:\s*("(?:[^"\\]|\\.)*")/);
        expect(cvMatch).toBeTruthy();
        const cv = JSON.parse(JSON.parse(cvMatch[1]));

        // (3) date — מועבר בפורמט Monday (UTC). הטסט קופץ על ה-shape
        //     ולא על ה-instant הספציפי כדי שלא יישבר על TZ של CI/local.
        expect(cv.date).toMatchObject({
            date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            time: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/)
        });

        // (4) duration — משך חדש 2 שעות → '2.00' (durationHours.toFixed(2)).
        //     זו עיקר ההצהרה החוזית של drag/resize: עדכון משך לפי הזמן החדש.
        expect(cv.numbers).toBe('2.00');

        // (5) drag/resize לא משנה event_type / non_billable / project_link / reporter.
        //     החוזה ב-useMondayEvents:
        //       "לא משנים את סטטוס סוג הדיווח ב-drag/resize"
        //       "הסטטוס ישתנה רק בשמירה/המרה מפורשת של האירוע"
        expect(cv.event_type).toBeUndefined();
        expect(cv.project_link).toBeUndefined();
        expect(cv.reporter_people).toBeUndefined();
        expect(cv.non_billable_type).toBeUndefined();
    }, 30000);
});
