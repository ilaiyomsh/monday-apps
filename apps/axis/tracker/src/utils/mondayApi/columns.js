// מודול columns — שליפה / יצירה / פירוס של עמודות Monday (בעיקר Status).
//
// יוצא מ-client.js במסגרת Wave 4.1.2:
//   - fetchColumnSettings, fetchStatusColumnSettings, fetchStatusColumnsFromBoard
//   - parseStatusLabels (helper טהור — לא מבצע API call)
//   - createColumn, createEventTypeStatusColumn
//   - createBoardWithColumns (קולוקלי ל-createColumn — נוצר מחזורי-יבוא אם
//     נפצל בין client.js ל-columns.js, לכן הוא נשאר כאן עד שבארל 4.1.3 יחליט
//     אם להעבירו ל-boards.js).
//
// תלות: logger, safeApi, MondayApiError — כולם מ-./client או מ-utils peers.

import logger from '../logger';
import { safeApi, MondayApiError } from './client.js';

// אחזור הגדרות עמודת Board מחובר
export const fetchColumnSettings = async (monday, boardId, columnId) => {
    logger.functionStart('fetchColumnSettings', { boardId, columnId });

    const query = `query {
        boards(ids: [${boardId}]) {
            columns(ids: "${columnId}") {
                settings
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchColumnSettings', query);
    const columnSettings = response.data?.boards?.[0]?.columns?.[0]?.settings;
    logger.functionEnd('fetchColumnSettings', { hasSettings: !!columnSettings });
    return columnSettings;
};

/**
 * יצירת עמודת סטטוס עם הקטגוריות שדרושות לדיווח שעות.
 */
export const createEventTypeStatusColumn = async (monday, boardId, columnTitle = 'סוג דיווח') => {
    logger.functionStart('createEventTypeStatusColumn', { boardId, columnTitle });

    // הגדרת הלייבלים בפורמט של Monday API
    // אחרי הרפקטור: רק 3 קטגוריות בעמודה הזו (יומי/שעתי/לא לחיוב).
    // התת-סוגים של אירוע יומי (חופשה/מחלה/...) בעמודה נפרדת — allDayTypeStatusColumnId.
    const mutation = `mutation {
        create_status_column(
            board_id: ${boardId}
            title: "${columnTitle}"
            defaults: {
                labels: [
                    { color: working_orange, label: "יומי", index: 0 }
                    { color: dark_blue, label: "שעתי", index: 1 }
                    { color: sunset, label: "לא לחיוב", index: 2 }
                ]
            }
        ) {
            id
        }
    }`;

    const response = await safeApi(monday, 'createEventTypeStatusColumn', mutation);
    const columnId = response.data?.create_status_column?.id;
    if (!columnId) {
        // יצירת העמודה כשלה (soft-error / data חסר) — לא מחזירים id חסר בשתיקה.
        throw new MondayApiError('Failed to create event type status column (missing column id)', {
            response,
            apiRequest: { query: mutation, variables: null },
            errorCode: response?.errors?.[0]?.extensions?.code || null,
            functionName: 'createEventTypeStatusColumn'
        });
    }
    logger.functionEnd('createEventTypeStatusColumn', { columnId });
    return columnId;
};

/**
 * יצירת עמודה חדשה בלוח (גנרי - לא מוגבל לסוג Status)
 * Creates a new column on a board.
 */
export const createColumn = async (monday, boardId, { title, type, settingsStr = null }) => {
    logger.functionStart('createColumn', { boardId, title, type, hasSettings: !!settingsStr });

    const query = settingsStr
        ? `mutation create_column($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON) {
            create_column(board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) {
                id
                type
            }
          }`
        : `mutation create_column($boardId: ID!, $title: String!, $columnType: ColumnType!) {
            create_column(board_id: $boardId, title: $title, column_type: $columnType) {
                id
                type
            }
          }`;

    const variables = settingsStr
        ? { boardId: String(boardId), title, columnType: type, defaults: settingsStr }
        : { boardId: String(boardId), title, columnType: type };

    const response = await safeApi(monday, 'createColumn', query, { variables });
    const created = response.data?.create_column;
    if (!created?.id) {
        // יצירת העמודה כשלה (soft-error / data חסר) — לא מחזירים null בשתיקה.
        throw new MondayApiError('Failed to create column (missing column id)', {
            response,
            apiRequest: { query, variables },
            errorCode: response?.errors?.[0]?.extensions?.code || null,
            functionName: 'createColumn'
        });
    }
    logger.functionEnd('createColumn', { columnId: created.id, type: created.type });
    return { id: created.id, type: created.type };
};

/**
 * יצירת לוח חדש עם רשימת עמודות מוגדרות מראש.
 * Creates a new board, then creates each requested column on it.
 */
export const createBoardWithColumns = async (monday, { boardName, boardKind = 'public', workspaceId = null, columns = [] }) => {
    logger.functionStart('createBoardWithColumns', { boardName, boardKind, workspaceId, columnCount: columns.length });

    const query = workspaceId
        ? `mutation create_board($name: String!, $kind: BoardKind!, $ws: ID!) {
            create_board(board_name: $name, board_kind: $kind, workspace_id: $ws) {
                id
            }
          }`
        : `mutation create_board($name: String!, $kind: BoardKind!) {
            create_board(board_name: $name, board_kind: $kind) {
                id
            }
          }`;

    const variables = workspaceId
        ? { name: boardName, kind: boardKind, ws: String(workspaceId) }
        : { name: boardName, kind: boardKind };

    const response = await safeApi(monday, 'createBoardWithColumns:create_board', query, { variables });
    const boardId = response.data?.create_board?.id;
    if (!boardId) {
        // אותו instance לרישום ולזריקה — log-once מקפל לרשומה אחת (ה-response נשמר בתוך ה-MondayApiError)
        const noIdErr = new MondayApiError('Failed to create board', {
            response,
            apiRequest: { query, variables },
            functionName: 'createBoardWithColumns'
        });
        logger.error('createBoardWithColumns', 'create_board returned no id', noIdErr);
        throw noIdErr;
    }

    const columnsByKey = {};
    for (const col of columns) {
        const settingsStr = col.settings ? JSON.stringify(col.settings) : null;
        const created = await createColumn(monday, boardId, { title: col.title, type: col.type, settingsStr });
        if (!created) {
            logger.warn('createBoardWithColumns', `Column "${col.title}" returned null`, { boardId, columnKey: col.key });
            continue;
        }
        columnsByKey[col.key] = created;
    }

    logger.functionEnd('createBoardWithColumns', { boardId, createdColumnKeys: Object.keys(columnsByKey) });
    return { boardId, columnsByKey };
};

// שליפת הגדרות עמודה (settings) לפי ID
export const fetchStatusColumnSettings = async (monday, boardId, columnId) => {
    logger.functionStart('fetchStatusColumnSettings', { boardId, columnId });

    const query = `query {
        boards(ids: [${boardId}]) {
            columns(ids: ["${columnId}"]) {
                type
                id
                title
                settings
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchStatusColumnSettings', query);
    const column = response.data?.boards?.[0]?.columns?.[0];
    logger.functionEnd('fetchStatusColumnSettings', { hasColumn: !!column });
    return column;
};

// שליפת כל עמודות הסטטוס מלוח
export const fetchStatusColumnsFromBoard = async (monday, boardId) => {
    if (!boardId) return [];
    logger.functionStart('fetchStatusColumnsFromBoard', { boardId });

    const query = `query {
        boards(ids: [${boardId}]) {
            columns {
                id
                title
                type
                settings
            }
        }
    }`;

    const response = await safeApi(monday, 'fetchStatusColumnsFromBoard', query);
    const columns = response.data?.boards?.[0]?.columns || [];
    const statusColumns = columns
        .filter(col => col.type === 'status')
        .map(col => ({
            id: col.id,
            title: col.title,
            settings: col.settings
        }));

    logger.functionEnd('fetchStatusColumnsFromBoard', { count: statusColumns.length });
    return statusColumns;
};

/**
 * חילוץ labels מהגדרות עמודת סטטוס
 * תומך בפורמט חדש (array) ופורמט ישן (object)
 * @param {string|object} columnSettings - הגדרות העמודה
 * @returns {Array<{id: string, label: string, color?: string}>}
 */
export const parseStatusLabels = (columnSettings) => {
    if (!columnSettings) return [];

    let settings = columnSettings;

    // אם זה string, נפרסר אותו
    if (typeof columnSettings === 'string') {
        try {
            settings = JSON.parse(columnSettings);
        } catch {
            logger.warn('parseStatusLabels', 'Failed to parse column settings string');
            return [];
        }
    }

    if (!settings.labels) return [];

    // פורמט חדש - מערך
    if (Array.isArray(settings.labels)) {
        const labelsColors = settings.labels_colors || {};
        return settings.labels
            .filter(item => item && item.label && !item.is_deactivated)
            .map(item => {
                const rawColor = item.hex
                    || (typeof item.color === 'string' ? item.color : null)
                    || labelsColors[String(item.color)]?.color
                    || labelsColors[String(item.id)]?.color
                    || null;
                return {
                    id: item.id?.toString() ?? item.label,
                    index: item.index ?? item.id ?? 0,
                    label: item.label,
                    color: rawColor || ''
                };
            });
    }

    // פורמט ישן - אובייקט
    return Object.entries(settings.labels)
        .filter(([id]) => id !== 'empty' && id !== '')
        .map(([id, data]) => ({
            id,
            label: typeof data === 'string' ? data : (data?.label || ''),
            color: typeof data === 'object' ? (data?.color || data?.hex) : undefined
        }))
        .filter(item => item.label); // מסנן ערכים ריקים
};
