/**
 * GraphQL Utilities — פונקציות עזר לבניית שאילתות GraphQL בטוחות
 */

/**
 * Escape מחרוזת להכנסה בתוך GraphQL string literal (בתוך גרשיים כפולים).
 * מונע שבירת query ו-injection דרך תווים מיוחדים.
 *
 * @param {string} str - המחרוזת ל-escape
 * @returns {string} מחרוזת בטוחה להכנסה ב-GraphQL
 */
export function escapeGraphQLString(str) {
    if (str == null) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}
