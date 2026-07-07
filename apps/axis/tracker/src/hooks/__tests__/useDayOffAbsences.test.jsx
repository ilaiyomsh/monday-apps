/**
 * useDayOffAbsences — שכבת ההיעדרויות מלוח החופשות של Day-off (אינטגרציה W4.1)
 *
 * מכסה: gating (ברירות מחדל רדומות), בניית שתי השאילתות (חלון מורחב +
 * assigned_to_me / kind any_of), מיזוג ודה-דופ, סינון חפיפה בצד הלקוח (כולל
 * פריט שפורש על כל החלון), מיפוי לאירוע רב-ימי יחיד (end בלעדי + גלגול חודש),
 * fallback של kind + דיווח drift, דגלי אישור לפי מדיניות D2 (כבוי/דולק/ריק/
 * נדחה/אי-התאמה קולנית), השמטת פריטים פגומים, pagination, והחלפת נתוני חלון
 * בקריאה חוזרת (CONTRACT.md §7).
 */
import { describe, it, expect } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useDayOffAbsences, DAY_OFF_FETCH_WIDENING_DAYS } from '../useDayOffAbsences';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import logger from '../../utils/logger';

const TEST_CONTEXT = {
    boardId: 2002,
    user: { id: '7', name: 'בודק' }
};

