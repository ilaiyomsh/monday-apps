/**
 * Event Type Mapping - מודול ליבה למיפוי סוגי דיווח
 * כל קובץ אחר מייבא מכאן את הפונקציות לזיהוי קטגוריית אירוע
 *
 * מבנה mapping: { index: 'category', ... }  (מפתח = אינדקס הלייבל בעמודת Status)
 * מבנה labelMeta: { index: { label: string, color: string }, ... }
 * דוגמה: mapping = { '3': 'billable', '0': 'allDay', '2': 'allDay', '6': 'allDay', '101': 'nonBillable' }
 *
 * מצב הבחנה (enableProjectTypeDistinction=true):
 * דוגמה: mapping = { '3': 'internalProject', '4': 'externalProject', '0': 'allDay', '101': 'routine' }
 *
 * הערה: סימון אירוע כ"עתידי" (temporary) הועבר לעמודת Checkbox נפרדת (temporaryCheckboxColumnId)
 * ולא נמצא יותר במיפוי הזה.
 */

import logger from './logger';

// === קבועי קטגוריות ===

export const EVENT_CATEGORIES = {
    BILLABLE: 'billable',           // בדיוק 1 לייבל - אירוע שעתי לחיוב (מצב רגיל)
    NON_BILLABLE: 'nonBillable',    // ללא הגבלה - אירוע שעתי לא לחיוב (מצב רגיל)
    ALL_DAY: 'allDay',              // בדיוק 1 לייבל - אירוע יומי (התת-סוג בעמודה נפרדת)
    // קטגוריות הבחנה פנימי/חיצוני
    INTERNAL_PROJECT: 'internalProject',  // בדיוק 1 - פרויקט פנימי
    EXTERNAL_PROJECT: 'externalProject',  // בדיוק 1 - פרויקט חיצוני
    ROUTINE: 'routine'                     // מרובה - שוטף
};

// תוויות עבריות לקטגוריות - מצב רגיל (ללא הבחנה)
export const CATEGORY_LABELS = {
    [EVENT_CATEGORIES.BILLABLE]: 'פרויקטים',
    [EVENT_CATEGORIES.NON_BILLABLE]: 'שוטף',
    [EVENT_CATEGORIES.ALL_DAY]: 'יומי'
};

// תוויות עבריות לקטגוריות - מצב הבחנה פנימי/חיצוני
export const DISTINCTION_CATEGORY_LABELS = {
    [EVENT_CATEGORIES.INTERNAL_PROJECT]: 'פנימי',
    [EVENT_CATEGORIES.EXTERNAL_PROJECT]: 'חיצוני',
    [EVENT_CATEGORIES.ROUTINE]: 'שוטף',
    [EVENT_CATEGORIES.ALL_DAY]: 'יומי'
};

/**
 * מחזיר את תוויות הקטגוריות לפי מצב ההבחנה
 * @param {boolean} enableDistinction - האם הבחנה פנימי/חיצוני מופעלת
 * @returns {Object} - מפתח: קטגוריה, ערך: תווית עברית
 */
export const getCategoryLabels = (enableDistinction) => {
    return enableDistinction ? DISTINCTION_CATEGORY_LABELS : CATEGORY_LABELS;
};

// קטגוריה ללא מיפוי
export const UNMAPPED = 'unmapped';
export const UNMAPPED_LABEL = 'ללא מיפוי';

// === Core Resolvers ===

/**
 * מחזיר את הקטגוריה של אינדקס לייבל
 * @param {number|string} index - אינדקס הלייבל
 * @param {Object} mapping - מיפוי { index: category }
 * @returns {string|null} - קטגוריה או null
 */
export const getCategory = (index, mapping) => {
    if (index == null || !mapping) return null;
    return mapping[String(index)] || null;
};

/**
 * מחזיר את האינדקס של קטגוריית billable (בדיוק 1)
 * @param {Object} mapping
 * @returns {string|null} - אינדקס כ-string או null
 */
export const getBillableIndex = (mapping) => {
    if (!mapping) return null;
    const entry = Object.entries(mapping).find(([, cat]) => cat === EVENT_CATEGORIES.BILLABLE);
    return entry ? entry[0] : null;
};

/**
 * מחזיר את כל האינדקסים של קטגוריית nonBillable
 * @param {Object} mapping
 * @returns {string[]}
 */
