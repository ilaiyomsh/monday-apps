// בארל מודול — חושף את כל ה-API של mondayApi דרך נקודת כניסה אחת.
//
// מבנה (Wave 4.1.5 — סוף Wave 4: דה-קומפוזיציה הושלמה ועטיפה אחת בלבד):
//   • CLIENT — תשתית ריצה (MondayApiError, safeApi, _testHelpers).
//     wrapMondayApiCall נמחקה ב-4.1.5 לאחר מיגרציית 27 הקריאות הפנימיות.
//   • COLUMNS — שליפה / יצירה / פירוס של עמודות (כולל parseStatusLabels הטהור).
//   • MIRROR — פתרון עמודת mirror אל המקור.
//   • BOARDS — fetchers ברמת לוח (Connect Boards / People uniqueness).
//   • ITEMS — fetchers/mutations ברמת אייטם בודד או אוסף אייטמים בלוח.
//
// צרכני המודול ממשיכים לייבא מ-`utils/mondayApi` בלי שינוי — Vite/Vitest
// פותרים את index.js אוטומטית.

// --- CLIENT (תשתית ריצה — מקור קבוע: ./client) ---
export { MondayApiError, safeApi, _testHelpers } from './client.js';

// --- ASSERT (Phase 2 — אכיפת GraphQL soft-error ≠ הצלחה במסלולי כתיבה) ---
export { assertNoGraphQLErrors } from './assertGraphQL.js';

// --- COLUMNS (Wave 4.1.2 — מקור: ./columns) ---
// כולל createBoardWithColumns שעבר יחד עם createColumn כדי למנוע מעגל
// יבוא בין client.js ל-columns.js (פירוט ב-ANALYSIS.md, F007 wave 4.1.2).
export {
    fetchColumnSettings,
    fetchStatusColumnSettings,
    fetchStatusColumnsFromBoard,
    parseStatusLabels,
    createColumn,
    createEventTypeStatusColumn,
    createBoardWithColumns,
} from './columns.js';

// --- MIRROR (Wave 4.1.2 — מקור: ./mirror) ---
export { resolveMirrorSourceColumn } from './mirror.js';

// --- BOARDS (Wave 4.1.3 — מקור: ./boards) ---
export {
    fetchConnectedBoardsFromColumn,
    fetchUniquePeopleFromBoard,
} from './boards.js';

// --- ITEMS (Wave 4.1.4 — מקור: ./items) ---
export {
    parseTimeString,
    fetchAllBoardItems,
    createBoardItem,
    fetchEventsFromBoard,
    fetchProjectsForUser,
    findProjectLinkColumn,
    createTask,
    updateItemColumnValues,
    fetchCurrentUser,
    fetchItemById,
    fetchProjectById,
    deleteItem,
    fetchItemsStatus,
    fetchItemsLinkedIds,
    fetchActiveAssignments,
} from './items.js';
