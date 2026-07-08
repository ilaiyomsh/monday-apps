import { useColumnOptions } from './useColumnOptions';

/**
 * Hook לטעינת ערכי "לא לחיוב" מעמודת status או dropdown
 * Wrapper סביב useColumnOptions עם שם ייעודי ללוגים
 * @param {Object} monday - Monday API instance
 * @param {string} boardId - מזהה הלוח
 * @param {string} columnId - מזהה העמודה
 * @returns {Object} { nonBillableOptions, loading, error }
 */
export const useNonBillableOptions = (monday, boardId, columnId) => {
    const { options, loading, error } = useColumnOptions(monday, boardId, columnId, 'useNonBillableOptions');
    return { nonBillableOptions: options, loading, error };
};
