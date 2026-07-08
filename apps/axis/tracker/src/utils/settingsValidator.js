/**
 * Settings Validator - אימות הגדרות בעת עליית האפליקציה
 * בודק שכל ההגדרות מולאו ושכל העמודות קיימות בלוחות הרלוונטיים
 */

import logger from './logger';
import { safeApi } from './mondayApi';
import { FIELD_MODES, TOGGLE_MODES, DEFAULT_FIELD_CONFIG } from '../contexts/SettingsContext';

/**
 * בדיקה אם עמודות קיימות בלוח
 * @param {object} monday - Monday SDK instance
 * @param {string} boardId - מזהה הלוח
 * @param {string[]} columnIds - רשימת מזהי עמודות לבדיקה
 * @returns {Promise<{valid: boolean, missingColumns: string[]}>}
 */
async function checkColumnsExist(monday, boardId, columnIds) {
    if (!boardId || !columnIds || columnIds.length === 0) {
        return { valid: true, missingColumns: [] };
    }

    try {
        const query = `query {
            boards(ids: [${boardId}]) {
                columns {
                    id
                    title
                }
            }
        }`;

        const response = await safeApi(monday, 'settingsValidator.checkColumnsExist', query);
        const board = response?.data?.boards?.[0];

        if (!board) {
            logger.warn('settingsValidator', `Board not found: ${boardId}`);
            return { valid: false, missingColumns: columnIds, boardNotFound: true };
        }

        const existingColumnIds = board.columns.map(col => col.id);
        const missingColumns = columnIds.filter(colId => colId && !existingColumnIds.includes(colId));

        return {
            valid: missingColumns.length === 0,
            missingColumns,
            existingColumns: board.columns
        };
    } catch (error) {
        logger.error('settingsValidator', 'Error checking columns', error);
        return { valid: true, apiError: true, error };
    }
}

/**
 * בדיקה אם לוח קיים
 * @param {object} monday - Monday SDK instance
 * @param {string} boardId - מזהה הלוח
 * @returns {Promise<{valid: boolean, boardName?: string}>}
 */
async function checkBoardExists(monday, boardId) {
    if (!boardId) {
        return { valid: true };
    }

    try {
        const query = `query {
            boards(ids: [${boardId}]) {
                id
                name
            }
        }`;

        const response = await safeApi(monday, 'settingsValidator.checkBoardExists', query);
        const board = response?.data?.boards?.[0];

        return {
            valid: !!board,
            boardName: board?.name
        };
    } catch (error) {
        logger.error('settingsValidator', 'Error checking board', error);
        return { valid: true, apiError: true, error };
    }
}

/**
 * מחזיר את ההגדרות הנדרשות לפי הגדרת השדות (fieldConfig)
 * @param {object} fieldConfig - הגדרת שדות דיווח
 * @param {boolean} useAssignmentsMode - האם מצב Assignments מופעל
 * @param {string} projectsSourceMode - מקור הפרויקטים ('board' | 'portfolio')
 * @param {string} absenceSource - מקור ההיעדרויות ('tracker' | 'dayoff') - W4.5
 * @returns {object} - רשימת ההגדרות הנדרשות
 */