// מיפוי לוח חופשות מלא (label IDs נשמרים כמחרוזות — כמו MappingTab)
const FULL_SETTINGS = {
    showAbsences: true,
    dayOffBoardId: '5005',
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
    dayOffApprovalRequired: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

// חלון תצוגה: מרץ 2026. החלון המורחב אחורה (366 ימים): 2025-02-28
const WINDOW_START = new Date(2026, 2, 1);
const WINDOW_END = new Date(2026, 2, 31);
const EXPECTED_WIDENED_FROM = '2025-02-28';

/** בניית פריט לוח חופשות (kindIndex 2 = אישי, 1 = כללי) */
function makeItem(id, {
    name = `פריט ${id}`,
    start,
    end,
    kindIndex = 2,
    typeIndex = 5,
    typeLabel = 'חופשה',
    typeColor = '#ff642e',
    approvalIndex = null,
    personText = 'עובד בדיקה'
} = {}) {
    return {
        id: String(id),
        name,
        column_values: [
            { id: 'person_col', text: personText, value: null },
            { id: 'start_col', text: start || '', value: null, date: start || null },
            { id: 'end_col', text: end || '', value: null, date: end || null },
            { id: 'kind_col', text: '', value: null, index: kindIndex, label: kindIndex === 1 ? 'כללי' : 'אישי' },
            { id: 'type_col', text: typeLabel, value: null, index: typeIndex, label: typeLabel, label_style: { color: typeColor } },
            { id: 'approval_col', text: '', value: null, index: approvalIndex }
        ]
    };
}

/** פריט כללי (יום חברה): kind=1, ללא אדם, ללא סוג/אישור */
function makeGeneralItem(id, { name, start, end } = {}) {
    return makeItem(id, { name, start, end, kindIndex: 1, typeIndex: null, typeLabel: '', typeColor: null, personText: '' });
}

const pageResponse = (items, cursor = null) => ({
    data: { boards: [{ items_page: { cursor, items } }] }
});

/** ראוטר תגובות: שאילתת האדם מזוהה לפי assigned_to_me, השנייה היא הכללית */
const routeByQuery = ({ personal = [], general = [] } = {}) => (query) => {
    if (query.includes('assigned_to_me')) return pageResponse(personal);
    return pageResponse(general);
};

async function setupHook({ settings = FULL_SETTINGS, respond } = {}) {
    const monday = createMondayMock({
        context: TEST_CONTEXT,
        apiResponsesByOp: respond ? { boards: respond } : {}
    });
    const { result } = renderHookWithProviders(
        () => ({
            dayoff: useDayOffAbsences(monday),
            settings: useSettings()
        }),
        { monday, initialContext: TEST_CONTEXT, initialSettings: settings }
    );
    await waitFor(() => expect(result.current.settings.isLoading).toBe(false));
    return { result, monday };
}

async function load(result, start = WINDOW_START, end = WINDOW_END) {
    await act(async () => {
        await result.current.dayoff.loadAbsences(start, end);
    });
}

/** קריאות ה-API של ההוק בלבד (שאילתות items_page על לוח החופשות) */
const dayOffApiCalls = (monday) =>
    monday.api.mock.calls.filter(([query]) => typeof query === 'string' && query.includes('items_page'));

describe('useDayOffAbsences — gating (ברירות מחדל רדומות)', () => {

    it('רדום כשלוח החופשות לא ממופה (ברירת המחדל של כל התקנה קיימת)', async () => {
        const { result, monday } = await setupHook({
            settings: { lastModifiedAt: '2026-01-01T00:00:00.000Z' }
        });
        await load(result);
        expect(result.current.dayoff.absences).toEqual([]);
        expect(dayOffApiCalls(monday)).toHaveLength(0);
    });

    it('רדום כש-showAbsences כבוי גם אם הלוח ממופה במלואו', async () => {
        const { result, monday } = await setupHook({
            settings: { ...FULL_SETTINGS, showAbsences: false }
        });
        await load(result);
        expect(result.current.dayoff.absences).toEqual([]);
        expect(dayOffApiCalls(monday)).toHaveLength(0);
    });

    it('מיפוי חלקי (לוח ללא עמודת אדם) — אזהרה והשכבה נשארת כבויה, בלי קריאת API', async () => {
        const { result, monday } = await setupHook({
            settings: { ...FULL_SETTINGS, dayOffPersonColumnId: null }
        });
        await load(result);
        expect(result.current.dayoff.absences).toEqual([]);
        expect(dayOffApiCalls(monday)).toHaveLength(0);
        expect(logger.warn).toHaveBeenCalledWith(
            'useDayOffAbsences.loadAbsences',
            expect.stringContaining('mapping incomplete'),
            expect.objectContaining({ missing: expect.arrayContaining(['dayOffPersonColumnId']) })
        );
    });

    it('מדיניות אישור פעילה בלי מיפוי אישור — אזהרה והשכבה כבויה (D2)', async () => {
        const { result, monday } = await setupHook({
            settings: {
                ...FULL_SETTINGS,
                dayOffApprovalRequired: true,
                dayOffApprovalColumnId: null,
                dayOffApprovedLabelIds: [],
                dayOffPendingLabelIds: []
            }
        });
        await load(result);
        expect(result.current.dayoff.absences).toEqual([]);
        expect(dayOffApiCalls(monday)).toHaveLength(0);
        expect(logger.warn).toHaveBeenCalledWith(
            'useDayOffAbsences.loadAbsences',
            expect.stringContaining('mapping incomplete'),
            expect.objectContaining({
                missing: expect.arrayContaining(['dayOffApprovalColumnId', 'dayOffApprovedLabelIds', 'dayOffPendingLabelIds'])
            })
        );
    });
});

describe('useDayOffAbsences — בניית השאילתות', () => {

    it('שולח שתי שאילתות AND: between מורחב על תאריך ההתחלה + assigned_to_me / kind any_of', async () => {
        const { result, monday } = await setupHook({ respond: routeByQuery() });
        await load(result);

        const calls = dayOffApiCalls(monday);
        expect(calls).toHaveLength(2);

        const personalQuery = calls.map(([q]) => q).find(q => q.includes('assigned_to_me'));
        const generalQuery = calls.map(([q]) => q).find(q => !q.includes('assigned_to_me'));
        expect(personalQuery).toBeTruthy();
        expect(generalQuery).toBeTruthy();

        // שתיהן על לוח החופשות, ב-AND, עם חוק תאריך מורחב אחורה ב-366 ימים
        expect(DAY_OFF_FETCH_WIDENING_DAYS).toBe(366);
        for (const query of [personalQuery, generalQuery]) {
            expect(query).toContain('boards (ids: [5005])');
            expect(query).toContain('operator: and');
            expect(query).toContain('column_id: "start_col"');
            expect(query).toContain(`["${EXPECTED_WIDENED_FROM}","2026-03-31"]`);
            expect(query).toContain('operator: between');
        }

        // שאילתת האדם: any_of על עמודת האנשים עם assigned_to_me
        expect(personalQuery).toContain('column_id: "person_col"');
        expect(personalQuery).toContain('["assigned_to_me"]');
        expect(personalQuery).toContain('operator: any_of');

        // השאילתה הכללית: any_of על עמודת ה-kind עם ה-label ID הכללי (כמספר),
        // ובלי חוק אדם (person_col מופיע בה רק כעמודת תוכן, לא כחוק סינון)
        expect(generalQuery).toContain('column_id: "kind_col"');
        expect(generalQuery).toContain('compare_value: [1]');
        expect(generalQuery).not.toContain('column_id: "person_col"');
        expect(generalQuery).not.toContain('assigned_to_me');
    });

    it('שולף רק את העמודות הממופות', async () => {
        const { result, monday } = await setupHook({ respond: routeByQuery() });
        await load(result);
        const [query] = dayOffApiCalls(monday)[0];
        for (const colId of ['person_col', 'start_col', 'end_col', 'kind_col', 'type_col', 'approval_col']) {
            expect(query).toContain(`"${colId}"`);
        }
    });

    it('עוקב אחרי cursor ב-pagination לכל שאילתה בנפרד', async () => {
        let personalCalls = 0;
        const respond = (query) => {
            if (query.includes('assigned_to_me')) {
                personalCalls++;
                if (personalCalls === 1) {
                    return pageResponse([makeItem(1, { start: '2026-03-02', end: '2026-03-03' })], 'cur1');
                }
                expect(query).toContain('cursor: "cur1"');
                return pageResponse([makeItem(2, { start: '2026-03-10', end: '2026-03-11' })]);
            }
            return pageResponse([]);
        };
        const { result } = await setupHook({ respond });
        await load(result);
        expect(personalCalls).toBe(2);
        expect(result.current.dayoff.absences.map(a => a.id).sort()).toEqual(['dayoff_1', 'dayoff_2']);
    });
});

describe('useDayOffAbsences — מיזוג, חפיפה ומיפוי', () => {

    it('ממזג את שתי השאילתות עם דה-דופ לפי מזהה פריט (label ה-kind מנצח את ה-fallback)', async () => {
        // פריט 2 כללי שבעמודת האדם שלו מופיע המשתמש — חוזר משתי השאילתות
        const duplicated = makeItem(2, { name: 'יום גיבוש', start: '2026-03-15', end: '2026-03-15', kindIndex: 1, personText: 'בודק' });
        const { result } = await setupHook({
            respond: routeByQuery({
                personal: [makeItem(1, { start: '2026-03-08', end: '2026-03-09' }), duplicated],
                general: [duplicated, makeGeneralItem(3, { name: 'ערב חג', start: '2026-03-20', end: '2026-03-20' })]
            })
        });
        await load(result);

        const absences = result.current.dayoff.absences;
        expect(absences).toHaveLength(3);
        expect(absences.map(a => a.id).sort()).toEqual(['dayoff_1', 'dayoff_2', 'dayoff_3']);
        expect(absences.find(a => a.id === 'dayoff_2').dayOffKind).toBe('general');
    });

    it('מסנן בצד הלקוח לפי חפיפה כוללת — כולל פריט שפורש על כל החלון', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({
                personal: [
                    makeItem(1, { start: '2026-01-10', end: '2026-01-12' }),  // לפני החלון (over-fetch מהשרת)
                    makeItem(2, { start: '2025-12-01', end: '2026-06-30' }),  // פורש על כל החלון — חייב להישמר
                    makeItem(3, { start: '2026-02-25', end: '2026-03-01' }),  // נוגע בתחילת החלון (כולל)
                    makeItem(4, { start: '2026-03-31', end: '2026-04-05' }),  // נוגע בסוף החלון (כולל)
                    makeItem(5, { start: '2026-04-01', end: '2026-04-02' })   // אחרי החלון
                ]
            })
        });
        await load(result);
        expect(result.current.dayoff.absences.map(a => a.id).sort()).toEqual(['dayoff_2', 'dayoff_3', 'dayoff_4']);
    });

    it('ממפה פריט לאירוע רב-ימי יחיד: dayoff_<id>, all-day, לקריאה בלבד, end בלעדי, כותרת+צבע מתווית הסוג', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({
                personal: [makeItem(6, { start: '2026-03-10', end: '2026-03-12', typeIndex: 5, typeLabel: 'מילואים', typeColor: '#00c875' })]
            })
        });
        await load(result);

        expect(result.current.dayoff.absences).toHaveLength(1);
        const event = result.current.dayoff.absences[0];
        expect(event).toMatchObject({
            id: 'dayoff_6',
            dayOffItemId: '6',
            title: 'מילואים',
            allDay: true,
            isDayOff: true,
            readOnly: true,
            dayOffKind: 'personal',
            typeLabelId: '5',
            eventType: 'מילואים',
            eventTypeColor: '#00c875',
            startDateKey: '2026-03-10',
            endDateKey: '2026-03-12'
        });
        // אירוע אחד לכל הטווח — בלי פריסה ליום-יום (CONTRACT.md §6.5)
        expect(event.start).toEqual(new Date(2026, 2, 10));
        expect(event.end).toEqual(new Date(2026, 2, 13)); // 12 במרץ + יום (בלעדי)
    });

    it('end בלעדי מתגלגל מעבר לגבול חודש', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({ personal: [makeItem(7, { start: '2026-03-25', end: '2026-03-31' })] })
        });
        await load(result);
        expect(result.current.dayoff.absences[0].end).toEqual(new Date(2026, 3, 1)); // 1 באפריל
    });

    it('רשומה כללית: הכותרת היא שם הפריט (שדה החוזה), יום בודד, בלי דגלי אישור', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({ general: [makeGeneralItem(8, { name: 'יום העצמאות', start: '2026-03-05', end: '2026-03-05' })] })
        });
        await load(result);

        const event = result.current.dayoff.absences[0];
        expect(event).toMatchObject({
            id: 'dayoff_8',
            title: 'יום העצמאות',
            dayOffKind: 'general',
            isPending: false,
            isApproved: false
        });
        expect(event.start).toEqual(new Date(2026, 2, 5));
        expect(event.end).toEqual(new Date(2026, 2, 6));
    });

    it('משמיט פריטים עם תאריכים חסרים/הפוכים עם אזהרה מרוכזת', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({
                personal: [
                    makeItem(9, { start: '2026-03-10', end: null }),            // חסר תאריך סיום
                    makeItem(10, { start: '2026-03-12', end: '2026-03-10' }),   // סיום לפני התחלה
                    makeItem(11, { start: '2026-03-20', end: '2026-03-21' })    // תקין
                ]
            })
        });
        await load(result);
        expect(result.current.dayoff.absences.map(a => a.id)).toEqual(['dayoff_11']);
        expect(logger.warn).toHaveBeenCalledWith(
            'useDayOffAbsences.loadAbsences',
            expect.stringContaining('missing/invalid dates'),
            expect.objectContaining({ count: 2 })
        );
    });

    it('kind ריק על פריט מהשאילתה האישית — אישי לפי fallback נוכחות האדם (CONTRACT.md §2)', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({ personal: [makeItem(12, { start: '2026-03-03', end: '2026-03-04', kindIndex: null })] })
        });
        await load(result);
        expect(result.current.dayoff.absences[0].dayOffKind).toBe('personal');
    });

    it('kind לא-ריק שאינו תואם אף תווית מוגדרת — fallback + אזהרת drift', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({ personal: [makeItem(13, { start: '2026-03-03', end: '2026-03-04', kindIndex: 99 })] })
        });
        await load(result);
        expect(result.current.dayoff.absences[0].dayOffKind).toBe('personal');
        expect(logger.warn).toHaveBeenCalledWith(
            'useDayOffAbsences.loadAbsences',
            expect.stringContaining('settings drift'),
            expect.objectContaining({ count: 1 })
        );
    });
});

