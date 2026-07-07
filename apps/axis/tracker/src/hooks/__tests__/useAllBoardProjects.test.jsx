/**
 * בדיקת unit ל-Phase 0 — מצב direct ב-useAllBoardProjects.
 *
 * הרגרסיה שנסגרה (באג writeCache/cacheKey): שליפת direct-board מוצלחת
 * חייבת לאכלס projects, לא לאפס אותם, לא להציב error, ולכתוב את ה-cache
 * דרך saveToStorage בדיוק במבנה ש-loadFromStorage מצפה לקרוא ({ signature, projects, ts }).
 *
 * החוזה הנבדק:
 *  (א) הצלחה → projects מאוכלסים (לא מאופסים), error נשאר null.
 *  (ב) saveToStorage נכתב ב-monday.storage עם payload שה-reader (loadFromStorage)
 *      מצפה לו — { signature, projects, ts } — וניתן לקריאה חזרה.
 *  (ג) לא מתרחש ReferenceError (cacheKey/writeCache שאינם מוגדרים).
 *
 * הערה: useAllBoardProjects לוכד monday דרך mondaySdk() ברמת המודול (singleton)
 * בזמן ה-import, ולא דרך ה-prop של ה-provider. לכן בונים את ה-mock ב-vi.hoisted
 * (רץ לפני ה-import-ים) וממקים את monday-sdk-js שיחזיר בדיוק את אותו instance,
 * כך ש-monday.storage (קריאה/כתיבה של ה-cache) משותף עם הפרובידרים.
 * safeApi ממוקה ישירות (אין צורך בשרת GraphQL).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useAllBoardProjects } from '../useAllBoardProjects';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import { safeApi } from '../../utils/mondayApi';

const CONNECTED_BOARD_ID = '777';
const INSTANCE_ID = 'inst-1';
const TEST_CONTEXT = { boardId: 2002, instanceId: INSTANCE_ID, user: { id: '7', name: 'בודק' } };

// בונים mock יחיד בזמן hoist — חייב להיות מוכן לפני שמודול useAllBoardProjects
// קורא ל-mondaySdk() ברמת המודול ולוכד את ה-monday.
const { sharedMonday } = vi.hoisted(() => {
    const memStorage = {};
    const listeners = { context: [] };
    let contextData = {};
    const fn = (impl) => {
        let current = impl;
        const f = (...args) => { f.mock.calls.push(args); return current ? current(...args) : undefined; };
        f.mock = { calls: [] };
        f.mockImplementation = (next) => { current = next; return f; };
        return f;
    };
    const mock = {
        get: fn(async (key) => {
            if (key === 'context') return { data: contextData };
            if (key === 'settings') return { data: {} };
            if (key === 'filter') return { data: null };
            return { data: null };
        }),
        listen: fn((event, cb) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
            return () => { listeners[event] = listeners[event].filter((c) => c !== cb); };
        }),
        api: fn(async () => ({ data: {} })),
        storage: {
            getItem: fn(async (key) => ({ data: { value: memStorage[key] ?? null, success: true } })),
            setItem: fn(async (key, value) => { memStorage[key] = value; return { data: { success: true } }; }),
            deleteItem: fn(async (key) => { delete memStorage[key]; return { data: { success: true } }; }),
            instance: {
                getItem: fn(async () => ({ data: { value: null, success: true } })),
                setItem: fn(async () => ({ data: { success: true } })),
                deleteItem: fn(async () => ({ data: { success: true } })),
            },
        },
        execute: fn(async () => ({ data: {} })),
        __setContext: (c) => { contextData = { ...c }; },
        __seedStorage: (key, value) => { memStorage[key] = value; },
        __resetStorage: () => { for (const k of Object.keys(memStorage)) delete memStorage[k]; },
        __resetCalls: () => {
            const reset = (o) => { for (const v of Object.values(o)) { if (v?.mock) v.mock.calls = []; else if (v && typeof v === 'object') reset(v); } };
            reset(mock);
        },
    };
    return { sharedMonday: mock };
});

vi.mock('monday-sdk-js', () => ({ default: () => sharedMonday }));
vi.mock('../../utils/mondayApi', () => ({ safeApi: vi.fn() }));

// מצב direct: useAssignmentsMode=false, יש connectedBoardId, ללא סינון סטטוס.
const TEST_SETTINGS = {
    useAssignmentsMode: false,
    connectedBoardId: CONNECTED_BOARD_ID,
    projectsSourceMode: 'board',
    projectStatusFilterEnabled: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

// תגובת direct-board מוצלחת — עמוד יחיד (cursor:null עוצר pagination).
const BOARD_RESPONSE = {
    data: {
        boards: [{
            id: CONNECTED_BOARD_ID,
            items_page: {
                cursor: null,
                items: [
                    { id: 101, name: 'פרויקט א' },
                    { id: 102, name: 'פרויקט ב' }
                ]
            }
        }]
    }
};

const EXPECTED_PROJECTS = [
    { id: '101', name: 'פרויקט א' },
    { id: '102', name: 'פרויקט ב' }
];

describe('useAllBoardProjects — direct mode (Phase 0)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sharedMonday.__resetStorage();
        sharedMonday.__resetCalls();
        sharedMonday.__setContext(TEST_CONTEXT);
        // SettingsProvider טוען את ההגדרות מ-monday.storage תחת customSettings_<instanceId>.
        sharedMonday.__seedStorage(`customSettings_${INSTANCE_ID}`, JSON.stringify(TEST_SETTINGS));
        safeApi.mockResolvedValue(BOARD_RESPONSE);
    });

    function setupHook() {
        // initialSettings מושמט — ה-seed כבר ב-sharedMonday; initialContext לא נחוץ
        // (ה-context מגיע מ-__setContext על אותו mock), אך מועבר לעקביות עם שאר ה-hooks.
        const { result } = renderHookWithProviders(
            () => useAllBoardProjects(),
            { monday: sharedMonday, initialContext: TEST_CONTEXT }
        );
        return result;
    }

    it('(א) הצלחה → projects מאוכלסים ולא מאופסים, error נשאר null', async () => {
        const result = setupHook();

        await waitFor(() => {
            expect(result.current.projects).toHaveLength(2);
        });

        expect(result.current.projects).toEqual(EXPECTED_PROJECTS);
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('(ב) saveToStorage נכתב כ-{ signature, projects, ts } שה-reader מצפה לו', async () => {
        const result = setupHook();

        await waitFor(() => {
            expect(result.current.projects).toHaveLength(2);
        });

        // ה-cache נכתב תחת המפתח projectsListCache_<instanceId>.
        // saveToStorage היא fire-and-forget — ממתינים שהכתיבה תירשם.
        const cacheKey = `projectsListCache_${INSTANCE_ID}`;
        let setItemCall;
        await waitFor(() => {
            setItemCall = sharedMonday.storage.setItem.mock.calls.find(([key]) => key === cacheKey);
            expect(setItemCall).toBeTruthy();
        });

        // ה-payload נשמר כ-JSON.stringify — מפענחים ומאמתים את הצורה ש-loadFromStorage קורא.
        const savedPayload = JSON.parse(setItemCall[1]);
        expect(savedPayload).toHaveProperty('signature');
        expect(typeof savedPayload.signature).toBe('string');
        expect(savedPayload).toHaveProperty('ts');
        expect(typeof savedPayload.ts).toBe('number');
        expect(Array.isArray(savedPayload.projects)).toBe(true);
        expect(savedPayload.projects).toEqual(EXPECTED_PROJECTS);

        // אימות תאימות reader→writer: ב-loadFromStorage cache תקף דורש projects.length>0.
        expect(savedPayload.projects.length).toBeGreaterThan(0);
    });

    it('(ג) לא מתרחש ReferenceError (cacheKey/writeCache לא מוגדרים) בנתיב ההצלחה', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const result = setupHook();
            await waitFor(() => {
                expect(result.current.projects).toHaveLength(2);
            });
            // אם היה ReferenceError ב-fetchAll, ה-catch היה מציב error והפרויקטים היו מתאפסים.
            expect(result.current.error).toBeNull();
            expect(result.current.projects).toHaveLength(2);
        } finally {
            consoleError.mockRestore();
        }
    });
});
