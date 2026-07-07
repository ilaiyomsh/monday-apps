// מודול boards — fetchers ברמת לוח (board-level) שלא משתייכים ל-items / columns / mirror.
//
// יוצא מ-client.js במסגרת Wave 4.1.3:
//   - fetchConnectedBoardsFromColumn — קורא את הגדרות עמודת Connect Boards
//     ושולף את הלוחות המקושרים (id + שם).
//   - fetchUniquePeopleFromBoard — מאסף את כל ה-persons הייחודיים מתוך
//     עמודת People בלוח (לטובת רכיבי FilterBar וכד').
//
// הערה: createBoardWithColumns לא נמצא כאן — הוא הועבר ב-Wave 4.1.2 ל-columns.js
// יחד עם createColumn כדי למנוע מחזור-יבוא בין client.js ל-columns.js
// (פירוט מלא ב-ANALYSIS.md F007 wave 4.1.2).
//
// תלות: logger מ-utils peer; safeApi מ-./client (לא דרך הבארל,
// כדי למנוע מחזור-יבוא דרך index.js).

import logger from '../logger';
import { safeApi } from './client.js';

/**
 * שליפת הגדרות עמודת Connect Boards לזיהוי הלוחות המקושרים
 * @param {Object} monday - Monday SDK instance
 * @param {string} boardId - מזהה הלוח
 * @param {string} columnId - מזהה העמודה
 * @returns {Promise<Array<{id: string, name: string}>>} רשימת הלוחות המקושרים
 */
export const fetchConnectedBoardsFromColumn = async (monday, boardId, columnId) => {
    logger.functionStart('fetchConnectedBoardsFromColumn', { boardId, columnId });

    const query = `query {
        boards(ids: [${boardId}]) {
            columns(ids: ["${columnId}"]) {
                settings
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchConnectedBoardsFromColumn', query);
    const rawSettings = response.data?.boards?.[0]?.columns?.[0]?.settings;

    if (!rawSettings) {
        logger.warn('fetchConnectedBoardsFromColumn', 'No settings found for column');
        return [];
    }

    try {
        const settings = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;
        const boardIds = settings.boardIds || [];

        if (boardIds.length === 0) {
            logger.warn('fetchConnectedBoardsFromColumn', 'No connected boards found');
            return [];
        }

        // שליפת שמות הלוחות
        const boardsQuery = `query {
            boards(ids: [${boardIds.join(',')}]) {
                id
                name
            }
        }`;

        const boardsResponse = await safeApi(monday, 'fetchConnectedBoardsFromColumn:boards', boardsQuery);
        const boards = boardsResponse.data?.boards || [];

        logger.functionEnd('fetchConnectedBoardsFromColumn', { boardsCount: boards.length });
        return boards.map(b => ({ id: b.id, name: b.name }));
    } catch (error) {
        logger.error('fetchConnectedBoardsFromColumn', 'Error parsing settings', error);
        return [];
    }
};

/**
 * שליפת כל האנשים הייחודיים מעמודת People בלוח
 * @param {Object} monday - Monday SDK instance
 * @param {string} boardId - מזהה הלוח
 * @param {string} columnId - מזהה עמודת ה-People
 * @returns {Promise<Array<{id: string, name: string}>>} רשימת האנשים הייחודיים
 */
export const fetchUniquePeopleFromBoard = async (monday, boardId, columnId) => {
    logger.functionStart('fetchUniquePeopleFromBoard', { boardId, columnId });

    const query = `query {
        boards(ids: [${boardId}]) {
            items_page(limit: 500) {
                cursor
                items {
                    column_values(ids: ["${columnId}"]) {
                        ... on PeopleValue {
                            persons_and_teams {
                                id
                                kind
                            }
                        }
                    }
                }
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchUniquePeopleFromBoard', query);
    const items = response.data?.boards?.[0]?.items_page?.items || [];

    // איסוף מזהי אנשים ייחודיים (רק persons, לא teams)
    const personIds = new Set();
    items.forEach(item => {
        const peopleValue = item.column_values?.[0];
        const personsAndTeams = peopleValue?.persons_and_teams || [];
        personsAndTeams.forEach(p => {
            if (p.kind === 'person') {
                personIds.add(p.id);
            }
        });
    });

    if (personIds.size === 0) {
        logger.warn('fetchUniquePeopleFromBoard', 'No people found in column');
        return [];
    }

    // שליפת פרטי המשתמשים
    const userIds = Array.from(personIds);
    const usersQuery = `query {
        users(ids: [${userIds.join(',')}]) {
            id
            name
        }
    }`;

    const usersResponse = await safeApi(monday, 'fetchUniquePeopleFromBoard:users', usersQuery);
    const users = usersResponse.data?.users || [];

    logger.functionEnd('fetchUniquePeopleFromBoard', { uniquePeopleCount: users.length });
    return users.map(u => ({ id: u.id, name: u.name }));
};
