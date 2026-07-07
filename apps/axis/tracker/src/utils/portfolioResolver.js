// portfolioResolver — לוגיקה שמופיעה רק במצב Portfolio.
//
// במצב 'portfolio' לוח הפרויקטים (`connectedBoardId`) הוא בעצם לוח Portfolio של monday —
// לוח classic עם עמודות `portfolio_project_*` ועמודת `portfolio_project_link`
// מסוג `board_relation` בעלת `settings.type === "hierarchy"`. עמודה זו מקשרת
// כל פריט-פרויקט (item בפורטפוליו) ללוח Project (multi_level) משלו שבו יושבות
// המשימות. לכן `tasksBoardId` הגלובלי לא רלוונטי במצב Portfolio — הוא נפתר
// לפר פרויקט מתוך אותה עמודה.
//
// המודול חושף:
//   - isPortfolioMode(settings) — בדיקה פשוטה של ה-toggle.
//   - getProjectsBoardId(settings) — מצביע יחיד לזיהוי לוח הפרויקטים/פורטפוליו.
//   - resolveTasksBoardId(monday, projectItemId) — async, ממוחזר בזיכרון.
//   - clearTasksBoardCache() — לאיפוס המטמון בעת שינוי הגדרות.
//   - isPortfolioBoard(monday, boardId) — וולידציה: האם לוח נתון הוא Portfolio.

import logger from './logger';
import { safeApi } from './mondayApi/client.js';

// מטמון בזיכרון לכתובת לוח-המשימות של כל פריט פורטפוליו
const tasksBoardCache = new Map();

/**
 * האם ההגדרות הנוכחיות פועלות במצב Portfolio.
 * @param {object} settings
 * @returns {boolean}
 */
export const isPortfolioMode = (settings) =>
    settings?.projectsSourceMode === 'portfolio';

/**
 * מזהה הלוח שממנו נטענים פרויקטים. במצב 'board' זה לוח פרויקטים קלאסי,
 * במצב 'portfolio' זה לוח ה-Portfolio. המעטפת קיימת כנקודת התרחבות עתידית
 * (למשל אם פעם נרצה לאחסן `portfolioBoardId` בנפרד).
 * @param {object} settings
 * @returns {string|null}
 */
export const getProjectsBoardId = (settings) =>
    settings?.connectedBoardId ?? null;

/**
 * פתרון מזהה לוח-המשימות (multi_level) של פריט פורטפוליו ספציפי.
 *
 * הקריאה: items(ids:[projectItemId]).column_values(ids:["portfolio_project_link"])
 * → BoardRelationValue.linked_items[0].board.id
 *
 * הערה: כל ה-linked_items של פריט-פורטפוליו יושבים על אותו לוח (Project board),
 * אז מספיק לקחת את הראשון.
 *
 * תוצאות ממוחזרות לפי projectItemId; לאיפוס יש לקרוא ל-clearTasksBoardCache.
 *
 * @param {object} monday - Monday SDK instance
 * @param {string|number} projectItemId - מזהה פריט הפורטפוליו (הפרויקט)
 * @returns {Promise<string|null>} מזהה לוח המשימות, או null אם אין linked items
 */
export const resolveTasksBoardId = async (monday, projectItemId) => {
    if (!projectItemId) return null;

    const cacheKey = String(projectItemId);
    if (tasksBoardCache.has(cacheKey)) {
        return tasksBoardCache.get(cacheKey);
    }

    const query = `query {
        items(ids: [${projectItemId}]) {
            column_values(ids: ["portfolio_project_link"]) {
                ... on BoardRelationValue {
                    linked_items {
                        board { id }
                    }
                }
            }
        }
    }`;

    try {
        const response = await safeApi(monday, 'resolveTasksBoardId', query);
        const linkedItems = response.data?.items?.[0]?.column_values?.[0]?.linked_items || [];
        const boardId = linkedItems[0]?.board?.id ?? null;
        tasksBoardCache.set(cacheKey, boardId);
        return boardId;
    } catch (error) {
        logger.error('portfolioResolver', 'Failed to resolve tasks board id', error);
        return null;
    }
};

/**
 * איפוס מטמון פתרון לוחות-המשימות. לקרוא בעת שינוי הגדרות (החלפת פורטפוליו /
 * החלפת projectsSourceMode) כדי למנוע שימוש בנתונים מיושנים.
 */
export const clearTasksBoardCache = () => {
    tasksBoardCache.clear();
};

/**
 * וולידציה: האם לוח נתון הוא לוח Portfolio?
 * זיהוי על-פי קיום עמודת `portfolio_project_link` מסוג board_relation
 * עם `settings.type === "hierarchy"`. בנוסף, חושף את boardIds כדי לדעת
 * אם מחוברים פרויקטים בכלל.
 *
 * @param {object} monday
 * @param {string|number} boardId
 * @returns {Promise<{isPortfolio: boolean, hasProjects: boolean, projectBoardIds: number[]}>}
 */
export const isPortfolioBoard = async (monday, boardId) => {
    if (!boardId) return { isPortfolio: false, hasProjects: false, projectBoardIds: [] };

    const query = `query {
        boards(ids: [${boardId}]) {
            columns(ids: ["portfolio_project_link"]) {
                id
                type
                settings
            }
        }
    }`;

    try {
        const response = await safeApi(monday, 'isPortfolioBoard', query);
        const column = response.data?.boards?.[0]?.columns?.[0];
        if (!column || column.type !== 'board_relation') {
            return { isPortfolio: false, hasProjects: false, projectBoardIds: [] };
        }

        const rawSettings = column.settings;
        const settings = typeof rawSettings === 'string'
            ? JSON.parse(rawSettings || '{}')
            : (rawSettings || {});

        const isPortfolio = settings.type === 'hierarchy';
        const projectBoardIds = Array.isArray(settings.boardIds) ? settings.boardIds : [];

        return {
            isPortfolio,
            hasProjects: isPortfolio && projectBoardIds.length > 0,
            projectBoardIds,
        };
    } catch (error) {
        logger.error('portfolioResolver', 'Failed to validate portfolio board', error);
        return { isPortfolio: false, hasProjects: false, projectBoardIds: [] };
    }
};