describe('useDayOffAbsences — מדיניות אישור (D2)', () => {

    const approvalItems = () => [
        makeItem(20, { start: '2026-03-02', end: '2026-03-02', approvalIndex: 10 }), // מאושר
        makeItem(21, { start: '2026-03-03', end: '2026-03-03', approvalIndex: 11 }), // ממתין
        makeItem(22, { start: '2026-03-04', end: '2026-03-04', approvalIndex: null }), // ריק = ממתין סמנטי
        makeItem(23, { start: '2026-03-05', end: '2026-03-05', approvalIndex: 12 })  // נדחה
    ];

    it('מדיניות כבויה: ממתין/מאושר/ריק נכללים בלי דגלים, אך נדחה מוחרג תמיד (תיקון D2, DEV-2)', async () => {
        const { result } = await setupHook({
            settings: { ...FULL_SETTINGS, dayOffApprovalRequired: false },
            respond: routeByQuery({ personal: approvalItems() })
        });
        await load(result);

        const absences = result.current.dayoff.absences;
        expect(absences).toHaveLength(3);
        expect(absences.map(a => a.id).sort()).toEqual(['dayoff_20', 'dayoff_21', 'dayoff_22']); // הנדחה (23) הוחרג גם כשהמדיניות כבויה
        expect(absences.every(a => a.isPending === false && a.isApproved === false)).toBe(true);
        // ה-label ID של האישור נחשף גם כשהמדיניות כבויה (לשימוש עתידי בתצוגה)
        expect(absences.find(a => a.id === 'dayoff_20').approvalLabelId).toBe('10');
    });

    it('מדיניות כבויה בלי מיפוי תוויות נדחה: אין יכולת החרגה — כל הפריטים מוצגים (דגרדציה מתועדת)', async () => {
        const { result } = await setupHook({
            settings: { ...FULL_SETTINGS, dayOffApprovalRequired: false, dayOffRejectedLabelIds: [] },
            respond: routeByQuery({ personal: approvalItems() })
        });
        await load(result);

        expect(result.current.dayoff.absences).toHaveLength(4);
    });

    it('מדיניות פעילה: מאושר מלא, ממתין/ריק חלול (isPending), נדחה מוחרג בשקט', async () => {
        const { result } = await setupHook({
            settings: { ...FULL_SETTINGS, dayOffApprovalRequired: true },
            respond: routeByQuery({ personal: approvalItems() })
        });
        await load(result);

        const absences = result.current.dayoff.absences;
        expect(absences.map(a => a.id).sort()).toEqual(['dayoff_20', 'dayoff_21', 'dayoff_22']); // הנדחה (23) הוחרג
        expect(absences.find(a => a.id === 'dayoff_20')).toMatchObject({ isApproved: true, isPending: false });
        expect(absences.find(a => a.id === 'dayoff_21')).toMatchObject({ isApproved: false, isPending: true });
        expect(absences.find(a => a.id === 'dayoff_22')).toMatchObject({ isApproved: false, isPending: true });
        // נדחה אינו אי-התאמה — אין רשומת שגיאה
        expect(logger.error).not.toHaveBeenCalledWith(
            'useDayOffAbsences.loadAbsences',
            expect.stringContaining('matched no configured set'),
            expect.anything()
        );
    });

    it('תווית אישור שאינה באף סט — הפריט מוחרג ונרשמת שגיאה מרוכזת אחת (CONTRACT.md §1 כלל 3)', async () => {
        const { result } = await setupHook({
            settings: { ...FULL_SETTINGS, dayOffApprovalRequired: true },
            respond: routeByQuery({
                personal: [
                    makeItem(24, { start: '2026-03-02', end: '2026-03-02', approvalIndex: 99 }),
                    makeItem(25, { start: '2026-03-03', end: '2026-03-03', approvalIndex: 98 }),
                    makeItem(26, { start: '2026-03-04', end: '2026-03-04', approvalIndex: 10 })
                ]
            })
        });
        await load(result);

        expect(result.current.dayoff.absences.map(a => a.id)).toEqual(['dayoff_26']);
        const mismatchCalls = logger.error.mock.calls.filter(
            ([module, message]) => module === 'useDayOffAbsences.loadAbsences' && message.includes('matched no configured set')
        );
        expect(mismatchCalls).toHaveLength(1); // רשומה מרוכזת אחת — לא שגיאה לכל פריט
        expect(mismatchCalls[0][2]).toBeInstanceOf(Error);
        expect(mismatchCalls[0][2].details).toMatchObject({ count: 2 });
    });

    it('דגלי האישור לא מחושבים לרשומות כלליות גם תחת מדיניות פעילה', async () => {
        const { result } = await setupHook({
            settings: { ...FULL_SETTINGS, dayOffApprovalRequired: true },
            respond: routeByQuery({ general: [makeGeneralItem(27, { name: 'חג', start: '2026-03-09', end: '2026-03-09' })] })
        });
        await load(result);
        expect(result.current.dayoff.absences[0]).toMatchObject({ dayOffKind: 'general', isPending: false, isApproved: false });
    });
});

