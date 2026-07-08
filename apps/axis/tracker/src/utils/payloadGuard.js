/**
 * Payload Guard — שמירה על נתוני Monday מפני זיהום בתרגומים.
 *
 * הכלי מסרוק רקורסיבית כל אובייקט שעומד להישלח ל-Monday API ומוודא
 * שאף ערך מחרוזת לא מקורו ב-i18n bundle (תרגום UI). הסיכון הקריטי:
 * מפתח עתידי "יתרגם" בטעות גם לייבלים של עמודת סטטוס, וישבור נתוני לוח.
 */

/**
 * מחלץ את כל ערכי המחרוזת מאובייקט (כולל ערכים מקוננים).
 * שימושי לבדיקה ידנית או לרשימת ערכים שעומדים להישלח.
 *
 * @param {*} obj אובייקט לסריקה
 * @returns {string[]} רשימת כל המחרוזות שנמצאו
 */
export function extractStrings(obj) {
    const out = [];
    const visit = (value) => {
        if (typeof value === 'string') {
            out.push(value);
        } else if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(visit);
        }
    };
    visit(obj);
    return out;
}

/**
 * זורק שגיאה אם כל אחת מהמחרוזות האסורות מופיעה כערך באובייקט.
 *
 * שימוש טיפוסי: לפני שליחת payload ל-monday.api, מעבירים את כל
 * הערכים של ה-i18n bundle כ-forbiddenList — אם משהו מהם נמצא,
 * סימן שתרגום UI דלף ל-payload.
 *
 * @param {*} payload אובייקט לסריקה
 * @param {string[]} forbiddenList רשימת מחרוזות אסורות (ערכים, לא מפתחות)
 * @param {object} [options]
 * @param {string[]} [options.allowedKeys] — מפתחות שבהם מותרת מחרוזת חופשית
 *   (למשל "notes" — הערות שהמשתמש הקליד הן טקסט חופשי לגיטימי)
 */
export function assertNoForbiddenStrings(payload, forbiddenList, options = {}) {
    const { allowedKeys = [] } = options;
    const violations = [];

    const visit = (value, path = '') => {
        if (typeof value === 'string') {
            const lastKey = path.split('.').pop();
            if (allowedKeys.includes(lastKey)) return;
            for (const forbidden of forbiddenList) {
                if (value === forbidden || value.includes(forbidden)) {
                    violations.push({ path, value, forbidden });
                }
            }
        } else if (Array.isArray(value)) {
            value.forEach((v, i) => visit(v, `${path}[${i}]`));
        } else if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
                visit(v, path ? `${path}.${k}` : k);
            }
        }
    };

    visit(payload);

    if (violations.length > 0) {
        const summary = violations
            .map(v => `  at ${v.path}: "${v.value}" matches forbidden "${v.forbidden}"`)
            .join('\n');
        throw new Error(`Translated string leaked into payload:\n${summary}`);
    }
}

/**
 * בודק אם ערך נראה כמו status column value תקני (index או label).
 * משמש לזיהוי כתיבות לעמודת סטטוס בתוך column_values.
 *
 * @param {*} value
 * @returns {'index' | 'label' | null}
 */
export function detectStatusColumnShape(value) {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.index === 'number') return 'index';
    if (typeof value.label === 'string') return 'label';
    return null;
}

/**
 * עובר על column_values ומחזיר את כל הערכים שזיהינו כ-status writes.
 * שימושי לטסטים שרוצים לוודא שכל ה-status writes הם index-based.
 *
 * @param {object} columnValues אובייקט במבנה { columnId: value }
 * @returns {Array<{columnId: string, shape: string, value: object}>}
 */
export function findStatusColumnWrites(columnValues) {
    if (!columnValues || typeof columnValues !== 'object') return [];
    const out = [];
    for (const [columnId, value] of Object.entries(columnValues)) {
        const shape = detectStatusColumnShape(value);
        if (shape) out.push({ columnId, shape, value });
    }
    return out;
}

const payloadGuard = {
    extractStrings,
    assertNoForbiddenStrings,
    detectStatusColumnShape,
    findStatusColumnWrites
};
export default payloadGuard;
