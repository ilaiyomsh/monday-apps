/* global globalThis */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, waitFor, screen } from '@testing-library/react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';
import {
    formatDurationForSave,
    calculateEndDateFromDays,
    isAllDayEventType
} from '../../utils/durationUtils';
import { getAllDayIndexes } from '../../utils/eventTypeMapping';
import { toLocalDateFormat } from '../../utils/dateFormatters';

/**
 * Integration test 2.1.2 — flow ליצירת אירוע יומי מסוג חופשה end-to-end:
 *   קליק על תא all-day → AllDayEventModal נפתח → בחירת "חופשה" →
 *   לחיצה על "צור אירוע" → create_item נשלח ל-Monday עם columnValues
 *   המשתמשים ב-formatDurationForSave (יחידת ימים) ו-calculateEndDateFromDays
 *   (סיום exclusive ביום הבא בחצות).
 *
 * החוזה: assert על שם העמודה והערך, שימוש ב-helper-ים הציבוריים
 * (durationUtils + eventTypeMapping). הטסט יישרוד את פירוק ה-god-files ב-Wave 4.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti מנסה לכתוב ל-canvas שלא קיים ב-jsdom — טיימר ה-rAF
// ממשיך לרוץ אחרי שהטסט נגמר וגורם ל-uncaught exception ב-vitest.
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('Integration — create all-day vacation (2.1.2)', () => {
    it('קליק על תא all-day → בחירת חופשה → "צור אירוע" שולח create_item יומי', async () => {
        // העמודה all_day_type עוברת דרך useColumnOptions: query בנוסח
        // boards(ids:[100]) { columns(ids:["all_day_type"]) { settings } }.
        // ה-extractor של op-name יחזיר 'boards' — כל queries ה-`boards` נדחיים
        // לדיספאצ'ר אחד שמבדיל לפי תוכן.
        const allDayTypeColumnResponse = {
            data: {
                boards: [{
                    id: '100',
                    columns: [{
                        id: 'all_day_type',
                        type: 'status',
                        // settings מגיע כ-JSON string מ-Monday API
                        settings: JSON.stringify({
                            labels: { '0': 'חופשה', '1': 'מחלה', '2': 'מילואים' },
                            labels_colors: {
                                '0': { color: '#33aaff' },
                                '1': { color: '#ff3333' },
                                '2': { color: '#9933cc' }
                            }
                        })
                    }]
                }]
            }
        };

        // עמודת לא-לחיוב — useNonBillableOptions גם נטען עם פתיחת המודל.
        // לא רלוונטי לנתיב חופשה אבל חובה להחזיר משהו תקין.
        const nonBillableColumnResponse = {
            data: {
                boards: [{
                    id: '100',
                    columns: [{
                        id: 'non_billable_type',
                        type: 'status',
                        settings: JSON.stringify({ labels: {}, labels_colors: {} })
                    }]
                }]
            }
        };

        const projectsResponse = mockProjectsResponse({ boardId: 200, projects: [] });
        const eventsResponse = mockBoardWithItems({ boardId: 100, items: [] });

        const { container, monday, settings, context } = await renderCalendar({
            // mode: 'mobile' מפעיל handleCalendarTap (onClick רגיל) במקום
            // מנגנון Selection של rbc — אמין ב-jsdom. ב-mobile defaultView='day'
            // → קיים חלק all-day בראש הסריג עם ‎.rbc-allday-cell.
            context: { mode: 'mobile' },
            // W4.8 (אינטגרציית Day-off): הסוויטה נועלת את זרימת הכתיבה היומית
            // הוותיקה של ה-tracker — מקור ההיעדרויות מוצמד מפורשות ל-'tracker'
            // (זהה לברירת המחדל היום, ולכן ניטרלי-התנהגותית) כדי שהנעילה תמשיך
            // לבדוק את המסלול הוותיק גם אם הערך השמור/ברירת המחדל יתהפכו אי-פעם.
            // תחת 'dayoff' שערי W4.4 חוסמים את createSingleAllDayEvent (D5).
            settings: { absenceSource: 'tracker' },
            apiResponsesByOp: {
                boards: (query) => {
                    // dispatch לפי תוכן ה-query: columns(ids:...) עבור useColumnOptions,
                    // assigned_to_me עבור useProjects, אחרת events.
                    if (typeof query !== 'string') return eventsResponse;
                    if (query.includes('columns(ids:')) {
                        if (query.includes('"all_day_type"')) return allDayTypeColumnResponse;
                        if (query.includes('"non_billable_type"')) return nonBillableColumnResponse;
                        // עמודות נוספות — תגובה ריקה אבל תקינה
                        return { data: { boards: [{ id: '100', columns: [] }] } };
                    }
                    if (query.includes('assigned_to_me')) return projectsResponse;
                    return eventsResponse;
                },
                create_item: { data: { create_item: { id: '999', name: 'חופשה - Tester' } } }
            }
        });

        const capture = createApiPayloadCapture(monday);

        // קליק על ‎.rbc-allday-cell — handleCalendarTap מזהה את האזור ופותח את
        // AllDayEventModal עם pendingDate=calendarDate (היום של הצפייה).
        const allDayCell = container.querySelector('.rbc-allday-cell');
        expect(allDayCell).toBeTruthy();
        fireEvent.click(allDayCell);

        // המודל נטען ב-lazy + Suspense — מחכים שהכפתור 'חופשה' יופיע.
        const vacationButton = await screen.findByRole(
            'button',
            { name: /חופשה/ },
            { timeout: 10000 }
        );
        fireEvent.click(vacationButton);

        // הכפתור 'צור אירוע' מופיע בתצוגת days-selection (טקסט קשיח ב-AllDayEventModal).
        const createButton = await screen.findByRole(
            'button',
            { name: 'צור אירוע' },
            { timeout: 5000 }
        );
        fireEvent.click(createButton);

        // ממתינים ל-mutation create_item — useAllDayEvents.handleCreateAllDayEvent → createSingleAllDayEvent.
        await waitFor(
            () => expect(capture.find(/mutation create_item/)).toBeDefined(),
            { timeout: 10000 }
        );

        const createCalls = capture.findAll(/mutation create_item/);
        // durationDays ברירת מחדל = 1 (אותו יום), כלומר create_item אחד בלבד.
        expect(createCalls).toHaveLength(1);

        const variables = createCalls[0].variables.variables;
        const cv = JSON.parse(variables.columnValues);

        // (1) שם הפריט — "<typeLabel> - <reporterName>"; reporterName מ-context.user.name = 'Tester'.
        expect(variables.itemName).toBe('חופשה - Tester');
        expect(variables.boardId).toBe(100);

        // (2) date — אירוע יומי כולל רק { date }, ללא time. הערך הוא יום של calendarDate
        //     (היום שעליו נקלט ה-tap). מאשרים shape ולא timestamp ספציפי כי calendarDate
        //     נגזר מ-pinned now ועובר RTL transform ב-three_day; ב-day-view הוא הוא היום.
        expect(cv.date).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
        // לא קיים שדה time כשמדובר באירוע יומי
        expect(cv.date.time).toBeUndefined();

        // (3) numbers — formatDurationForSave(1, allDayMainIndex, mapping) → '1' (יחידת ימים, מספר שלם).
        const allDayMainIndex = getAllDayIndexes(settings.eventTypeMapping)[0];
        // getAllDayIndexes מחזיר את מפתחות ה-mapping כסטרינגים (Object.keys); ב-mapping של ה-harness המפתח הראשון של allDay הוא '2'.
        expect(parseInt(allDayMainIndex, 10)).toBe(2);
        expect(isAllDayEventType(allDayMainIndex, settings.eventTypeMapping)).toBe(true);
        expect(cv.numbers).toBe(formatDurationForSave(1, allDayMainIndex, settings.eventTypeMapping));
        expect(cv.numbers).toBe('1');

        // (4) reporter — context.user.id === '7'.
        expect(cv.reporter_people).toEqual({ personsAndTeams: [{ id: 7, kind: 'person' }] });

        // (5) event_type — האינדקס של "יומי" בעמודת eventType (ראשון ב-getAllDayIndexes).
        expect(cv.event_type).toEqual({ index: parseInt(allDayMainIndex, 10) });

        // (6) all_day_type — האינדקס של תת-הסוג שנבחר (חופשה = '0' מה-stub).
        expect(cv.all_day_type).toEqual({ index: 0 });

        // (7) calculateEndDateFromDays — חוזה החוצה: עבור durationDays=1 הסיום
        //     הוא הבא בחצות (exclusive). מאשרים שה-helper לא קוטף בתאריך ההתחלה.
        const dateOnly = new Date(`${cv.date.date}T00:00:00`);
        const computedEnd = calculateEndDateFromDays(dateOnly, 1);
        expect(computedEnd.getTime()).toBe(dateOnly.getTime() + 86400000);
        expect(toLocalDateFormat(computedEnd)).not.toBe(cv.date.date);

        // וידוא שלא נשלחו עמודות שלא צריכות להופיע באירוע יומי בודד:
        // עמודת stage לא הוגדרה ב-harness ולכן לא צפויה.
        expect(cv).not.toHaveProperty('stage');
        // approval לא מופעל בהגדרות → אין עמודת אישור.
        expect(cv).not.toHaveProperty('approval');

        // וידוא של פרמטרי context שהשתמשו בהם — boardId דרך getEffectiveBoardId.
        expect(context.boardId).toBe(100);
    }, 30000);
});