describe('useDayOffAbsences — מודל העקביות (CONTRACT.md §7)', () => {

    it('קריאה חוזרת מחליפה את נתוני החלון — פריט שנמחק קשיחות נעלם', async () => {
        const firstLoad = routeByQuery({
            personal: [
                makeItem(30, { start: '2026-03-02', end: '2026-03-03' }),
                makeItem(31, { start: '2026-03-10', end: '2026-03-11' })
            ]
        });
        const { result, monday } = await setupHook({ respond: firstLoad });
        await load(result);
        expect(result.current.dayoff.absences).toHaveLength(2);

        // ביטול בקשה ב-Day-off = מחיקת הפריט מהלוח; הקריאה הבאה היא אות המחיקה היחיד
        monday.__setApiResponsesByOp({
            boards: routeByQuery({ personal: [makeItem(30, { start: '2026-03-02', end: '2026-03-03' })] })
        });
        await load(result);
        expect(result.current.dayoff.absences.map(a => a.id)).toEqual(['dayoff_30']);
    });

    it('clearAbsences מנקה את השכבה', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({ personal: [makeItem(32, { start: '2026-03-02', end: '2026-03-03' })] })
        });
        await load(result);
        expect(result.current.dayoff.absences).toHaveLength(1);

        act(() => {
            result.current.dayoff.clearAbsences();
        });
        expect(result.current.dayoff.absences).toEqual([]);
    });

    it('כיבוי showAbsences מנקה שכבה שכבר נטענה בקריאת הטעינה הבאה', async () => {
        const { result } = await setupHook({
            respond: routeByQuery({ personal: [makeItem(33, { start: '2026-03-02', end: '2026-03-03' })] })
        });
        await load(result);
        expect(result.current.dayoff.absences).toHaveLength(1);

        await act(async () => {
            await result.current.settings.updateSettings({ showAbsences: false });
        });
        await load(result);
        expect(result.current.dayoff.absences).toEqual([]);
    });
});
