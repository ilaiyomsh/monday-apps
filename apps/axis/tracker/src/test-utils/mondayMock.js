import { vi } from 'vitest';

/**
 * חילוץ שם פעולה משאילתת GraphQL.
 *
 * ניסיון 1: `mutation foo` / `query foo` (פעולה עם שם).
 * ניסיון 2: `query { foo { ... } }` או `query { foo(...) { ... } }` (השדה הראשון בתוך body).
 * ניסיון 3: `foo(...)` באמצע השאילתה (חלופה).
 *
 * משמש את matcher-ה-op-name של createMondayMock — מאפשר לטסטים למפות תגובה
 * לפי שם פעולה במקום substring שביר.
 *
 * @param {string} query
 * @returns {string|null}
 */
export function extractOperationName(query) {
    if (!query || typeof query !== 'string') return null;
    const named = query.match(/(?:mutation|query)\s+(\w+)/);
    if (named) return named[1];
    const firstField = query.match(/\{\s*(\w+)/);
    if (firstField) return firstField[1];
    const fnLike = query.match(/(\w+)\s*\(/);
    if (fnLike) return fnLike[1];
    return null;
}

/**
 * Mock של Monday SDK לטסטים.
 *
 * מספק גרסה הפיכה לחלוטין של monday-sdk-js עם תמיכה ב-context, listeners,
 * api responses, ו-storage (גם global וגם instance) בזיכרון. כל הקריאות
 * עוברות דרך vi.fn() כך שניתן לבחון אותן ב-toHaveBeenCalledWith.
 *
 * @param {object} [options]
 * @param {object} [options.context] קונטקסט התחלתי שיוחזר מ-get('context')
 * @param {object} [options.apiResponses] map של "מחרוזת בשאילתה" → response.
 *   ההתאמה היא substring על הquery — הקריאה הראשונה שמכילה את המפתח מנצחת.
 * @param {object} [options.apiResponsesByOp] map של "שם פעולה" → response.
 *   נבדק לפני apiResponses (מדויק יותר; substring שביר ל-pagination).
 *   המפתח חייב להיות שווה ל-extractOperationName(query).
 * @param {object} [options.storage] seed ראשוני לאחסון הגלובלי
 * @param {object} [options.instanceStorage] seed ראשוני לאחסון ה-instance
 */
export function createMondayMock({
    context = {},
    apiResponses = {},
    apiResponsesByOp = {},
    storage = {},
    instanceStorage = {}
} = {}) {
    let contextData = { ...context };
    const listeners = { context: [] };
    const memStorage = { ...storage };
    const memInstance = { ...instanceStorage };
    // ניתן להחלפה דינמית בזמן ריצה דרך __setApiResponses / __setApiResponsesByOp.
    let opMap = { ...apiResponsesByOp };
    let subMap = { ...apiResponses };

    const mock = {
        get: vi.fn(async (key) => {
            if (key === 'context') return { data: contextData };
            if (key === 'settings') return { data: {} };
            return { data: null };
        }),

        listen: vi.fn((event, cb) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
            return () => {
                listeners[event] = listeners[event].filter(c => c !== cb);
            };
        }),

        api: vi.fn(async (query, variables) => {
            // 1) op-name match — מדויק, עדיף על substring
            const opName = extractOperationName(query);
            if (opName && Object.prototype.hasOwnProperty.call(opMap, opName)) {
                const response = opMap[opName];
                return typeof response === 'function' ? response(query, variables) : response;
            }
            // 2) substring fallback — תאימות לאחור עם טסטים קיימים
            for (const [key, response] of Object.entries(subMap)) {
                if (typeof query === 'string' && query.includes(key)) {
                    return typeof response === 'function' ? response(query, variables) : response;
                }
            }
            return { data: {} };
        }),

        storage: {
            getItem: vi.fn(async (key) => ({
                data: { value: memStorage[key] ?? null, success: true }
            })),
            setItem: vi.fn(async (key, value) => {
                memStorage[key] = value;
                return { data: { success: true } };
            }),
            deleteItem: vi.fn(async (key) => {
                delete memStorage[key];
                return { data: { success: true } };
            }),
            instance: {
                getItem: vi.fn(async (key) => ({
                    data: { value: memInstance[key] ?? null, success: true }
                })),
                setItem: vi.fn(async (key, value) => {
                    memInstance[key] = value;
                    return { data: { success: true } };
                }),
                deleteItem: vi.fn(async (key) => {
                    delete memInstance[key];
                    return { data: { success: true } };
                })
            }
        },

        execute: vi.fn(async () => ({ data: {} })),

        // עזרי בדיקה — לא חלק מ-SDK האמיתי
        __emitContext: (data) => {
            contextData = { ...contextData, ...data };
            for (const cb of listeners.context) {
                cb({ data: contextData });
            }
        },
        __getStorage: () => ({ ...memStorage }),
        __getInstanceStorage: () => ({ ...memInstance }),
        // seed סינכרוני — בשימוש ע"י renderWithProviders כדי להימנע
        // מהסתמכות על ה-side-effect הסינכרוני של setItem האסינכרוני.
        __seedStorage: (key, value) => { memStorage[key] = value; },
        __seedInstanceStorage: (key, value) => { memInstance[key] = value; },
        // עדכון תגובות API לאחר יצירת ה-mock — שימושי לטסטים שמחליפים תגובה אחרי setup
        __setApiResponses: (next) => { subMap = { ...next }; },
        __setApiResponsesByOp: (next) => { opMap = { ...next }; },
        __mergeApiResponsesByOp: (next) => { opMap = { ...opMap, ...next }; }
    };

    return mock;
}

/**
 * Factory: תגובה ל-fetchAllBoardItems / קריאות items_page paginated.
 * חיוני: cursor חייב להיות null בעמוד הראשון אחרת ה-pagination לא מסתיימת
 * וה-test תקוע לנצח.
 *
 * @param {object} options
 * @param {number} options.boardId
 * @param {Array} [options.items] רשימת items עם { id, name, column_values }
 */
export function mockBoardWithItems({ boardId, items = [] } = {}) {
    return {
        data: {
            boards: [
                {
                    id: String(boardId),
                    items_page: {
                        cursor: null,
                        items
                    }
                }
            ]
        }
    };
}

/**
 * Factory: תגובה ריקה לשאילתת אירועים (useMondayEvents).
 * cursor: null — חיוני לעצירת pagination.
 *
 * @param {number} [boardId]
 */
export function mockEmptyEventsResponse({ boardId = 1 } = {}) {
    return mockBoardWithItems({ boardId, items: [] });
}

/**
 * Factory: תגובה ל-fetchProjectsForUser.
 *
 * @param {object} options
 * @param {number} options.boardId — מזהה הלוח של הפרויקטים
 * @param {Array<{id:string,name:string}>} [options.projects]
 */
export function mockProjectsResponse({ boardId, projects = [] } = {}) {
    return {
        data: {
            boards: [
                {
                    id: String(boardId),
                    items_page: {
                        cursor: null,
                        items: projects.map(p => ({
                            id: String(p.id),
                            name: p.name,
                            column_values: p.column_values || []
                        }))
                    }
                }
            ]
        }
    };
}

/**
 * Factory: תגובה ל-fetchUniquePeopleFromBoard / רשימת מדווחים לפילטר.
 *
 * @param {object} options
 * @param {number} options.boardId
 * @param {Array<{id:string,name:string}>} [options.reporters]
 */
export function mockReportersResponse({ boardId, reporters = [] } = {}) {
    // הפורמט הסטנדרטי של people column: items עם column_values שמכילים value JSON
    return {
        data: {
            boards: [
                {
                    id: String(boardId),
                    items_page: {
                        cursor: null,
                        items: reporters.map(r => ({
                            id: String(r.id),
                            name: r.name,
                            column_values: [
                                {
                                    id: 'people',
                                    value: JSON.stringify({
                                        personsAndTeams: [
                                            { id: Number(r.id), kind: 'person' }
                                        ]
                                    }),
                                    text: r.name
                                }
                            ]
                        }))
                    }
                }
            ]
        }
    };
}

export default createMondayMock;