export const getNonBillableIndexes = (mapping) => {
    if (!mapping) return [];
    return Object.entries(mapping)
        .filter(([, cat]) => cat === EVENT_CATEGORIES.NON_BILLABLE)
        .map(([index]) => index);
};

/**
 * מחזיר את כל האינדקסים של קטגוריית allDay
 * @param {Object} mapping
 * @returns {string[]}
 */
export const getAllDayIndexes = (mapping) => {
    if (!mapping) return [];
    return Object.entries(mapping)
        .filter(([, cat]) => cat === EVENT_CATEGORIES.ALL_DAY)
        .map(([index]) => index);
};

// === Distinction Resolvers ===

/**
 * מחזיר את האינדקס של קטגוריית internalProject (בדיוק 1)
 * @param {Object} mapping
 * @returns {string|null}
 */
export const getInternalProjectIndex = (mapping) => {
    if (!mapping) return null;
    const entry = Object.entries(mapping).find(([, cat]) => cat === EVENT_CATEGORIES.INTERNAL_PROJECT);
    return entry ? entry[0] : null;
};

/**
 * מחזיר את האינדקס של קטגוריית externalProject (בדיוק 1)
 * @param {Object} mapping
 * @returns {string|null}
 */
export const getExternalProjectIndex = (mapping) => {
    if (!mapping) return null;
    const entry = Object.entries(mapping).find(([, cat]) => cat === EVENT_CATEGORIES.EXTERNAL_PROJECT);
    return entry ? entry[0] : null;
};

/**
 * מחזיר את כל האינדקסים של קטגוריית routine
 * @param {Object} mapping
 * @returns {string[]}
 */
export const getRoutineIndexes = (mapping) => {
    if (!mapping) return [];
    return Object.entries(mapping)
        .filter(([, cat]) => cat === EVENT_CATEGORIES.ROUTINE)
        .map(([index]) => index);
};

// === Boolean Checkers (by index) ===

export const isBillableIndex = (index, mapping) => getCategory(index, mapping) === EVENT_CATEGORIES.BILLABLE;
export const isNonBillableIndex = (index, mapping) => getCategory(index, mapping) === EVENT_CATEGORIES.NON_BILLABLE;
export const isAllDayIndex = (index, mapping) => getCategory(index, mapping) === EVENT_CATEGORIES.ALL_DAY;

/**
 * בדיקה אם אינדקס מייצג פרויקט (billable / internalProject / externalProject)
 * @param {number|string} index
 * @param {Object} mapping
 * @returns {boolean}
 */
export const isProjectIndex = (index, mapping) => {
    const cat = getCategory(index, mapping);
    return cat === EVENT_CATEGORIES.BILLABLE ||
           cat === EVENT_CATEGORIES.INTERNAL_PROJECT ||
           cat === EVENT_CATEGORIES.EXTERNAL_PROJECT;
};

/**
 * בדיקה אם אינדקס מייצג שוטף (nonBillable / routine)
 * @param {number|string} index
 * @param {Object} mapping
 * @returns {boolean}
 */
export const isRoutineOrNonBillableIndex = (index, mapping) => {
    const cat = getCategory(index, mapping);
    return cat === EVENT_CATEGORIES.NON_BILLABLE || cat === EVENT_CATEGORIES.ROUTINE;
};

// === Label Meta Helpers ===

/**
 * שליפת טקסט הלייבל לפי אינדקס
 * @param {number|string} index
 * @param {Object} labelMeta - { index: { label, color } }
 * @returns {string}
 */
export const getLabelText = (index, labelMeta) => {
    if (index == null || !labelMeta) return '';
    return labelMeta[String(index)]?.label || '';
};

/**
 * שליפת צבע הלייבל לפי אינדקס
 * @param {number|string} index
 * @param {Object} labelMeta - { index: { label, color } }
 * @returns {string}
 */
export const getLabelColor = (index, labelMeta) => {
    if (index == null || !labelMeta) return '';
    return labelMeta[String(index)]?.color || '';
};

/**
 * שליפת טקסטים של כל הלייבלים בקטגוריה מסוימת
 * @param {string} category - קטגוריה
 * @param {Object} mapping
 * @param {Object} labelMeta
 * @returns {Array<{index: string, label: string, color: string}>}
 */
export const getLabelsByCategory = (category, mapping, labelMeta) => {
    if (!mapping || !labelMeta) return [];
    return Object.entries(mapping)
        .filter(([, cat]) => cat === category)
        .map(([index]) => ({
            index,
            label: getLabelText(index, labelMeta),
            color: getLabelColor(index, labelMeta)
        }));
};