function getRequiredSettings(fieldConfig, useAssignmentsMode = false, projectsSourceMode = 'board', absenceSource = 'tracker') {
    const isPortfolio = projectsSourceMode === 'portfolio';

    // הגדרות בסיסיות שתמיד נדרשות (פרויקט תמיד חובה)
    const required = {
        boards: [], // לוחות מחוברים
        currentBoardColumns: ['dateColumnId', 'endTimeColumnId', 'durationColumnId', 'projectColumnId', 'reporterColumnId', 'temporaryCheckboxColumnId'],
        optional: ['eventTypeStatusColumnId']
    };

    // עמודת תת-סוג אירוע יומי — חובה רק כשמקור ההיעדרויות הוא ה-tracker עצמו (W4.5).
    // במקור 'dayoff' תפריט סוגי החופשה מגיע מלוח החופשות ולא מעמודה זו.
    if (absenceSource !== 'dayoff') {
        required.currentBoardColumns.push('allDayTypeStatusColumnId');
    } else {
        required.optional.push('allDayTypeStatusColumnId');
    }

    // לוח פרויקטים נדרש תמיד (במצב Portfolio זה לוח ה-Portfolio).
    // במצב Assignments + Portfolio עדיין דרוש connectedBoardId כי הוא משמש
    // לפתרון tasksBoardId דרך portfolio_project_link.
    if (!useAssignmentsMode || isPortfolio) {
        required.boards.push('connectedBoardId');
    }

    // משימות — לפי fieldConfig. במצב Portfolio: tasksBoardId + tasksProjectColumnId
    // נפתרים אוטומטית, לא נדרשים בהגדרות.
    if (fieldConfig.task !== FIELD_MODES.HIDDEN) {
        required.currentBoardColumns.push('taskColumnId');
        if (!isPortfolio) {
            required.boards.push('tasksBoardId');
            required.connectedBoardColumns = ['tasksProjectColumnId'];
        }
    }

    // סיווג — לפי fieldConfig
    if (fieldConfig.stage !== FIELD_MODES.HIDDEN) {
        required.currentBoardColumns.push('stageColumnId');
    }

    // הערות — לפי fieldConfig
    if (fieldConfig.notes !== FIELD_MODES.HIDDEN) {
        required.optional.push('notesColumnId');
    }

    // סיווג (לא לחיוב) — לפי fieldConfig
    if (fieldConfig.billableToggle === TOGGLE_MODES.VISIBLE &&
        fieldConfig.nonBillableType !== FIELD_MODES.HIDDEN) {
        required.optional.push('nonBillableStatusColumnId');
    }

    return required;
}

/**
 * מבצע אימות מלא של ההגדרות
 * @param {object} monday - Monday SDK instance
 * @param {object} customSettings - ההגדרות המותאמות
 * @param {string} currentBoardId - מזהה הלוח הנוכחי
 * @returns {Promise<object>} - תוצאת האימות
 */
