/* global globalThis */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';

/**
 * Integration regression 3.1.2 (F014) — safeApi עושה retry על 429 בזרימה אמיתית.
 *
 * החוזה: Wave 3.1.1 חיווט את safeApi דרך executeWithRetry. הטסט הזה שומר
 * שעתיד refactor לא יסיר את ה-retry ב-safeApi — useFilterOptions:loadReporters
 * הוא safeApi caller, אז כשה-mock זורק 429 בקריאה הראשונה ל-fetchReporters
 * וחוזר תקין בשנייה, ה-FilterBar חייב להציג את המדווח (ולא toast).
 *
 * שימוש ב-real timers: ה-retry הראשון משהה 2s (exponential backoff) — פגיע אבל
 * סביר ל-integration test יחיד. fake timers היו חוסמים את ה-8-attempt loop של
 * SettingsContext ואת ה-i18n cold-start בתוך ה-harness.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('Integration — safeApi retries 429 in a real flow (3.1.2)', () => {
    it('useFilterOptions:loadReporters עושה retry אחרי 429 ומציג את המדווח', async () => {
        // המדווח Alice — אותה תבנית כמו ב-2.1.4.
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

        // מונה ייעודי לקריאות persons_and_teams — רק אלו צריכות לקבל 429
        // בקריאה הראשונה. שאר ה-boards queries עוברים תקין כדי שהקלנדר יעלה.
        let reportersCallCount = 0;

        const { monday } = await renderCalendar({
            apiResponsesByOp: {
                boards: (query) => {
                    if (typeof query !== 'string') return eventsResponse;
                    if (query.includes('persons_and_teams')) {
                        reportersCallCount += 1;
                        if (reportersCallCount === 1) {
                            // 429-shaped error בפורמט שה-SDK של Monday מחזיר — ה-data.errors[0].extensions.code
                            // הוא RATE_LIMIT_EXCEEDED, ש-isRetryableCode מזהה.
                            const err = Object.assign(new Error('rate limited'), {
                                data: {
                                    errors: [{
                                        message: 'rate limited',
                                        extensions: { code: 'RATE_LIMIT_EXCEEDED', status_code: 429 }
                                    }]
                                }
                            });
                            return Promise.reject(err);
                        }
                        return reportersResponse;
                    }
                    if (query.includes('query_params')) {
                        if (/boards\s*\(?\s*ids:\s*\[?\s*200\b/.test(query)) return projectsResponse;
                        return eventsResponse;
                    }
                    if (/boards\s*\(?\s*ids:\s*\[?\s*200\b/.test(query)) return filterProjectsResponse;
                    return eventsResponse;
                }
            }
        });

        // FilterBar trigger — אותה תבנית כמו ב-2.1.4 (אפשר reuse כי החוזה
        // של ה-UI לא משתנה כאן; הטסט בודק את ה-API layer מתחת).
        const triggerLabel = await screen.findByText('סינון');
        const triggerBtn = triggerLabel.closest('button');
        expect(triggerBtn).toBeTruthy();
        fireEvent.click(triggerBtn);

        // Alice מופיע אחרי שה-retry של safeApi עובר. timeout נדיב — 2s
        // backoff + i18n + render. אם ה-retry לא היה עובד, fetchReporters היה
        // נופל ב-catch, מעלה toast, ו-Alice לעולם לא היה מופיע.
        await screen.findByText('Alice', {}, { timeout: 15000 });

        // החוזה ה-quantitative: בדיוק 2 קריאות persons_and_teams — הניסיון
        // הראשון שנכשל + ה-retry שהצליח. אם safeApi יאבד את ה-retry בעתיד,
        // המונה יעצור על 1 (וה-Alice לא יופיע, אבל ה-assertion הזה עוזר
        // לאבחן regression).
        await waitFor(() => {
            expect(reportersCallCount).toBe(2);
        }, { timeout: 5000 });

        // Sanity — שאר ה-monday.api נקרא (לא רק reporters), כלומר ה-mock
        // אכן נצרך ע"י useFilterOptions ולא ע"י משהו אחר.
        expect(monday.api).toHaveBeenCalled();
    }, 30000);
});
