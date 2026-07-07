/**
 * לוגיקת נעילת עריכת אירועים לפי חלון זמן
 *
 * מצבים:
 * - none: ללא הגבלה
 * - days_after: עד X ימים אחרי תאריך הדיווח
 */

export const EDIT_LOCK_MODES = {
    NONE: 'none',
    DAYS_AFTER: 'days_after'
};

export const DEFAULT_EDIT_LOCK_DAYS = 2;
export const MIN_EDIT_LOCK_DAYS = 1;
export const MAX_EDIT_LOCK_DAYS = 90;

// מפתחות i18n — הצרכן (AdditionalTab) קורא ל-t() על הערך.
export const EDIT_LOCK_LABEL_KEYS = {
    [EDIT_LOCK_MODES.NONE]: 'settings.additional.editLock.modes.none',
    [EDIT_LOCK_MODES.DAYS_AFTER]: 'settings.additional.editLock.modes.days_after'
};

// מפתחות i18n לסיבות נעילה — הצרכן קורא ל-t(reasonKey) רק כש-locked=true.
export const EDIT_LOCK_REASON_KEYS = {
    [EDIT_LOCK_MODES.DAYS_AFTER]: 'settings.additional.editLock.reasons.days_after',
    DEFAULT: 'settings.additional.editLock.reasons.default'
};

function normalizeLockDays(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_EDIT_LOCK_DAYS;
    return Math.min(MAX_EDIT_LOCK_DAYS, Math.max(MIN_EDIT_LOCK_DAYS, Math.floor(n)));
}

/**
 * בדיקה אם אירוע נעול לעריכה
 * @param {Object} event - אובייקט האירוע
 * @param {string} lockMode - מצב הנעילה
 * @param {number} [lockDays] - מספר הימים המותרים (רק במצב days_after)
 * @returns {{ locked: boolean, reasonKey: string, reasonParams?: Object }}
 */
export function isEventLocked(event, lockMode, lockDays) {
    if (!lockMode || lockMode === EDIT_LOCK_MODES.NONE) {
        return { locked: false, reasonKey: '' };
    }

    // אירוע זמני הוא תכנון שטרם דווח — ההמרה היא הדיווח עצמו, לכן חלון נעילה לא חל עליו
    if (event?.isTemporary) {
        return { locked: false, reasonKey: '' };
    }

    if (lockMode === EDIT_LOCK_MODES.DAYS_AFTER) {
        const eventDate = event?.start;
        if (!eventDate) return { locked: false, reasonKey: '' };

        const days = normalizeLockDays(lockDays);
        const eventDay = new Date(eventDate);
        eventDay.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((today - eventDay) / (24 * 60 * 60 * 1000));

        if (daysDiff >= days) {
            return {
                locked: true,
                reasonKey: EDIT_LOCK_REASON_KEYS[EDIT_LOCK_MODES.DAYS_AFTER],
                reasonParams: { days }
            };
        }
        return { locked: false, reasonKey: '' };
    }

    return { locked: false, reasonKey: '' };
}
