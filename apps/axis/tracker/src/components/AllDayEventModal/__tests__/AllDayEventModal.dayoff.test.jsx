/* global globalThis */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import AllDayEventModal from '../AllDayEventModal';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { createMondayMock } from '../../../test-utils/mondayMock';
import { t } from '../../../i18n';

/**
 * W4.4 — הפניית הזנה לרכיב Day-off (החלטה D5):
 * כש-absenceSource='dayoff' תפריט סוגי החופשה במודל היומי מוחלף בשני כפתורים —
 * דיווחים מרובים למעלה וכפתור "דיווח היעדרות" למטה שפותח את Day-off בטאב חדש
 * (קישור עומק מהגדרת dayOffAppUrl; בלי URL תקין הכפתור מושבת עם הסבר).
 * ברירת המחדל (absenceSource='tracker') שומרת את ההתנהגות הקיימת אחד-לאחד.
 */

// useTasksMultiple יוצר instance של monday-sdk-js ברמת המודול — חייבים למקות
vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

const TEST_CONTEXT = {
    boardId: 100,
    instanceId: 'dayoff-modal-test',
    user: { id: '7', name: 'Tester', currentLanguage: 'he' }
};

// עמודת התת-סוג על לוח הדיווחים — נטענת דרך useColumnOptions במצב tracker בלבד
const allDayTypeColumnResponse = {
    data: {
        boards: [{
            id: '100',
            columns: [{
                id: 'all_day_type',
                type: 'status',
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

const BASE_SETTINGS = {
    useCurrentBoardForReporting: true,
    dateColumnId: 'date',
    durationColumnId: 'numbers',
    reporterColumnId: 'reporter_people',
    eventTypeStatusColumnId: 'event_type',
    allDayTypeStatusColumnId: 'all_day_type',
    eventTypeMapping: { '0': 'allDay', '3': 'billable' },
    eventTypeLabelMeta: { '0': { label: 'יומי' }, '3': { label: 'שעתי' } },
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

// תאריך עבר מובהק — כפתור הדיווחים המרובים מוצג רק לתאריך לא-עתידי
const PAST_DATE = new Date(2026, 0, 5);

function createMonday() {
    const monday = createMondayMock({
        context: TEST_CONTEXT,
        apiResponsesByOp: {
            boards: (query) => {
                if (typeof query === 'string' && query.includes('"all_day_type"')) {
                    return allDayTypeColumnResponse;
                }
                return { data: { boards: [{ id: '100', columns: [] }] } };
            }
        }
    });
    globalThis.__testMondayMock = monday;
    return monday;
}

function renderModal({ settings = {}, props = {} } = {}) {
    const monday = createMonday();
    const utils = renderWithProviders(
        <AllDayEventModal
            isOpen={true}
            onClose={vi.fn()}
            pendingDate={PAST_DATE}
            onCreate={vi.fn()}
            monday={monday}
            context={TEST_CONTEXT}
            projects={[]}
            loadingProjects={false}
            {...props}
        />,
        {
            monday,
            initialContext: TEST_CONTEXT,
            initialSettings: { ...BASE_SETTINGS, ...settings }
        }
    );
    return { monday, ...utils };
}

beforeEach(() => {
    vi.useRealTimers();
});

afterEach(() => {
    delete globalThis.__testMondayMock;
});

describe('AllDayEventModal — הפניה ל-Day-off (W4.4/D5)', () => {

    it("ברירת מחדל (tracker): תפריט הסוגים מוצג, אין כפתור דיווח היעדרות", async () => {
        renderModal();

        // הכפתורים נטענים מהעמודה דרך useColumnOptions
        const vacationButton = await screen.findByRole('button', { name: /חופשה/ });
        expect(vacationButton).toBeTruthy();
        expect(screen.queryByText(t('allDayModal.dayoffButton'))).toBeNull();
        // כפתור הדיווחים המרובים קיים כרגיל
        expect(screen.getByText(t('allDayModal.multipleReports'))).toBeTruthy();
    });

    it("dayoff: כפתור דיווח היעדרות במקום תפריט הסוגים; אין שאילתת תוויות לעמודת התת-סוג", async () => {
        const { monday } = renderModal({ settings: { absenceSource: 'dayoff' } });

        await screen.findByText(t('allDayModal.dayoffButton'));

        // אף כפתור סוג חופשה לא מוצג
        expect(screen.queryByRole('button', { name: /חופשה/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /מחלה/ })).toBeNull();

        // useColumnOptions לא נורה עבור עמודת התת-סוג (התפריט מוסתר)
        const columnQueries = monday.api.mock.calls.filter(([query]) =>
            typeof query === 'string' && query.includes('"all_day_type"')
        );
        expect(columnQueries).toHaveLength(0);
    });

    it('dayoff: סדר הכפתורים — דיווחים מרובים למעלה, דיווח היעדרות מתחתיו', async () => {
        renderModal({ settings: { absenceSource: 'dayoff' } });

        // קודם ממתינים לכפתור ההיעדרות — הוא מרונדר רק אחרי שההגדרות (dayoff) נטענות
        const dayoffButton = (await screen.findByText(t('allDayModal.dayoffButton'))).closest('button');
        const bulkButton = screen.getByText(t('allDayModal.multipleReports')).closest('button');
        // compareDocumentPosition: ה-bulk קודם ל-dayoff בעץ ה-DOM
        // eslint-disable-next-line no-bitwise -- API דפדפן מבוסס ביטים
        expect(bulkButton.compareDocumentPosition(dayoffButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('dayoff: זרימת הדיווחים המרובים שורדת — הכפתור קיים ולחיצה פותחת את הטופס', async () => {
        renderModal({ settings: { absenceSource: 'dayoff' } });

        const bulkButton = (await screen.findByText(t('allDayModal.multipleReports'))).closest('button');
        expect(bulkButton).toBeTruthy();
        fireEvent.click(bulkButton);

        // הטופס המפוצל נפתח — שדה חיפוש הפרויקטים מוצג
        await waitFor(() => {
            expect(screen.getByPlaceholderText(t('allDayModal.search.projectPlaceholder'))).toBeTruthy();
        });
        // כפתור ההיעדרות לא מוצג בתצוגת הטופס
        expect(screen.queryByText(t('allDayModal.dayoffButton'))).toBeNull();
    });

    it('dayoff + dayOffAppUrl תקין: הכפתור פעיל ולחיצה פותחת את Day-off בטאב חדש', async () => {
        const url = 'https://acme.monday.com/apps/installed/day-off';
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        renderModal({ settings: { absenceSource: 'dayoff', dayOffAppUrl: url } });

        const dayoffButton = (await screen.findByText(t('allDayModal.dayoffButton'))).closest('button');
        expect(dayoffButton.disabled).toBe(false);
        expect(screen.queryByText(t('allDayModal.dayoffButtonNoUrl'))).toBeNull();

        fireEvent.click(dayoffButton);
        expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
        openSpy.mockRestore();
    });

    it('dayoff בלי dayOffAppUrl: הכפתור מושבת עם הסבר', async () => {
        renderModal({ settings: { absenceSource: 'dayoff', dayOffAppUrl: '' } });

        const dayoffButton = (await screen.findByText(t('allDayModal.dayoffButton'))).closest('button');
        expect(dayoffButton.disabled).toBe(true);
        expect(screen.getByText(t('allDayModal.dayoffButtonNoUrl'))).toBeTruthy();
    });

    it('dayoff עם URL שאינו http(s): הכפתור מושבת (הגנה)', async () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        // eslint-disable-next-line no-script-url -- בכוונה: מוודאים שקישור זדוני לא נפתח
        renderModal({ settings: { absenceSource: 'dayoff', dayOffAppUrl: 'javascript:alert(1)' } });

        const dayoffButton = (await screen.findByText(t('allDayModal.dayoffButton'))).closest('button');
        expect(dayoffButton.disabled).toBe(true);

        fireEvent.click(dayoffButton);
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });
});
