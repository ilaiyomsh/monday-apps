// מודול items — fetchers/mutations ברמת אייטם בודד או אוסף אייטמים בלוח.
//
// יוצא מ-client.js במסגרת Wave 4.1.4. אחרי Wave 4.1.5 כל הקריאות עברו ל-safeApi
// ו-wrapMondayApiCall נמחקה — client.js נותר רק עם תשתית הריצה (safeApi /
// executeWithRetry / MondayApiError / validateQuery + helpers).
//
// תלות: logger מ-utils peer; safeApi מ-./client (לא דרך הבארל, כדי למנוע
// מחזור-יבוא דרך index.js); escapeGraphQLString לבניית שמות עם תווים מיוחדים.
// אין ייבוא מ-peers items/boards/columns/mirror.
//
// הערה: parseTimeString הוא helper טהור (אין קריאת API). הוא מתארח כאן
// משיקולי קוהרנטיות היסטורית (מקור משותף ב-mondayApi.js); לחלופין היה אפשר
// להעבירו ל-utils/parsing.js. נשמר כאן כדי לא להיוולד קובץ סוב-100-LOC עבור
// helper יחיד — ראו "Judgment calls" ב-ANALYSIS.md F007 wave 4.1.4.

import logger from '../logger';
import { escapeGraphQLString } from '../graphqlUtils';
import { safeApi } from './client.js';
import { assertNoGraphQLErrors } from './assertGraphQL.js';

// פונקציה להמרת מחרוזת שעה (HH:MM) לאובייקט Date
export const parseTimeString = (timeString) => {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(':').map(Number);
    return new Date(1970, 1, 1, hours, minutes, 0);
};

// אחזור כל האייטמים מלוח עם pagination
export const fetchAllBoardItems = async (monday, boardId) => {
    logger.functionStart('fetchAllBoardItems', { boardId });

    let allItems = [];
    let cursor = null;
    let pageCount = 0;

    // קריאה ראשונה
    const firstQuery = `query {
        boards(ids: [${boardId}]) {
            items_page (limit:100){
                cursor
                items{
                    name
                    id
                }
            }
        }
    }`;

    const firstResponse = await safeApi(monday, 'fetchAllBoardItems', firstQuery);
    const itemsPage = firstResponse.data?.boards?.[0]?.items_page;

    if (itemsPage) {
        allItems = allItems.concat(itemsPage.items);
        cursor = itemsPage.cursor;
        pageCount++;
        logger.debug('fetchAllBoardItems', `Page ${pageCount}: Fetched ${itemsPage.items.length} items`);
    }

    // קריאות המשך
    while (cursor) {
        const nextQuery = `query {
            next_items_page (cursor: "${cursor}", limit:100){
                cursor
                items{
                    name
                    id
                }
            }
        }`;

        const nextResponse = await safeApi(monday, `fetchAllBoardItems (page ${pageCount + 1})`, nextQuery);
        const nextPage = nextResponse.data?.next_items_page;

        if (nextPage && nextPage.items) {
            allItems = allItems.concat(nextPage.items);
            cursor = nextPage.cursor;
            pageCount++;
            logger.debug('fetchAllBoardItems', `Page ${pageCount}: Fetched ${nextPage.items.length} items`);
        } else {
            cursor = null;
        }
    }

    logger.functionEnd('fetchAllBoardItems', { totalItems: allItems.length, pages: pageCount });

    // המרה לפורמט Combobox
    return allItems.map(item => ({
        value: item.id,
        label: item.name
    }));
};

