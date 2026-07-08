/* global globalThis */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, waitFor, screen } from '@testing-library/react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';
import { resolveTimedEventIndex } from '../../utils/eventTypeMapping';

/**
 * Integration test 2.1.1 — flow ליצירת אירוע שעתי end-to-end:
 *   לחיצה על תא ב-rbc → EventModal נפתח → בחירת פרויקט → שמירה →
 *   create_item נשלח ל-Monday עם columnValues צפויים והאירוע נצבע ב-state.
 *
 * החוזה: assert על שם העמודה והערך, לא על seq הקריאות הפנימי של MondayCalendar.
 * כך שהטסט יישרוד את פירוק ה-god-files ב-Wave 4.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti מנסה לכתוב ל-canvas שלא קיים ב-jsdom — טיימר ה-rAF
// ממשיך לרוץ אחרי שהטסט נגמר וגורם ל-uncaught exception ב-vitest.
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

let originalGetBoundingClientRect;

beforeEach(() => {
    // jsdom מחזיר getBoundingClientRect של 0/0 — handleCalendarTap מסתמך על
    // height כדי לתרגם clientY לזמן. סטאב גלובלי ל-bounds סבירים.
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectStub() {
        return { top: 0, left: 0, right: 200, bottom: 1000, width: 200, height: 1000, x: 0, y: 0, toJSON() { return {}; } };
    };
});

afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('Integration — create timed event (2.1.1)', () => {
    it('לחיצה על תא יום → בחירת פרויקט → שמירה שולחת create_item עם columnValues צפוי', async () => {
        // useProjects ו-useMondayEvents שתיהן יורות query עם op-name "boards" (אנונימי, השדה הראשון).
        // dispatch לפי תוכן ה-query: query פרויקטים מכיל "assigned_to_me"; query אירועים לא.
        const projectsResponse = mockProjectsResponse({
            boardId: 200,
            projects: [{ id: '11', name: 'Acme Project' }]
        });
        const eventsResponse = mockBoardWithItems({ boardId: 100, items: [] });

        const { container, monday } = await renderCalendar({
            // mode: 'mobile' מפעיל את handleCalendarTap (onClick רגיל) במקום
            // מנגנון ה-Selection של rbc — הרבה יותר אמין ב-jsdom.
            // הספק לא משתנה: אותו onSelectSlot יורה.
            context: { mode: 'mobile' },
            apiResponsesByOp: {
                boards: (query) => {
                    if (typeof query === 'string' && query.includes('assigned_to_me')) {
                        return projectsResponse;
                    }
                    return eventsResponse;
                },
                create_item: { data: { create_item: { id: '999', name: 'Acme Project' } } }
            }
        });

        const capture = createApiPayloadCapture(monday);

        // לחיצה על תא היום (.rbc-day-slot) — handleCalendarTap מחשב את הזמן
        // לפי clientY ובאונדס שדגמנו, ופותח את ה-EventModal דרך onSelectSlot.
        const daySlot = container.querySelector('.rbc-day-slot');
        expect(daySlot).toBeTruthy();
        fireEvent.click(daySlot, { clientY: 60, clientX: 50 });

        // EventModal נפתח (lazy + Suspense). מחכים שכפתור הפרויקט יהיה ב-DOM.
        const projectButton = await screen.findByRole(
            'button',
            { name: 'Acme Project' },
            { timeout: 10000 }
        );
        fireEvent.click(projectButton);

        // כפתור 'שמור' — eventModal.actions.save בעברית.
        const saveButton = await screen.findByRole('button', { name: 'שמור' });
        await waitFor(() => expect(saveButton).not.toBeDisabled());
        fireEvent.click(saveButton);

        // ממתינים ל-mutation create_item שתוצא דרך useMondayEvents.createEvent.
        await waitFor(
            () => expect(capture.find(/mutation create_item/)).toBeDefined(),
            { timeout: 10000 }
        );

        const call = capture.find(/mutation create_item/);
        // monday.api(query, { variables }) — apiPayloadCapture שומר את הארגומנט השני כמו שהוא.
        const variables = call.variables.variables;
        const cv = JSON.parse(variables.columnValues);

        // (1) שם הפריט — PROJECT_ONLY + billable + task/stage hidden → projectName בלבד.
        expect(variables.itemName).toBe('Acme Project');
        expect(variables.boardId).toBe(100);

        // (2) קישור פרויקט.
        expect(cv.project_link).toEqual({ item_ids: [11] });

        // (3) מדווח — context.user.id === '7'.
        expect(cv.reporter_people).toEqual({ personsAndTeams: [{ id: 7, kind: 'person' }] });

        // (4) index של סוג האירוע — assert דרך resolver הציבורי, לא מספר קסם.
        const expectedIdx = resolveTimedEventIndex({
            isBillable: true,
            project: { id: '11' },
            mapping: {
                0: 'billable',
                1: 'nonBillable',
                2: 'allDay',
                3: 'allDay',
                4: 'allDay',
                5: 'temporary'
            },
            enableDistinction: false
        });
        // buildColumnValues מבצע parseInt(typeIndex, 10) לפני השליחה — מתאימים את הציפייה.
        expect(cv.event_type).toEqual({ index: parseInt(expectedIdx, 10) });

        // (5) duration — לחיצה יחידה מקבלת מינימום של שעה (60min) → 1.00 שעות.
        expect(cv.numbers).toBe('1.00');

        // (6) date — פורמט Monday (YYYY-MM-DD ו-HH:mm:ss). לא bound ל-זמן ספציפי
        //     (תלוי בעיגול וב-bounds), רק ל-shape.
        expect(cv.date).toMatchObject({
            date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            time: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/)
        });
    }, 30000);
});