export async function validateSettings(monday, customSettings, currentBoardId) {
    const fieldConfig = customSettings?.fieldConfig || DEFAULT_FIELD_CONFIG;
    logger.functionStart('validateSettings', {
        fieldConfig,
        useAssignmentsMode: customSettings?.useAssignmentsMode
    });

    const result = {
        isValid: true,
        errors: [],
        warnings: [],
        missingSettings: [],
        missingColumns: [],
        missingBoards: []
    };

    if (!customSettings) {
        result.isValid = false;
        result.errors.push('לא נמצאו הגדרות מותאמות');
        return result;
    }

    const requiredSettings = getRequiredSettings(
        fieldConfig,
        customSettings.useAssignmentsMode,
        customSettings.projectsSourceMode || 'board',
        customSettings.absenceSource || 'tracker'
    );

    // === בדיקת הגדרות חסרות ===
    
    // בדיקת לוחות מחוברים
    for (const boardSetting of requiredSettings.boards) {
        if (!customSettings[boardSetting]) {
            result.missingSettings.push({
                key: boardSetting,
                label: getBoardSettingLabel(boardSetting)
            });
        }
    }

    // בדיקת עמודות בלוח הנוכחי
    for (const columnSetting of requiredSettings.currentBoardColumns) {
        if (!customSettings[columnSetting]) {
            result.missingSettings.push({
                key: columnSetting,
                label: getColumnSettingLabel(columnSetting)
            });
        }
    }

    // אם יש הגדרות חסרות, סימון שהאימות נכשל
    if (result.missingSettings.length > 0) {
        result.isValid = false;
        result.errors.push(`חסרות ${result.missingSettings.length} הגדרות נדרשות`);
    }

    // === בדיקה שהלוחות קיימים ===

    // בדיקת לוח פרויקטים
    if (customSettings.connectedBoardId) {
        const projectsBoardCheck = await checkBoardExists(monday, customSettings.connectedBoardId);
        if (!projectsBoardCheck.valid) {
            result.isValid = false;
            result.missingBoards.push({
                key: 'connectedBoardId',
                label: 'לוח פרויקטים',
                boardId: customSettings.connectedBoardId
            });
            result.errors.push('לוח הפרויקטים שהוגדר לא נמצא');
        }
    }

    // בדיקת לוח משימות (אם רלוונטי) — מדלגים במצב Portfolio (נפתר אוטומטית)
    if (customSettings.projectsSourceMode !== 'portfolio' &&
        customSettings.tasksBoardId &&
        fieldConfig.task !== FIELD_MODES.HIDDEN) {
        const tasksBoardCheck = await checkBoardExists(monday, customSettings.tasksBoardId);
        if (!tasksBoardCheck.valid) {
            result.isValid = false;
            result.missingBoards.push({
                key: 'tasksBoardId',
                label: 'לוח משימות',
                boardId: customSettings.tasksBoardId
            });
            result.errors.push('לוח המשימות שהוגדר לא נמצא');
        }
    }

    // === בדיקה שהעמודות קיימות בלוח הנוכחי ===
    
    if (currentBoardId) {
        const columnsToCheck = [];
        
        // איסוף כל העמודות שהוגדרו
        const columnSettings = [
            'dateColumnId', 'endTimeColumnId', 'durationColumnId', 'projectColumnId',
            'taskColumnId', 'reporterColumnId', 'eventTypeStatusColumnId',
            'nonBillableStatusColumnId', 'stageColumnId', 'notesColumnId',
            'temporaryCheckboxColumnId', 'allDayTypeStatusColumnId'
        ];

        for (const setting of columnSettings) {
            if (customSettings[setting]) {
                columnsToCheck.push(customSettings[setting]);
            }
        }

        if (columnsToCheck.length > 0) {
            const columnsCheck = await checkColumnsExist(monday, currentBoardId, columnsToCheck);
            
            if (!columnsCheck.valid) {
                if (columnsCheck.boardNotFound) {
                    result.isValid = false;
                    result.errors.push('הלוח הנוכחי לא נמצא');
                } else if (columnsCheck.missingColumns.length > 0) {
                    result.isValid = false;
                    
                    // מיפוי העמודות החסרות לשמות מובנים
                    for (const missingColId of columnsCheck.missingColumns) {
                        const settingKey = columnSettings.find(key => customSettings[key] === missingColId);
                        result.missingColumns.push({
                            columnId: missingColId,
                            settingKey,
                            label: getColumnSettingLabel(settingKey)
                        });
                    }
                    
                    result.errors.push(`נמצאו ${columnsCheck.missingColumns.length} עמודות חסרות בלוח`);
                }
            }
        }
    }

    // === מקור היעדרויות Day-off (W4.5) ===
    // כשמקור ההיעדרויות הוא לוח החופשות — מיפוי הלוח והעמודות הקריטיות הופך חובה,
    // והכשל חייב להיות רועש (אין EMPTY_MAP שקט — ראה Day-off/CONTRACT.md סעיף 5.6).
    if (customSettings.absenceSource === 'dayoff') {
        // עמודות חובה תמיד; עמודת האישור חובה רק כשמדיניות האישור פעילה (D2)
        const dayOffRequiredColumns = [
            'dayOffPersonColumnId', 'dayOffStartDateColumnId', 'dayOffEndDateColumnId',
            'dayOffKindColumnId', 'dayOffTypeColumnId'
        ];
        if (customSettings.dayOffApprovalRequired) {
            dayOffRequiredColumns.push('dayOffApprovalColumnId');
        }

        const dayOffMissingBefore = result.missingSettings.length;

        if (!customSettings.dayOffBoardId) {
            result.missingSettings.push({
                key: 'dayOffBoardId',
                label: getBoardSettingLabel('dayOffBoardId')
            });
        }
        for (const setting of dayOffRequiredColumns) {
            if (!customSettings[setting]) {
                result.missingSettings.push({
                    key: setting,
                    label: getColumnSettingLabel(setting)
                });
            }
        }
        // מיפויי לייבלים (label IDs) — קינד תמיד; אישור רק כשהמדיניות פעילה
        if (customSettings.dayOffKindColumnId && !customSettings.dayOffKindGeneralLabelId) {
            result.missingSettings.push({ key: 'dayOffKindGeneralLabelId', label: getColumnSettingLabel('dayOffKindGeneralLabelId') });
        }
        if (customSettings.dayOffKindColumnId && !customSettings.dayOffKindPersonalLabelId) {
            result.missingSettings.push({ key: 'dayOffKindPersonalLabelId', label: getColumnSettingLabel('dayOffKindPersonalLabelId') });
        }
        if (customSettings.dayOffApprovalRequired && customSettings.dayOffApprovalColumnId) {
            if (!customSettings.dayOffApprovedLabelIds || customSettings.dayOffApprovedLabelIds.length === 0) {
                result.missingSettings.push({ key: 'dayOffApprovedLabelIds', label: getColumnSettingLabel('dayOffApprovedLabelIds') });
            }
            if (!customSettings.dayOffPendingLabelIds || customSettings.dayOffPendingLabelIds.length === 0) {
                result.missingSettings.push({ key: 'dayOffPendingLabelIds', label: getColumnSettingLabel('dayOffPendingLabelIds') });
            }
        }
        const dayOffMissingCount = result.missingSettings.length - dayOffMissingBefore;
        if (dayOffMissingCount > 0) {
            result.isValid = false;
            result.errors.push(`חסרות ${dayOffMissingCount} הגדרות נדרשות למקור היעדרויות Day-off`);
        }

        // בדיקה שלוח החופשות קיים ושהעמודות שהוגדרו קיימות בו (העמודות חיות בלוח אחר מלוח הדיווחים)
        if (customSettings.dayOffBoardId) {
            const dayOffBoardCheck = await checkBoardExists(monday, customSettings.dayOffBoardId);
            if (!dayOffBoardCheck.valid) {
                result.isValid = false;
                result.missingBoards.push({
                    key: 'dayOffBoardId',
                    label: getBoardSettingLabel('dayOffBoardId'),
                    boardId: customSettings.dayOffBoardId
                });
                result.errors.push('לוח החופשות שהוגדר לא נמצא');
            } else {
                const dayOffColumnSettings = [
                    'dayOffPersonColumnId', 'dayOffStartDateColumnId', 'dayOffEndDateColumnId',
                    'dayOffKindColumnId', 'dayOffTypeColumnId', 'dayOffApprovalColumnId'
                ];
                const dayOffColumnsToCheck = dayOffColumnSettings
                    .filter(key => customSettings[key])
                    .map(key => customSettings[key]);

                if (dayOffColumnsToCheck.length > 0) {
                    const dayOffColumnsCheck = await checkColumnsExist(monday, customSettings.dayOffBoardId, dayOffColumnsToCheck);
                    if (!dayOffColumnsCheck.valid && dayOffColumnsCheck.missingColumns.length > 0) {
                        result.isValid = false;
                        for (const missingColId of dayOffColumnsCheck.missingColumns) {
                            const settingKey = dayOffColumnSettings.find(key => customSettings[key] === missingColId);
                            result.missingColumns.push({
                                columnId: missingColId,
                                settingKey,
                                label: getColumnSettingLabel(settingKey)
                            });
                        }
                        result.errors.push(`נמצאו ${dayOffColumnsCheck.missingColumns.length} עמודות חסרות בלוח החופשות`);
                    }
                }
            }
        }
    }

    // === אזהרות על הגדרות אופציונליות ===

    if (!customSettings.eventTypeStatusColumnId) {
        result.warnings.push('מומלץ להגדיר עמודת סוג דיווח לסינון אירועים');
    } else if (!customSettings.eventTypeMapping) {
        result.warnings.push('עמודת סוג דיווח נבחרה אך לא הוגדר מיפוי סוגי דיווח');
    }

    if (fieldConfig.notes !== FIELD_MODES.HIDDEN && !customSettings.notesColumnId) {
        result.warnings.push('שדה הערות פעיל אך לא הוגדרה עמודה');
    }

    logger.functionEnd('validateSettings', { 
        isValid: result.isValid, 
        errorsCount: result.errors.length,
        warningsCount: result.warnings.length
    });

    return result;
}