// יצירת אייטם חדש בלוח עם ערכי עמודות
export const createBoardItem = async (monday, boardId, itemName, columnValues = null) => {
    logger.functionStart('createBoardItem', { boardId, itemName, hasColumnValues: !!columnValues });

    const query = `mutation create_item($boardId: ID!, $itemName: String!, $columnValues: JSON) {
        create_item (
            board_id: $boardId,
            item_name: $itemName,
            column_values: $columnValues
        ) {
            id
            name
        }
    }`;

    let formattedColumnValues = null;
    if (columnValues) {
        formattedColumnValues = typeof columnValues === 'string' ? columnValues : JSON.stringify(columnValues);
    }

    const variables = { boardId: parseInt(boardId), itemName, columnValues: formattedColumnValues };
    const response = await safeApi(monday, 'createBoardItem', query, { variables });
    // GraphQL soft-error ≠ הצלחה — זורק MondayApiError (ה-soft-error כבר נרשם ב-safeApi)
    assertNoGraphQLErrors(response, { functionName: 'createBoardItem', query, variables });
    logger.functionEnd('createBoardItem', { item: response.data?.create_item });
    return response.data?.create_item;
};

// שליפת אירועים מהלוח בטווח תאריכים
export const fetchEventsFromBoard = async (monday, query) => {
    logger.functionStart('fetchEventsFromBoard');
    const response = await safeApi(monday, 'fetchEventsFromBoard', query);
    const items = response.data?.boards?.[0]?.items_page?.items || [];
    logger.functionEnd('fetchEventsFromBoard', { count: items.length });
    return items;
};