// === Helpers ===

/**
 * מחזיר את האינדקס המתאים לאירוע שעתי (לחיוב או לא)
 * backward compat — משמש כשהבחנה כבויה
 * @param {boolean} isBillable
 * @param {Object} mapping
 * @returns {string|null} - אינדקס או null אם אין mapping
 */
export const getTimedEventIndex = (isBillable, mapping) => {
    if (!mapping) return null;
    if (isBillable) {
        return getBillableIndex(mapping);
    }
    const nbIndexes = getNonBillableIndexes(mapping);
    return nbIndexes[0] || null;
};

/**
 * פונקציה מרכזית — מחזיר את האינדקס המתאים לפי מצב הבחנה
 * @param {Object} params
 * @param {boolean} params.isBillable - האם פרויקט (true) או שוטף (false)
 * @param {Object|null} params.project - אובייקט פרויקט (כולל projectType)
 * @param {Object} params.mapping - מיפוי { index: category }
 * @param {boolean} params.enableDistinction - האם הבחנה מופעלת
 * @returns {string|null}
 */
export const resolveTimedEventIndex = ({ isBillable, project, mapping, enableDistinction }) => {
    if (!mapping) return null;

    if (!enableDistinction) {
        return getTimedEventIndex(isBillable, mapping);
    }

    // מצב הבחנה
    if (isBillable) {
        // פרויקט פנימי אם projectType === 'internal', אחרת חיצוני (ברירת מחדל)
        if (project?.projectType === 'internal') {
            return getInternalProjectIndex(mapping);
        }
        return getExternalProjectIndex(mapping);
    }

    // שוטף
    const routineIndexes = getRoutineIndexes(mapping);
    return routineIndexes[0] || null;
};

/**
 * בדיקה אם קטגוריה היא חד-פעמית (בדיוק 1 לייבל)
 * @param {string} category
 * @param {boolean} enableDistinction
 * @returns {boolean}
 */
export const isSingleUseCategory = (category, enableDistinction) => {
    if (enableDistinction) {
        // מצב הבחנה: internalProject ו-externalProject הם חד-פעמיים
        return category === EVENT_CATEGORIES.INTERNAL_PROJECT ||
               category === EVENT_CATEGORIES.EXTERNAL_PROJECT;
    }

    // מצב רגיל: billable הוא חד-פעמי
    return category === EVENT_CATEGORIES.BILLABLE;
};

// === Validation ===

