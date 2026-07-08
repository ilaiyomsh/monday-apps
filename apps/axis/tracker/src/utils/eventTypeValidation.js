/**
 * פונקציות עזר לולידציה של עמודת סוג אירוע (Event Type Status Column)
 *
 * הערה: הקבועים REQUIRED_EVENT_TYPE_LABELS ו-EVENT_TYPE_LABEL_COLORS
 * הוחלפו ע"י מערכת המיפוי הדינאמית ב-eventTypeMapping.js
 * נשמרים כאן לתאימות לאחור ולשימוש ביצירת עמודה חדשה (createEventTypeStatusColumn)
 *
 * סימון אירוע "עתידי" (temporary) הועבר לעמודת Checkbox נפרדת — ראה temporaryCheckboxColumnId.
 */

import logger from './logger';
import { mondayColorToHex } from './colorUtils';

// === קבועים (legacy - משמשים ליצירת עמודה חדשה בלבד) ===

/** @deprecated השתמש ב-eventTypeMapping.js במקום */
export const REQUIRED_EVENT_TYPE_LABELS = ['שעתי', 'לא לחיוב', 'יומי'];

/**
 * שם ברירת המחדל לעמודה חדשה
 */
export const EVENT_TYPE_COLUMN_NAME = 'סוג דיווח';

/** @deprecated צבעי לייבלים מגיעים מ-Monday API דרך eventTypeLabelColors בהגדרות */
export const EVENT_TYPE_LABEL_COLORS = {
    'שעתי': 'dark_blue',        // #0086c0 - כחול כהה
    'לא לחיוב': 'sunset',       // #ff7575 - sunset
    'יומי': 'working_orange'    // #fdab3d - כתום (אירוע יומי, התת-סוג בעמודה נפרדת)
};

// === פונקציות עזר (פעילות) ===

/**
 * מפרסר את הלייבלים מה-settings של עמודת Status
 * @param {Object|string} settings - ה-settings של העמודה (יכול להיות אובייקט או מחרוזת JSON)
 * @returns {Array<{label: string, color: string, index: number, id: number}>} - מערך הלייבלים
 */
export const parseStatusColumnLabels = (settings) => {
    try {
        // אם settings הוא מחרוזת, ננסה לפרסר אותו
        const settingsObj = typeof settings === 'string' ? JSON.parse(settings) : settings;

        if (!settingsObj || !settingsObj.labels) {
            logger.warn('parseStatusColumnLabels', 'No labels found in settings');
            return [];
        }

        // אם labels הוא מערך - נחזיר אותו
        if (Array.isArray(settingsObj.labels)) {
            const labelsColors = settingsObj.labels_colors || {};
            return settingsObj.labels.map(label => {
                // Monday שומר את הצבע בשדה `hex` (כ-HEX ישיר) ו-`color` כ-index
                const rawColor = label.hex
                    || (typeof label.color === 'string' ? label.color : null)
                    || labelsColors[String(label.color)]?.color
                    || labelsColors[String(label.id)]?.color
                    || null;
                return {
                    label: label.label || 'empty',
                    color: mondayColorToHex(rawColor) || '',
                    index: label.index ?? 0,
                    id: label.id ?? 0,
                    is_deactivated: label.is_deactivated || false
                };
            }).filter(label => !label.is_deactivated); // סינון לייבלים מושבתים
        }

        // אם labels הוא אובייקט (מבנה ישן של Monday) - נמיר אותו למערך
        if (typeof settingsObj.labels === 'object') {
            const labelsColors = settingsObj.labels_colors || {};
            return Object.entries(settingsObj.labels).map(([index, label]) => ({
                label: label || 'empty',
                color: mondayColorToHex(labelsColors[index]?.color) || '',
                index: parseInt(index, 10),
                id: parseInt(index, 10)
            }));
        }

        logger.warn('parseStatusColumnLabels', 'Unknown labels format', { labels: settingsObj.labels });
        return [];
    } catch (error) {
        logger.error('parseStatusColumnLabels', 'Error parsing settings', error);
        return [];
    }
};

// === פונקציות Legacy (נשמרות לתאימות לאחור) ===

/**
 * @deprecated השתמש ב-validateMapping() מ-eventTypeMapping.js
 */
export const validateEventTypeColumn = (settings) => {
    logger.functionStart('validateEventTypeColumn');

    const labels = parseStatusColumnLabels(settings);
    const existingLabels = labels.map(l => l.label);

    // בדיקה אילו לייבלים חסרים
    const missingLabels = REQUIRED_EVENT_TYPE_LABELS.filter(
        required => !existingLabels.includes(required)
    );

    const isValid = missingLabels.length === 0;

    logger.functionEnd('validateEventTypeColumn', {
        isValid,
        missingLabels,
        existingLabels
    });

    return {
        isValid,
        missingLabels,
        existingLabels
    };
};

/**
 * @deprecated משמש רק ליצירת עמודה חדשה עם לייבלים ברירת מחדל
 */
export const getRequiredLabelsConfig = () => {
    return REQUIRED_EVENT_TYPE_LABELS.map((label, index) => ({
        label,
        color: EVENT_TYPE_LABEL_COLORS[label],
        index
    }));
};

/**
 * @deprecated
 */
export const formatMissingLabelsMessage = (missingLabels) => {
    if (missingLabels.length === 0) return '';

    const labelsList = missingLabels.map(l => `"${l}"`).join(', ');
    return `העמודה שנבחרה לא מכילה את הלייבלים הנדרשים: ${labelsList}`;
};