// אחזור פרויקטים המשויכים למשתמש
export const fetchProjectsForUser = async (monday, boardId, peopleColumnIds) => {
    const columnIds = Array.isArray(peopleColumnIds) ? peopleColumnIds : (peopleColumnIds ? [peopleColumnIds] : []);
    logger.functionStart('fetchProjectsForUser', { boardId, peopleColumnIds: columnIds });

    if (columnIds.length === 0) {
        logger.warn('fetchProjectsForUser', 'No people column IDs provided');
        return [];
    }

    const rules = columnIds.map(columnId => ({
        column_id: columnId,
        compare_value: ["assigned_to_me"],
        operator: "any_of"
    }));

    const rulesGraphQL = rules.map(rule =>
        `{
            column_id: "${rule.column_id}",
            compare_value: ${JSON.stringify(rule.compare_value)},
            operator: ${rule.operator}
        }`
    ).join(',\n');

    const operator = columnIds.length > 1 ? 'or' : 'and';
    const query = `query {
        boards(ids: ${boardId}) {
            items_page(
                query_params: {
                    operator: ${operator},
                    rules: [${rulesGraphQL}]
                }
            ) {
                items {
                    id
                    name
                }
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchProjectsForUser', query);
    const items = response.data?.boards?.[0]?.items_page?.items || [];
    logger.functionEnd('fetchProjectsForUser', { count: items.length });
    return items;
};

// מציאת עמודת Connected Board בלוח המשימות שמקשרת ללוח הפרויקטים
export const findProjectLinkColumn = async (monday, tasksBoardId, projectBoardId) => {
    if (!tasksBoardId || !projectBoardId) return null;
    logger.functionStart('findProjectLinkColumn', { tasksBoardId, projectBoardId });

    const query = `query {
        boards(ids: [${tasksBoardId}]) {
            columns {
                id
                type
                settings
            }
        }
    }`;

    const response = await safeApi(monday, 'findProjectLinkColumn', query);
    const columns = response.data?.boards?.[0]?.columns || [];

    for (const col of columns) {
        if (col.type === 'board_relation') {
            try {
                const raw = col.settings;
                const colSettings = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
                const boardIds = (colSettings.boardIds || []).map(String);
                if (boardIds.includes(String(projectBoardId))) {
                    logger.functionEnd('findProjectLinkColumn', { columnId: col.id });
                    return col.id;
                }
            } catch (error) {
                // settings פגום בעמודה בודדת — מדלגים אליה וממשיכים לשאר העמודות
                logger.warn('findProjectLinkColumn', 'Failed to parse board_relation column settings, skipping column', { columnId: col.id, error });
                continue;
            }
        }
    }
    logger.warn('findProjectLinkColumn', 'Could not find project link column in tasks board');
    return null;
};

// יצירת משימה חדשה
export const createTask = async (monday, tasksBoardId, projectBoardId, projectId, taskName) => {
    logger.functionStart('createTask', { tasksBoardId, projectBoardId, projectId, taskName });

    const projectLinkColumnId = await findProjectLinkColumn(monday, tasksBoardId, projectBoardId);
    if (!projectLinkColumnId) {
        logger.warn('createTask', 'Could not find project link column in tasks board');
        return null;
    }

    const columnValues = JSON.stringify({
        [projectLinkColumnId]: { item_ids: [parseInt(projectId)] }
    });

    const mutation = `mutation {
        create_item(
            board_id: ${tasksBoardId},
            item_name: "${escapeGraphQLString(taskName)}",
            column_values: ${JSON.stringify(columnValues)}
        ) {
            id
            name
        }
    }`;

    const response = await safeApi(monday, 'createTask', mutation);
    logger.functionEnd('createTask', { task: response.data?.create_item });
    return response.data?.create_item;
};

// עדכון ערכי עמודות באייטם
export const updateItemColumnValues = async (monday, boardId, itemId, columnValues) => {
    logger.functionStart('updateItemColumnValues', { boardId, itemId });

    const mutation = `mutation {
        change_multiple_column_values(
            item_id: ${itemId},
            board_id: ${boardId},
            column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) {
            id
        }
    }`;

    const response = await safeApi(monday, 'updateItemColumnValues', mutation);
    // GraphQL soft-error ≠ הצלחה — זורק MondayApiError (ה-soft-error כבר נרשם ב-safeApi)
    assertNoGraphQLErrors(response, { functionName: 'updateItemColumnValues', query: mutation });
    logger.functionEnd('updateItemColumnValues', { success: !!response.data });
    return response.data;
};

// אחזור פרטי המשתמש הנוכחי
export const fetchCurrentUser = async (monday) => {
    logger.functionStart('fetchCurrentUser');
    const query = `query { me { name id } }`;
    const response = await safeApi(monday, 'fetchCurrentUser', query);
    const user = response.data?.me;
    logger.functionEnd('fetchCurrentUser', { hasUser: !!user });
    return user;
};

// אחזור אייטם בודד לפי ID
export const fetchItemById = async (monday, boardId, itemId) => {
    logger.functionStart('fetchItemById', { boardId, itemId });

    const query = `query {
        items(ids: [${itemId}]) {
            id
            name
            column_values {
                id
                value
                type
                ... on DateValue {
                    date
                    time
                }
                ... on BoardRelationValue {
                    value
                    linked_items {
                        name
                        id
                    }
                }
                ... on TextValue {
                    text
                }
                ... on StatusValue {
                    index
                    label
                    text
                    label_style {
                        color
                    }
                }
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchItemById', query);
    const items = response.data?.items || [];
    const item = items.length > 0 ? items[0] : null;
    logger.functionEnd('fetchItemById', { found: !!item });
    return item;
};

// אחזור פרויקט בודד לפי ID
export const fetchProjectById = async (monday, boardId, projectId) => {
    logger.functionStart('fetchProjectById', { boardId, projectId });

    const query = `query {
        items(ids: [${projectId}]) {
            id
            name
        }
    }`;

    const response = await safeApi(monday, 'fetchProjectById', query);
    const items = response.data?.items || [];
    const project = items.length > 0 ? { id: items[0].id, name: items[0].name } : null;
    logger.functionEnd('fetchProjectById', { found: !!project });
    return project;
};

export const deleteItem = async (monday, itemId) => {
    logger.functionStart('deleteItem', { itemId });
    const mutation = `mutation { delete_item(item_id: ${itemId}) { id } }`;
    const response = await safeApi(monday, 'deleteItem', mutation);
    // GraphQL soft-error ≠ הצלחה — זורק MondayApiError (ה-soft-error כבר נרשם ב-safeApi)
    assertNoGraphQLErrors(response, { functionName: 'deleteItem', query: mutation });
    logger.functionEnd('deleteItem', { success: !!response.data });
    return response.data;
};

/**
 * שליפת ערכי סטטוס עבור רשימת אייטמים
 * @param {object} monday - Monday SDK instance
 * @param {string[]} itemIds - רשימת מזהי אייטמים
 * @param {string} statusColumnId - מזהה עמודת הסטטוס
 * @returns {Promise<Map<string, string>>} - מפה של itemId -> statusLabel
 */
export const fetchItemsStatus = async (monday, itemIds, statusColumnId, { useIndex = false } = {}) => {
    if (!itemIds || itemIds.length === 0 || !statusColumnId) {
        return new Map();
    }

    logger.functionStart('fetchItemsStatus', { itemCount: itemIds.length, statusColumnId, useIndex });

    const query = `query {
        items(ids: [${itemIds.join(',')}]) {
            id
            column_values(ids: ["${statusColumnId}"]) {
                id
                text
                ... on StatusValue { index }
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchItemsStatus', query);
    const items = response.data?.items || [];
    const statusMap = new Map();

    items.forEach(item => {
        const statusColumn = item.column_values?.find(col => col.id === statusColumnId);
        if (statusColumn) {
            const value = useIndex
                ? String(statusColumn.index ?? '')
                : (statusColumn.text || '');
            statusMap.set(item.id.toString(), value);
        }
    });

    logger.functionEnd('fetchItemsStatus', { mappedCount: statusMap.size });
    return statusMap;
};

/**
 * שליפת פרטי הפריט המקושר הראשון מעמודת board_relation עבור רשימת אייטמים
 * @param {object} monday - Monday SDK instance
 * @param {string[]} itemIds - רשימת מזהי אייטמים
 * @param {string} columnId - מזהה עמודת board_relation
 * @returns {Promise<Map<string, {id: string, name: string}>>} - מפה של itemId -> {id, name} (ריקה בכשל)
 */
export const fetchItemsLinkedIds = async (monday, itemIds, columnId) => {
    if (!itemIds || itemIds.length === 0 || !columnId) {
        return new Map();
    }

    logger.functionStart('fetchItemsLinkedIds', { itemCount: itemIds.length, columnId });

    const query = `query {
        items(ids: [${itemIds.join(',')}]) {
            id
            column_values(ids: ["${columnId}"]) {
                ... on BoardRelationValue {
                    linked_items {
                        id
                        name
                    }
                }
            }
        }
    }`;

    try {
        const response = await safeApi(monday, 'fetchItemsLinkedIds', query);
        const items = response.data?.items || [];
        const linkedMap = new Map();

        items.forEach(item => {
            const colValue = item.column_values?.[0];
            const firstLinked = colValue?.linked_items?.[0];
            if (firstLinked?.id) {
                linkedMap.set(item.id.toString(), { id: firstLinked.id.toString(), name: firstLinked.name || '' });
            }
        });

        logger.functionEnd('fetchItemsLinkedIds', { mappedCount: linkedMap.size });
        return linkedMap;
    } catch (err) {
        logger.warn('fetchItemsLinkedIds', 'Failed to fetch linked ids, returning empty map', err);
        return new Map();
    }
};

/**
 * שליפת הקצאות פעילות (Assignments) עבור המשתמש הנוכחי
 * מחזירה רשימת פרויקטים מהקצאות שהתאריכים שלהם כוללים את היום
 * @param {object} monday - Monday SDK instance
 * @param {string} boardId - מזהה לוח ההקצאות
 * @param {string} personColumnId - מזהה עמודת אנשים
 * @param {string} startDateColumnId - מזהה עמודת תאריך התחלה
 * @param {string} endDateColumnId - מזהה עמודת תאריך סיום
 * @param {string} projectLinkColumnId - מזהה עמודת קישור לפרויקט
 * @returns {Promise<Array<{id: string, name: string}>>} - רשימת פרויקטים ייחודיים
 */
export const fetchActiveAssignments = async (
    monday,
    boardId,
    personColumnId,
    startDateColumnId,
    endDateColumnId,
    projectLinkColumnId,
    { customerColumnId, projectTypeSourceColumnId, projectTypeMapping } = {}
) => {
    if (!boardId || !personColumnId || !startDateColumnId || !endDateColumnId || !projectLinkColumnId) {
        logger.warn('fetchActiveAssignments', 'Missing required parameters');
        return [];
    }

    logger.functionStart('fetchActiveAssignments', {
        boardId, personColumnId, startDateColumnId, endDateColumnId, projectLinkColumnId,
        customerColumnId, projectTypeSourceColumnId
    });

    // עמודה יחידה לשלוף מלוח ההקצאות: קישור פרויקט
    const assignmentColIds = [projectLinkColumnId];

    // עמודות סוג פרויקט + לקוח — נשלפות בתוך linked_items (לוח הפרויקטים)
    const linkedColIds = [
        ...(projectTypeSourceColumnId ? [projectTypeSourceColumnId] : []),
        ...(customerColumnId ? [customerColumnId] : []),
    ];
    const linkedColumnValuesFragment = linkedColIds.length > 0
        ? `column_values(ids: ${JSON.stringify(linkedColIds)}) {
                            id
                            ... on StatusValue { value }
                            ... on BoardRelationValue { linked_items { id name } }
                        }`
        : '';

    const query = `query {
        boards(ids: [${boardId}]) {
            items_page(
                query_params: {
                    operator: and,
                    rules: [
                        { column_id: "${personColumnId}", compare_value: ["assigned_to_me"], operator: any_of },
                        { column_id: "${startDateColumnId}", compare_value: ["TODAY"], operator: lower_than_or_equal },
                        { column_id: "${endDateColumnId}", compare_value: ["TODAY"], operator: greater_than_or_equals }
                    ]
                }
            ) {
                items {
                    id
                    column_values(ids: ${JSON.stringify(assignmentColIds)}) {
                        id
                        ... on BoardRelationValue {
                            linked_items {
                                id
                                name
                                ${linkedColumnValuesFragment}
                            }
                        }
                    }
                }
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchActiveAssignments', query);
    const items = response.data?.boards?.[0]?.items_page?.items || [];

    // חילוץ פרויקטים ייחודיים מההקצאות
    const projectsMap = new Map();
    items.forEach(item => {
        const colValues = item.column_values || [];

        const projectLinkCol = colValues.find(c => c.id === projectLinkColumnId);
        const linkedItems = projectLinkCol?.linked_items || [];

        linkedItems.forEach(project => {
            if (!project.id || projectsMap.has(project.id)) return;

            // סוג פרויקט + לקוח — שניהם נשלפו בתוך linked_items מלוח הפרויקטים
            let projectType = null;
            if (projectTypeSourceColumnId && projectTypeMapping) {
                try {
                    const typeCol = project.column_values?.find(c => c.id === projectTypeSourceColumnId);
                    const labelId = typeCol?.value ? String(JSON.parse(typeCol.value)?.index ?? '') : '';
                    projectType = labelId ? (projectTypeMapping[labelId] || null) : null;
                } catch (error) {
                    // כשל בפענוח value של עמודת סוג הפרויקט — ממשיך ללא סוג פרויקט
                    logger.warn('fetchActiveAssignments', 'Failed to parse project type column value, continuing without projectType', { projectId: project.id, error });
                }
            }

            let customerId = null, customerName = null;
            if (customerColumnId) {
                const customerCol = project.column_values?.find(c => c.id === customerColumnId);
                const firstLinked = customerCol?.linked_items?.[0];
                customerId = firstLinked?.id || null;
                customerName = firstLinked?.name || null;
            }

            projectsMap.set(project.id, {
                id: project.id,
                name: project.name,
                assignmentId: item.id,
                projectType,
                customerId,
                customerName,
            });
        });
    });

    const projects = Array.from(projectsMap.values());
    logger.functionEnd('fetchActiveAssignments', {
        assignmentsCount: items.length,
        uniqueProjectsCount: projects.length
    });

    return projects;
};
