import { useColumnOptions } from './useColumnOptions';

/**
 * Hook לטעינת ערכי שלב מעמודת status או dropdown
 * Wrapper סביב useColumnOptions עם שם ייעודי ללוגים
 * @param {Object} monday - Monday API instance
 * @param {string} boardId - מזהה הלוח
 * @param {string} columnId - מזהה העמודה
 * @returns {Object} { stageOptions, loading, error }
 */
export const useStageOptions = (monday, boardId, columnId) => {
    const { options, loading, error } = useColumnOptions(monday, boardId, columnId, 'useStageOptions');
    return { stageOptions: options, loading, error };
};