/**
 * בדיקת תקינות מיפוי (מצב רגיל ללא הבחנה)
 * @param {Object} mapping
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateMapping = (mapping) => {
    const errors = [];

    if (!mapping || typeof mapping !== 'object') {
        return { isValid: false, errors: ['חסר מיפוי סוגי דיווח'] };
    }

    const entries = Object.entries(mapping);
    if (entries.length === 0) {
        return { isValid: false, errors: ['מיפוי ריק - יש לשייך לייבלים לקטגוריות'] };
    }

    // בדיקת billable - בדיוק 1
    const billableCount = entries.filter(([, cat]) => cat === EVENT_CATEGORIES.BILLABLE).length;
    if (billableCount === 0) {
        errors.push('חסר לייבל "פרויקטים" - יש לשייך בדיוק לייבל אחד');
    } else if (billableCount > 1) {
        errors.push('ניתן לשייך רק לייבל אחד לקטגוריית "פרויקטים"');
    }

    // בדיקת allDay - בדיוק 1
    const allDayCount = entries.filter(([, cat]) => cat === EVENT_CATEGORIES.ALL_DAY).length;
    if (allDayCount === 0) {
        errors.push('חסר לייבל "יומי" - יש לשייך בדיוק לייבל אחד');
    } else if (allDayCount > 1) {
        errors.push('ניתן לשייך רק לייבל אחד לקטגוריית "יומי" (התת-סוגים מוגדרים בעמודה נפרדת)');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * בדיקת תקינות מיפוי במצב הבחנה פנימי/חיצוני
 * @param {Object} mapping
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateMappingDistinction = (mapping) => {
    const errors = [];

    if (!mapping || typeof mapping !== 'object') {
        return { isValid: false, errors: ['חסר מיפוי סוגי דיווח'] };
    }

    const entries = Object.entries(mapping);
    if (entries.length === 0) {
        return { isValid: false, errors: ['מיפוי ריק - יש לשייך לייבלים לקטגוריות'] };
    }

    // בדיקת internalProject - בדיוק 1
    const internalCount = entries.filter(([, cat]) => cat === EVENT_CATEGORIES.INTERNAL_PROJECT).length;
    if (internalCount === 0) {
        errors.push('חסר לייבל "פנימי" - יש לשייך בדיוק לייבל אחד');
    } else if (internalCount > 1) {
        errors.push('ניתן לשייך רק לייבל אחד לקטגוריית "פנימי"');
    }

    // בדיקת externalProject - בדיוק 1
    const externalCount = entries.filter(([, cat]) => cat === EVENT_CATEGORIES.EXTERNAL_PROJECT).length;
    if (externalCount === 0) {
        errors.push('חסר לייבל "חיצוני" - יש לשייך בדיוק לייבל אחד');
    } else if (externalCount > 1) {
        errors.push('ניתן לשייך רק לייבל אחד לקטגוריית "חיצוני"');
    }

    // בדיקת allDay - בדיוק 1
    const allDayCount = entries.filter(([, cat]) => cat === EVENT_CATEGORIES.ALL_DAY).length;
    if (allDayCount === 0) {
        errors.push('חסר לייבל "יומי" - יש לשייך בדיוק לייבל אחד');
    } else if (allDayCount > 1) {
        errors.push('ניתן לשייך רק לייבל אחד לקטגוריית "יומי" (התת-סוגים מוגדרים בעמודה נפרדת)');
    }

    // routine - 0+ (אין בדיקה מיוחדת)

    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * dispatcher — ולידציה לפי מצב ההבחנה
 * @param {Object} mapping
 * @param {boolean} enableDistinction
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const smartValidateMapping = (mapping, enableDistinction) => {
    return enableDistinction ? validateMappingDistinction(mapping) : validateMapping(mapping);
};

// === Auto-Migration ===

// לייבלים ידועים בעברית למיפוי אוטומטי
// (תת-סוגים של אירוע יומי הועברו לעמודת status נפרדת — allDayTypeStatusColumnId)
const KNOWN_HEBREW_LABELS = {
    'שעתי': EVENT_CATEGORIES.BILLABLE,
    'חיוב': EVENT_CATEGORIES.BILLABLE,
    'לא לחיוב': EVENT_CATEGORIES.NON_BILLABLE,
    'יומי': EVENT_CATEGORIES.ALL_DAY
};

/**
 * ניסיון מיפוי אוטומטי לפי לייבלים עבריים ידועים
 * שומר mapping לפי index (לא לפי טקסט)
 * @param {Array<{label: string, color: string, index: number}>} availableLabels - הלייבלים מהעמודה
 * @returns {{ mapping: Object, labelMeta: Object }|null} - מיפוי או null אם לא הצליח
 */
export const createLegacyMapping = (availableLabels) => {
    if (!availableLabels || availableLabels.length === 0) return null;

    const mapping = {};
    const labelMeta = {};
    let matched = 0;

    for (const labelObj of availableLabels) {
        const labelName = labelObj.label;
        const key = String(labelObj.id);
        const category = KNOWN_HEBREW_LABELS[labelName];
        if (category) {
            // בדיקה שלא כבר יש billable ממופה (כי 'שעתי' ו-'חיוב' שניהם BILLABLE)
            if (category === EVENT_CATEGORIES.BILLABLE && Object.values(mapping).includes(EVENT_CATEGORIES.BILLABLE)) {
                continue;
            }
            mapping[key] = category;
            labelMeta[key] = { label: labelName, color: labelObj.color || '' };
            matched++;
        }
    }

    // בדיקה שהמיפוי תקין
    const validation = validateMapping(mapping);
    if (validation.isValid) {
        logger.info('eventTypeMapping', 'Auto-migration succeeded', { matched, total: availableLabels.length });
        return { mapping, labelMeta };
    }

    logger.warn('eventTypeMapping', 'Auto-migration failed validation', { errors: validation.errors, matched });
    return null;
};

/**
 * בדיקה אם mapping הוא בפורמט ישן (מפתחות הם טקסט ולא אינדקסים)
 * @param {Object} mapping
 * @returns {boolean}
 */
export const isLegacyMapping = (mapping) => {
    if (!mapping || typeof mapping !== 'object') return false;
    const keys = Object.keys(mapping);
    if (keys.length === 0) return false;
    // אם המפתח הראשון הוא לא מספר - זה פורמט ישן
    return isNaN(Number(keys[0]));
};