/**
 * מחזיר תווית לשדה לוח
 */
function getBoardSettingLabel(key) {
    const labels = {
        connectedBoardId: 'לוח פרויקטים',
        tasksBoardId: 'לוח משימות',
        dayOffBoardId: 'לוח חופשות (Day-off)'
    };
    return labels[key] || key;
}

/**
 * מחזיר תווית לשדה עמודה
 */
function getColumnSettingLabel(key) {
    const labels = {
        dateColumnId: 'עמודת תאריך התחלה',
        endTimeColumnId: 'עמודת תאריך סיום',
        durationColumnId: 'עמודת משך זמן',
        projectColumnId: 'עמודת פרויקט',
        taskColumnId: 'עמודת משימה',
        reporterColumnId: 'עמודת מדווח',
        eventTypeStatusColumnId: 'עמודת סוג דיווח',
        nonBillableStatusColumnId: 'עמודת סיווג (לא לחיוב)',
        stageColumnId: 'עמודת סיווג',
        notesColumnId: 'עמודת הערות',
        tasksProjectColumnId: 'עמודת קישור פרויקט-משימות',
        temporaryCheckboxColumnId: 'עמודת סימון אירוע עתידי',
        allDayTypeStatusColumnId: 'עמודת תת-סוג אירוע יומי',
        dayOffPersonColumnId: 'עמודת עובד בלוח החופשות',
        dayOffStartDateColumnId: 'עמודת תאריך התחלה בלוח החופשות',
        dayOffEndDateColumnId: 'עמודת תאריך סיום בלוח החופשות',
        dayOffKindColumnId: 'עמודת סוג רשומה (אישי/כללי) בלוח החופשות',
        dayOffKindGeneralLabelId: 'תווית "כללי" בעמודת סוג הרשומה',
        dayOffKindPersonalLabelId: 'תווית "אישי" בעמודת סוג הרשומה',
        dayOffTypeColumnId: 'עמודת סוג היעדרות בלוח החופשות',
        dayOffApprovalColumnId: 'עמודת סטטוס אישור בלוח החופשות',
        dayOffApprovedLabelIds: 'תוויות "מאושר" בעמודת האישור בלוח החופשות',
        dayOffPendingLabelIds: 'תוויות "ממתין לאישור" בעמודת האישור בלוח החופשות'
    };
    return labels[key] || key;
}

/**
 * פורמט תוצאת האימות להודעה למשתמש
 */
export function formatValidationMessage(validationResult) {
    if (validationResult.isValid) {
        return null;
    }

    const lines = [];
    
    if (validationResult.missingSettings.length > 0) {
        lines.push('הגדרות חסרות:');
        validationResult.missingSettings.forEach(s => {
            lines.push(`  • ${s.label}`);
        });
    }

    if (validationResult.missingBoards.length > 0) {
        lines.push('לוחות לא נמצאו:');
        validationResult.missingBoards.forEach(b => {
            lines.push(`  • ${b.label}`);
        });
    }

    if (validationResult.missingColumns.length > 0) {
        lines.push('עמודות לא נמצאו בלוח:');
        validationResult.missingColumns.forEach(c => {
            lines.push(`  • ${c.label}`);
        });
    }

    return lines.join('\n');
}

const settingsValidator = {
    validateSettings,
    formatValidationMessage
};
export default settingsValidator;
