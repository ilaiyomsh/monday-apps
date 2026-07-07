import { useMemo } from 'react';
import { useUndoDelete } from './useUndoDelete';

/**
 * Hook לחיווט הצרכן של מחיקה-עם-undo (גל 5.1.3, F005)
 *
 * עוטף את useUndoDelete (שמחזיק במכונת המצב של commit/undo + הטיימר של 4 שניות)
 * וחושף לצרכן שני slot-ים נפרדים:
 *   1. `undoDelete` — חוזה ה-API המקורי המלא (scheduleDelete + undoDelete + isVisible + message),
 *      כך ש-call-sites של scheduleDelete (handleDeleteEvent / handleDeleteAllDayEvent / useCalendarSelection)
 *      ממשיכים לעבוד ללא שינוי.
 *   2. `banner` — תצוגת ה-UndoBanner בצורה ייעודית (`isVisible`, `message`, `onUndo`) כדי שה-JSX
 *      יוכל לעשות `<UndoBanner {...banner} />` במקום שלוש קריאות נפרדות לתוך undoDelete.
 *
 * @param {Object} params
 * @param {Object} params.monday - Monday SDK instance
 * @param {Function} params.restoreEvents - החזרת אירועים שנמחקו ל-state
 * @returns {{ undoDelete: Object, banner: { isVisible: boolean, message: string, onUndo: Function } }}
 */
// הערה: showError הוסר — כשלי מחיקה מוצגים דרך ה-UI sink (נתיב הצגה יחיד)
export const useUndoState = ({ monday, restoreEvents }) => {
    const undoDelete = useUndoDelete({ monday, restoreEvents });

    // banner — slot ייעודי ל-UndoBanner; זהות יציבה לפי השדות שהבאנר באמת קורא
    const banner = useMemo(() => ({
        isVisible: undoDelete.isVisible,
        message: undoDelete.message,
        onUndo: undoDelete.undoDelete,
    }), [undoDelete.isVisible, undoDelete.message, undoDelete.undoDelete]);

    return { undoDelete, banner };
};
