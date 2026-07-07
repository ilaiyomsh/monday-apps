/**
 * Column Value Builders — Increment 4 mapping hardening.
 *
 * המודול הזה הוא ה"שער" של כל כתיבה ל-Monday API. שלושת ה-builders
 * האלה מבטיחים שכל ערך שנכתב לעמודת סטטוס מגיע כ-{ index: N } ולא
 * כ-{ label: '...' } או { text: '...' } — הצורה הזו מבטיחה ש-Monday
 * לא יראה לעולם טקסט שעבר תרגום UI.
 *
 * זוכרים: לייבלים ב-Monday מגיעים ב-board data (לא בתרגום). אבל
 * הסיכון הוא שמפתח עתידי "יתרגם" בטעות גם לייבלים, או יעביר ערך
 * מתורגם ב-eventData. ה-assertNoTranslatedLabels הוא רשת ביטחון
 * שתופסת זאת ב-runtime לפני שהקריאה מגיעה ל-API.
 */

/**
 * בונה ערך לעמודת סטטוס לפי index.
 *
 * @param {number} index — אינדקס הלייבל בעמודת הסטטוס
 * @returns {{index: number}}
 * @throws Error כש-index אינו מספר חוקי
 */
export function buildStatusColumnValue(index) {
    if (typeof index !== 'number' || Number.isNaN(index)) {
        throw new Error(
            `buildStatusColumnValue: expected number, got ${typeof index} (${JSON.stringify(index)})`
        );
    }
    return { index };
}

/**
 * בונה ערך לעמודת סוג אירוע על-פי קטגוריה ומיפוי.
 *
 * @param {string} category — billable / nonBillable / allDay / temporary / internalProject / externalProject / routine
 * @param {Object<string, string>} mapping — { [index]: category } כפי שמופיע ב-customSettings.eventTypeMapping
 * @param {Object} [options]
 * @param {number} [options.specificIndex] — כש-category מקבל כמה אינדקסים (כמו allDay), בוחרים אינדקס ספציפי
 * @returns {{index: number}}
 * @throws Error כשהקטגוריה לא קיימת במיפוי
 */
export function buildEventTypeColumnValue(category, mapping, options = {}) {
    if (!mapping || typeof mapping !== 'object') {
        throw new Error(`buildEventTypeColumnValue: invalid mapping for category "${category}"`);
    }

    const matchingIndexes = Object.entries(mapping)
        .filter(([, cat]) => cat === category)
        .map(([idx]) => parseInt(idx, 10))
        .filter(n => !Number.isNaN(n));

    if (matchingIndexes.length === 0) {
        throw new Error(
            `buildEventTypeColumnValue: category "${category}" not found in mapping`
        );
    }

    if (options.specificIndex != null) {
        if (!matchingIndexes.includes(options.specificIndex)) {
            throw new Error(
                `buildEventTypeColumnValue: specificIndex ${options.specificIndex} ` +
                `does not match category "${category}" in mapping`
            );
        }
        return { index: options.specificIndex };
    }

    return { index: matchingIndexes[0] };
}

/**
 * סורק רקורסיבית payload ומוודא שאין כתיבות עם {label} או {text}.
 * שני המפתחות האלה הם ה-shapes שעלולים להכיל טקסט מתורגם של UI.
 * הצורה היחידה הקבילה לכתיבה לעמודת סטטוס היא {index: number}.
 *
 * @param {*} payload — אובייקט לסריקה (column_values וכל מבנה מקונן)
 * @throws Error כשנמצא {label} או {text} שאינו null
 */
export function assertNoTranslatedLabels(payload) {
    const violations = [];

    const visit = (value, path = '') => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, val] of Object.entries(value)) {
                const subPath = path ? `${path}.${key}` : key;
                if ((key === 'label' || key === 'text') && val != null && val !== '') {
                    violations.push({ path: subPath, key, value: val });
                }
                visit(val, subPath);
            }
        } else if (Array.isArray(value)) {
            value.forEach((v, i) => visit(v, `${path}[${i}]`));
        }
    };

    visit(payload);

    if (violations.length > 0) {
        const summary = violations
            .map(v => `  at ${v.path}: ${v.key}="${v.value}" — translated label suspected`)
            .join('\n');
        throw new Error(
            `assertNoTranslatedLabels: payload contains translated label/text fields:\n${summary}`
        );
    }
}

const columnValueBuilders = {
    buildStatusColumnValue,
    buildEventTypeColumnValue,
    assertNoTranslatedLabels
};
export default columnValueBuilders;
