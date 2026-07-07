/* global globalThis */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, waitFor, screen } from '@testing-library/react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';

/**
 * Integration test 2.1.4 — flow פילטר לפי מדווח end-to-end:
 *   FilterBar נפתח → בחירת מדווח → useCalendarFilter בונה rule → MondayCalendar
 *   קורא ל-loadEvents עם filterRules → ה-GraphQL query כולל חוק על
 *   reporterColumnId עם compare_value של [`person-${id}`].
 *
 * החוזה: assert על ה-rule שבמחרוזת ה-query (column_id ו-compare_value),
 * לא על seq הקריאות הפנימי. כך הטסט ישרוד פירוק god-files ב-Wave 4.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

// canvas-confetti — אותה הגנה כמו ב-2.1.1/2.1.2/2.1.3 (ה-rAF callback נוגע
// ב-canvas שלא קיים ב-jsdom וגורם ל-uncaught exception).
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('Integration — filter by reporter (2.1.4)', () => {
    it('בחירת מדווח ב-FilterBar שולחת loadEvents עם חוק person- עבור reporterColumnId', async () => {
        // המדווח Alice — id מספרי 99, מופיע כפריט בלוח הדיווחים (board 100)
        // עם עמודת reporter_people. שם הפריט הוא שם התצוגה (תבנית
        // useFilterOptions.fetchReporters).
        const reporterItem = {
            id: '50',
            name: 'Alice',
            column_values: [
                {
                    id: 'reporter_people',
                    persons_and_teams: [{ id: 99, kind: 'person' }]
                }
            ]
        };
        const reportersResponse = mockBoardWithItems({ boardId: 100, items: [reporterItem] });
        const eventsResponse = mockBoardWithItems({ boardId: 100, items: [] });
        const projectsResponse = mockProjectsResponse({ boardId: 200, projects: [] });
        const filterProjectsResponse = mockBoardWithItems({ boardId: 200, items: [] });

        const { monday } = await renderCalendar({
            apiResponsesByOp: {
                // אותו op-name "boards" משרת 4 callers שונים — דיספאצ' לפי
                // תוכן ה-query (לא לפי boardId לבד, כי loadEvents ו-fetchReporters
                // שניהם מ-board 100):
                //   * useFilterOptions.fetchReporters       — מכיל "persons_and_teams" (PeopleValue fragment)
                //   * useMondayEvents.loadEventsPage        — מכיל "query_params" + boards 100
                //   * useProjects                           — מכיל "query_params" + boards 200
                //   * useFilterOptions.fetchFilterProjects  — boards 200, ללא query_params
                boards: (query) => {
                    if (typeof query !== 'string') return eventsResponse;
                    if (query.includes('persons_and_teams')) return reportersResponse;
                    if (query.includes('query_params')) {
                        // הפרדה לפי board_id (loadEvents → 100, useProjects → 200)
                        if (/boards\s*\(?\s*ids:\s*\[?\s*200\b/.test(query)) return projectsResponse;
                        return eventsResponse;
                    }
                    if (/boards\s*\(?\s*ids:\s*\[?\s*200\b/.test(query)) return filterProjectsResponse;
                    return eventsResponse;
                }
            }
        });

        const capture = createApiPayloadCapture(monday);

        // FilterBar trigger — הכפתור עם הטקסט "סינון" (filterBar.trigger ב-he).
        // לא משתמשים ב-findByRole({ name }) כי ה-accessible name מורכב מ-icon + span + chevron
        // ולא נפתר ל-"סינון" בלבד. במקום זה, מחפשים את ה-span ועולים ל-button.
        const triggerLabel = await screen.findByText('סינון');
        const triggerBtn = triggerLabel.closest('button');
        expect(triggerBtn).toBeTruthy();
        fireEvent.click(triggerBtn);

        // ממתינים שה-reporter "Alice" יוצג ב-dropdown. useFilterOptions.fetchReporters
        // יורה רק אחרי setFilterEnabled(true) שקורה בסיום הטעינה הראשונה של אירועים.
        const aliceOption = await screen.findByText('Alice', {}, { timeout: 15000 });

        // לחיצה על Alice — useCalendarFilter.setSelectedReporterIds([99]) →
        // filterRules updates → MondayCalendar useEffect קורא ל-loadEvents
        // עם החוקים החדשים.
        fireEvent.click(aliceOption);

        // ממתינים ל-loadEvents חדש שכולל את חוק המדווח.
        // החוזה (useCalendarFilter.buildFilterRules):
        //   { column_id: "reporter_people", compare_value: ["person-99"], operator: "any_of" }
        // useMondayEvents.rulesToGraphQL מסדר את זה כ-text:
        //   { column_id: "reporter_people", compare_value: ["person-99"], operator: any_of }
        await waitFor(() => {
            const filtered = capture.findAll(/items_page/).filter(c =>
                typeof c.query === 'string'
                && c.query.includes('query_params')
                && c.query.includes('"person-99"')
            );
            expect(filtered.length).toBeGreaterThan(0);
        }, { timeout: 10000 });

        // לוקחים את הקריאה האחרונה הרלוונטית ומאמתים את כל מבנה החוק.
        const filteredCalls = capture.findAll(/items_page/).filter(c =>
            typeof c.query === 'string' && c.query.includes('"person-99"')
        );
        const lastCall = filteredCalls[filteredCalls.length - 1];
        const queryStr = lastCall.query;

        // (1) board הדיווחים (100) — מבטיח שהקריאה הגיעה מ-loadEvents
        //     ולא מ-useProjects (200).
        expect(queryStr).toMatch(/boards\s*\(?\s*ids:\s*\[\s*100\s*\]/);

        // (2) חוק המדווח קיים: column_id == reporterColumnId, compare_value
        //     מכיל "person-99", operator any_of. ההצהרה היא חוזית: זה הפורמט
        //     ש-Monday API מצפה לו עבור עמודת People.
        const reporterRulePattern = /column_id:\s*"reporter_people"[\s\S]*?compare_value:\s*\[\s*"person-99"\s*\][\s\S]*?operator:\s*any_of/;
        expect(queryStr).toMatch(reporterRulePattern);

        // (3) ב-buildAllRules, כשיש פילטר ידני על reporterColumnId,
        //     ה-default `assigned_to_me` לא נוסף (`hasReporterFilter` true).
        //     זו ההגנה מפני סינון כפול שמסתיר אירועים של מדווחים אחרים.
        expect(queryStr).not.toContain('"assigned_to_me"');
    }, 30000);
});
