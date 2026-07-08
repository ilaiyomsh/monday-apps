/**
 * Board ID Resolver
 * מחזיר את מזהה הלוח האפקטיבי לשימוש באפליקציה
 * תומך בהפעלה כ-Custom Object (ללא context.boardId)
 */

/**
 * מחזיר את מזהה הלוח האפקטיבי לפי ההגדרות
 * לוגיקת Fallback:
 * 1. אם useCurrentBoardForReporting פעיל ויש context.boardId - שימוש ב-context
 * 2. אם יש timeReportingBoardId - שימוש בו
 * 3. Fallback ל-context.boardId (תאימות לאחור)
 *
 * @param {Object} customSettings - הגדרות האפליקציה
 * @param {Object} context - Monday context
 * @returns {string|null} מזהה הלוח האפקטיבי
 */
export const getEffectiveBoardId = (customSettings, context) => {
    // אם הטוגל פעיל ויש context.boardId - שימוש בלוח הנוכחי
    if (customSettings?.useCurrentBoardForReporting && context?.boardId) {
        return context.boardId;
    }

    // אם יש לוח דיווחים מוגדר - שימוש בו
    if (customSettings?.timeReportingBoardId) {
        return customSettings.timeReportingBoardId;
    }

    // Fallback ל-context.boardId (תאימות לאחור)
    return context?.boardId || null;
};

/**
 * בודק אם יש לוח דיווחים תקף
 * @param {Object} customSettings - הגדרות האפליקציה
 * @param {Object} context - Monday context
 * @returns {boolean} האם יש לוח תקף
 */
export const hasValidReportingBoard = (customSettings, context) => {
    return !!getEffectiveBoardId(customSettings, context);
};

/**
 * בודק אם האפליקציה רצה במצב Custom Object (ללא context.boardId)
 * @param {Object} context - Monday context
 * @returns {boolean} האם במצב Custom Object
 */
export const isCustomObjectMode = (context) => {
    return !context?.boardId;
};

const boardIdResolver = { getEffectiveBoardId, hasValidReportingBoard, isCustomObjectMode };
export default boardIdResolver;
