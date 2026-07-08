/* global globalThis */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, waitFor, screen } from '@testing-library/react';
import { act } from 'react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';
import { resolveTimedEventIndex } from '../../utils/eventTypeMapping';

// 'זמני' — תווית האירוע הזמני בלוח (אין קבוע מיוצא; עתידי-עליה תחת F036).
const TEMPORARY_LABEL = 'זמני';

/**
 * Integration test 2.1.6 — flow המרת אירוע "זמני" לאירוע מחויב end-to-end:
 *   אירוע זמני נטען ל-state (Checkbox temporaryCheckboxColumnId === checked) →
 *   onSelectEvent מופעל דרך rbc → handleEventClick רואה event.isTemporary →
 *   modals.openEventModalForConvert → EventModal נפתח במצב המרה → בחירת פרויקט
 *   → שמירה → handleConvertEvent → updateEvent → change_multiple_column_values
 *   עם event_type.index של 'שעתי' (billable, index 0), project_link, וביטול
 *   הסימון הזמני (temporary_check.checked === 'false').
 *
 * נתיב מימוש: בדומה ל-2.1.3, jsdom לא מסנתז את אירועי ה-mouse של rbc באופן
 * דטרמיניסטי (אפילו לחיצה על event element תלויה ב-Selection-bounds מאפסים).
 * עוטפים את `withDragAndDrop` HOC ב-passthrough שלוכד את ה-props על globalThis,
 * ואז מפעילים `props.onSelectEvent(event)` ישירות. ה-spec מאפשר את הנתיב הזה
 * ("fall back to invoking ... directly via the Calendar instance" ב-2.1.3),
 * וה-handler chain (handleEventClick → openEventModalForConvert → onConvert →
 * handleConvertEvent → updateEvent → updateItemColumnValues) זהה בכל מקרה.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti מנסה לכתוב ל-canvas שלא קיים ב-jsdom — אותה הגנה כמו ב-2.1.1/2.1.2/2.1.3.
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

// עוקפים את ה-DnD HOC: passthrough שלוכד את ה-props על globalThis (אותה תבנית מ-2.1.3).
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

describe('Integration — convert temporary to billable (2.1.6)', () => {
    it('לחיצה על אירוע זמני → בחירת פרויקט → שמירה שולחת change_multiple_column_values עם event_type=שעתי + project_link', async () => {
        // אירוע זמני קיים: 2026-05-06 09:00 → 10:00 (שעה אחת, בעבר ביחס ל-now=2026-05-07).
        // ה-`isTemporary` נקרא מתוך `temporaryCheckboxColumnId` — ה-checkbox 'temporary_check'
        // עם `checked: true` הוא מה שגורם ל-handleEventClick לפתוח את ה-modal במצב convert.
        const seededTemporaryItem = {
            id: '999',
            name: TEMPORARY_LABEL, // 'זמני'
            column_values: [
                {
                    id: 'date',
                    date: '2026-05-06',
                    time: '09:00:00',
                    value: JSON.stringify({ date: '2026-05-06', time: '09:00:00' }),
                    text: '2026-05-06 09:00:00'
                },
                {
                    id: 'numbers',
                    value: '"1.00"',
                    text: '1.00'
                },
                {
                    id: 'event_type',
                    index: 5,
                    label: TEMPORARY_LABEL,
                    text: TEMPORARY_LABEL,
                    value: JSON.stringify({ index: 5 }),
                    label_style: { color: '#999999' }
                },
                {
                    id: 'temporary_check',
                    checked: true,
                    value: JSON.stringify({ checked: 'true' }),
                    text: 'v'
                }
            ]
        };

        const eventsResponse = mockBoardWithItems({ boardId: 100, items: [seededTemporaryItem] });
        const projectsResponse = mockProjectsResponse({
            boardId: 200,
            projects: [{ id: '11', name: 'Acme Project' }]
        });

        const { monday } = await renderCalendar({
            settings: {
                // הוספת עמודת ה-Checkbox למיפוי — בלעדיה loadEvents לא מבקש אותה
                // ו-mapItemToEvent לא יסמן את האירוע כ-temporary.
                temporaryCheckboxColumnId: 'temporary_check'
            },
            apiResponsesByOp: {
                // אותו op-name "boards" משרת projects, events, ו-queries אחרים.
                // useProjects: `boards(ids: 200)` (סקלר) + `query_params` + `assigned_to_me`.
                // useMondayEvents.loadEvents: `boards (ids: [100])` (מערך) + `query_params`.
                // הדיסקרימינטור הסולידי הוא לוח-המקור, לא תוכן ה-rules.
                boards: (query) => {
                    if (typeof query !== 'string') return eventsResponse;
                    if (/boards\s*\(\s*ids:\s*200\b/.test(query)) {
                        return projectsResponse;
                    }
                    if (/boards\s*\(\s*ids:\s*\[\s*100\s*\]/.test(query)) {
                        return eventsResponse;
                    }
                    return eventsResponse;
                }
            }
        });

        const capture = createApiPayloadCapture(monday);

        // ממתינים שה-DnD HOC ייקלוט את ה-props ושהאירוע הזמני יוזרם פנימה דרך mapItemToEvent.
        await waitFor(() => {
            const props = globalThis.__rbcDndProps;
            expect(props).toBeTruthy();
            expect(Array.isArray(props.events)).toBe(true);
            expect(props.events.some(e => e.mondayItemId === '999' && e.isTemporary === true)).toBe(true);
        }, { timeout: 10000 });

        const props = globalThis.__rbcDndProps;
        const tempEvent = props.events.find(e => e.mondayItemId === '999');
        expect(tempEvent.isTemporary).toBe(true);
        expect(tempEvent.allDay).toBe(false);

        // הקריאה הישירה ל-onSelectEvent היא מה ש-rbc עושה בלחיצה — מפעילה
        // handleEventClick שמזהה event.isTemporary ופותח את ה-modal במצב convert.
        await act(async () => {
            await props.onSelectEvent(tempEvent);
        });

        // EventModal נפתח (lazy + Suspense). מחכים לכפתור הפרויקט.
        const projectButton = await screen.findByRole(
            'button',
            { name: 'Acme Project' },
            { timeout: 10000 }
        );
        fireEvent.click(projectButton);

        // במצב convert הכפתור נקרא 'המר לדיווח' (eventModal.actions.convert) — לא 'שמור'.
        const saveButton = await screen.findByRole('button', { name: 'המר לדיווח' });
        await waitFor(() => expect(saveButton).not.toBeDisabled());
        fireEvent.click(saveButton);

        // ממתינים ל-mutation; updateItemColumnValues שולח mutation אנונימית
        // שמכילה change_multiple_column_values.
        await waitFor(
            () => expect(capture.find(/change_multiple_column_values/)).toBeDefined(),
            { timeout: 10000 }
        );

        const call = capture.find(/change_multiple_column_values/);
        const queryStr = call.query;

        // (1) item_id ו-board_id מוטמעים ישירות ב-mutation string.
        expect(queryStr).toMatch(/item_id:\s*999\b/);
        expect(queryStr).toMatch(/board_id:\s*100\b/);

        // (2) חילוץ ה-column_values: double-stringify (כמו ב-2.1.3).
        const cvMatch = queryStr.match(/column_values:\s*("(?:[^"\\]|\\.)*")/);
        expect(cvMatch).toBeTruthy();
        const cv = JSON.parse(JSON.parse(cvMatch[1]));

        // (3) event_type — החוזה הקריטי של convert: סטטוס משתנה מ-'זמני' ל-'שעתי'
        //     (billable, index 0). assert דרך resolver הציבורי כדי שיישרוד re-mapping.
        const expectedIdx = resolveTimedEventIndex({
            isBillable: true,
            project: { id: '11', name: 'Acme Project' },
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
        expect(cv.event_type).toEqual({ index: parseInt(expectedIdx, 10) });
        expect(cv.event_type.index).toBe(0); // sanity — billable === 0 ב-seed הברירת מחדל

        // (4) project_link — קישור לפרויקט שנבחר (Acme, id 11).
        expect(cv.project_link).toEqual({ item_ids: [11] });

        // (5) reporter_people — מדווח === context.user.id ('7').
        expect(cv.reporter_people).toEqual({ personsAndTeams: [{ id: 7, kind: 'person' }] });

        // (6) temporary_check — buildColumnValues מאפס תמיד את הסימון בעת
        //     create/update/convert דרך ה-UI. זה בדיוק החוזה של "האירוע כבר לא זמני".
        expect(cv.temporary_check).toEqual({ checked: 'false' });

        // (7) date + duration — pendingSlot מורש מ-event.start/end (1 שעה).
        expect(cv.date).toMatchObject({
            date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            time: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/)
        });
        expect(cv.numbers).toBe('1.00');
    }, 30000);
});
