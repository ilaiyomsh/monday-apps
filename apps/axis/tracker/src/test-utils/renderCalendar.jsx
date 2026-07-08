/* global globalThis */
import { vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import {
    createMondayMock,
    mockBoardWithItems,
    mockEmptyEventsResponse,
    mockProjectsResponse,
    mockReportersResponse
} from './mondayMock';
import { STRUCTURE_MODES } from '../contexts/SettingsContext';
import i18n from '../i18n';

/**
 * Harness לטסטי integration של MondayCalendar.
 *
 * רנדור מלא של `<App />` תחת jsdom + monday-sdk-js mock. זמן מקובע, settings
 * זרועים מראש, ו-mock עם תגובות defensive שאינן קורסות אם רכיב שואל ב-API
 * ללא הזרקה מפורשת.
 *
 * חשוב: הקובץ של הטסט חייב להפעיל `vi.mock('monday-sdk-js', ...)` ולהפנות
 * את ה-default export ל-`globalThis.__testMondayMock`. ראה INTEGRATION_TESTS.md.
 *
 * @param {object} [options]
 * @param {Date} [options.now] — תאריך לקיבוע (ברירת מחדל: 2026-05-07T09:00:00+03:00)
 * @param {string} [options.language] — 'he' | 'en' (ברירת מחדל: 'he')
 * @param {object} [options.settings] — overrides מעל ה-seed הברירת מחדל
 * @param {object} [options.context] — overrides מעל קונטקסט ברירת המחדל
 * @param {object} [options.apiResponsesByOp] — מיפוי op-name → response (מתמזג מעל defaults)
 * @param {object} [options.apiResponses] — מיפוי substring → response (substring fallback)
 * @returns {Promise<{ container, monday, settings, context, ...rtl }>}
 */
export async function renderCalendar(options = {}) {
    const now = options.now ?? new Date('2026-05-07T09:00:00+03:00');
    const language = options.language ?? 'he';

    // קיבוע זמן — מבטיח דטרמיניזם של ראשי שבוע / חודש / דגלי "היום".
    vi.setSystemTime(now);

    // קונטקסט ברירת מחדל — instanceId ו-boardId יציבים בין טסטים.
    const baseContext = {
        boardId: 100,
        instanceId: 'integration-instance',
        instanceType: 'board_view',
        user: { id: '7', name: 'Tester', currentLanguage: language },
        theme: 'light',
        ...options.context
    };

    // Seed מלא של customSettings — כל ה-IDs שצריכים להיות מאוכלסים כדי
    // ש-MondayCalendar לא ייפול ב-validation או ב-graphQL queries.
    // הבחירה: PROJECT_ONLY במצב fieldConfig — task/stage hidden — מבטיח את
    // זרימת היצירה הפשוטה ביותר.
    const seededSettings = {
        structureMode: STRUCTURE_MODES.PROJECT_ONLY,
        fieldConfig: {
            task: 'hidden',
            stage: 'hidden',
            notes: 'hidden',
            billableToggle: 'visible',
            nonBillableType: 'required'
        },
        // לוחות
        connectedBoardId: 200,                 // לוח פרויקטים
        peopleColumnIds: ['people'],           // עמודת People בלוח פרויקטים
        useCurrentBoardForReporting: true,     // מדווחים על ה-context.boardId
        // עמודות בלוח דיווחים
        dateColumnId: 'date',
        durationColumnId: 'numbers',
        projectColumnId: 'project_link',
        reporterColumnId: 'reporter_people',
        eventTypeStatusColumnId: 'event_type',
        nonBillableStatusColumnId: 'non_billable_type',
        allDayTypeStatusColumnId: 'all_day_type',
        // מיפוי סוגי דיווח — index → category
        eventTypeMapping: {
            0: 'billable',
            1: 'nonBillable',
            2: 'allDay',
            3: 'allDay',
            4: 'allDay',
            5: 'temporary'
        },
        eventTypeLabelMeta: {
            0: { label: 'שעתי', color: '#00ff00' },
            1: { label: 'לא לחיוב', color: '#ff9900' },
            2: { label: 'חופשה', color: '#33aaff' },
            3: { label: 'מחלה', color: '#ff3333' },
            4: { label: 'מילואים', color: '#9933cc' },
            5: { label: 'זמני', color: '#999999' }
        },
        // פילטר — מאפשר ל-FilterBar לטעון מדווחים מלוח הדיווחים עצמו
        filterEmployeesBoardId: null,
        // metadata — מבטיח שזה לא יזוהה כ-firstInstall
        lastModifiedAt: '2026-05-01T00:00:00.000Z',
        lastModifiedBy: { id: '7', name: 'Tester' },
        // languageOverride — תואם ל-language של הקונטקסט, מבטל את useLanguageSync flicker
        languageOverride: language,
        ...options.settings
    };

    // תגובות defensive — כל op שלא מוגדר במפורש מקבל ערך תקין-מינימלי
    // כדי ש-MondayCalendar לא ייפול בזמן rendering. הטסט יכול לדרוס דרך
    // apiResponsesByOp.
    const defaultOpResponses = {
        // me — fetchCurrentUser
        me: { data: { me: { id: '7', name: 'Tester' } } },
        // boards — נשלף בהרבה queries; מחזירים מבנה ריק עם cursor: null
        boards: ({ data: { boards: [{ id: '100', items_page: { cursor: null, items: [] }, columns: [] }] } }),
        // items_page / next_items_page — pagination cursors
        next_items_page: { data: { next_items_page: { cursor: null, items: [] } } },
        complexity: { data: { complexity: { query: 0, before: 100000, after: 100000, reset_in_x_seconds: 60 } } }
    };

    const apiResponsesByOp = {
        ...defaultOpResponses,
        ...options.apiResponsesByOp
    };

    const apiResponses = {
        ...options.apiResponses
    };

    const monday = createMondayMock({
        context: baseContext,
        apiResponsesByOp,
        apiResponses
    });

    // Seed של storage עם ה-customSettings — מבטיח ש-SettingsContext יטען מיד
    // ולא ימתין 8 retries.
    const globalKey = `customSettings_${baseContext.instanceId}`;
    monday.__seedStorage(globalKey, JSON.stringify(seededSettings));

    // Mock של monday-sdk-js — חיוני להפעיל ב-test file:
    //   vi.mock('monday-sdk-js', () => ({ default: () => globalThis.__testMondayMock }));
    // הקובץ הזה רק מציב את ה-mock על globalThis ומוודא שהמודולים ייטענו מחדש.
    globalThis.__testMondayMock = monday;

    // ניקוי module cache כדי ש-App יטען מחדש ויקבל את ה-mock החדש.
    vi.resetModules();

    // יישור שפה ב-i18n — מבטיח שהטסט מתחיל בשפה הצפויה.
    if (i18n.language !== language) {
        await i18n.changeLanguage(language);
    }

    // Dynamic import — חשוב, שאחרי resetModules
    const { default: App } = await import('../App');

    const result = render(<App />);

    // המתנה ל-isLoading של SettingsContext להיגמר. עד אז MondayCalendar עוד
    // לא ב-DOM. שימוש ב-`rbc-calendar` כי זו מחלקת השורש של react-big-calendar.
    await waitFor(() => {
        const grid = result.container.querySelector('.rbc-calendar');
        if (!grid) {
            throw new Error('Calendar grid not yet rendered');
        }
    }, { timeout: 20000 });

    return {
        ...result,
        monday,
        settings: seededSettings,
        context: baseContext,
        // עזרי factory לטסטים שצריכים להזריק נתונים בהמשך
        helpers: {
            mockBoardWithItems,
            mockEmptyEventsResponse,
            mockProjectsResponse,
            mockReportersResponse
        }
    };
}

export default renderCalendar;
