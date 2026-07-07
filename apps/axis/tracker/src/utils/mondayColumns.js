/**
 * ניהול מיפוי ופרסור של עמודות Monday
 */

import { format, parse } from 'date-fns';
import logger from './logger';
import { isAllDayEventType, parseDuration, calculateEndDateFromDays } from './durationUtils';

/**
 * בדיקה אם הערך הוא אובייקט Date תקין (לא Invalid Date)
 * @param {*} date
 * @returns {boolean}
 */
const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * קבלת מזהי העמודות מההגדרות
 */
export const getColumnIds = (settings) => {
    if (!settings) return null;

    const columnIds = {
        startDate: null,
        duration: null,
        connectedItem: null,
        status: null,
        eventTypeStatus: null,
        notes: null
    };

    // חילוץ מזהה עמודת תאריך התחלה
    if (settings.start_date) {
        columnIds.startDate = Object.keys(settings.start_date)[0];
    }

    // חילוץ מזהה עמודת משך זמן
    if (settings.daurtion) { // שים לב לאיות המקורי בהגדרות
        columnIds.duration = Object.keys(settings.daurtion)[0];
    }

    // חילוץ מזהה עמודת board relation
    if (settings.perent_item_board) {
        columnIds.connectedItem = Object.keys(settings.perent_item_board)[0];
    }

    // הוספת עמודות סטטוס והערות
    if (settings.status) {
        columnIds.status = Object.keys(settings.status)[0];
    }
    
    if (settings.event_type_status) {
        columnIds.eventTypeStatus = Object.keys(settings.event_type_status)[0];
    }
    
    if (settings.notes) {
        columnIds.notes = Object.keys(settings.notes)[0];
    }

    return columnIds;
};

/**
 * פרסור ערך עמודת Date (עם time)
 * @param {string} valueJson - JSON string של העמודה
 * @returns {Date|null} - תאריך + שעה או null
 */
export const parseDateColumn = (valueJson) => {
    if (!valueJson) return null;
    
    try {
        const parsed = JSON.parse(valueJson);
        if (!parsed.date) return null;
        
        // אם יש time, נשלב אותו
        const dateStr = parsed.time 
            ? `${parsed.date} ${parsed.time}`
            : `${parsed.date} 00:00:00`;
        
        return parse(dateStr, 'yyyy-MM-dd HH:mm:ss', new Date());
    } catch (error) {
        // לוג שגיאה קריטי - נשאר פעיל גם בפרודקשן
        logger.error('mondayColumns', 'Error parsing date column', error);
        return null;
    }
};

/**
 * פרסור ערך עמודת Hour (duration)
 * @param {string} valueJson - JSON string של העמודה
 * @returns {number} - משך הזמן בדקות
 */
export const parseHourColumn = (valueJson) => {
    if (!valueJson) return 60; // ברירת מחדל: שעה אחת
    
    try {
        const parsed = JSON.parse(valueJson);
        const hours = parsed.hour || 0;
        const minutes = parsed.minute || 0;
        return hours * 60 + minutes;
    } catch (error) {
        // לוג שגיאה קריטי - נשאר פעיל גם בפרודקשן
        logger.error('mondayColumns', 'Error parsing hour column', error);
        return 60;
    }
};

/**
 * פרסור ערך עמודת Board Relation
 * @param {string} valueJson - JSON string של העמודה
 * @returns {Array} - מערך של IDs של אייטמים מקושרים
 */
export const parseBoardRelationColumn = (valueJson) => {
    if (!valueJson) return [];
    
    try {
        const parsed = JSON.parse(valueJson);
        return parsed.linkedPulseIds || [];
    } catch (error) {
        // לוג שגיאה קריטי - נשאר פעיל גם בפרודקשן
        logger.error('mondayColumns', 'Error parsing board relation column', error);
        return [];
    }
};

/**
 * המרת אייטם מ-Monday לאירוע בלוח
 * @param {Object} item - אייטם מ-Monday
 * @param {Object} columnIds - מזהי העמודות (כולל סוג האירוע)
 * @returns {Object|null} - אירוע ללוח או null
 */
export const mapItemToEvent = (item, columnIds) => {
    if (!item || !columnIds) return null;

    // מציאת העמודות הרלוונטיות
    const dateColumn = item.column_values?.find(col => col.id === columnIds.startDate);
    const durationColumn = item.column_values?.find(col => col.id === columnIds.duration);
    const typeColumn = item.column_values?.find(col => col.id === columnIds.eventTypeStatus);
    
    // פרסור תאריך התחלה
    const startDate = parseDateColumn(dateColumn?.value);
    if (!startDate) {
        return null;
    }

    // זיהוי סוג האירוע
    const eventType = typeColumn?.text || '';
    const isAllDay = isAllDayEventType(eventType);

    // חילוץ משך גולמי
    let rawDuration = 0;
    const durationValue = durationColumn?.value;
    if (durationValue) {
        rawDuration = parseHourColumn(durationValue) / 60; // המרה לשעות עשרוניות
    }

    // פרסור Duration פולימורפי
    const duration = parseDuration(rawDuration, eventType);

    let endDate;
    if (isAllDay) {
        // אירוע יומי - duration מייצג ימים
        startDate.setHours(0, 0, 0, 0);
        endDate = calculateEndDateFromDays(startDate, duration.value);
    } else {
        // אירוע שעתי - duration מייצג שעות
        const durationMinutes = Math.round(duration.value * 60);
        const effectiveDurationMinutes = durationMinutes > 0 ? durationMinutes : 60;
        endDate = new Date(startDate.getTime() + effectiveDurationMinutes * 60000);
    }

    return {
        id: item.id,
        title: item.name,
        start: startDate,
        end: endDate,
        allDay: isAllDay,
        eventType: eventType,
        mondayItemId: item.id,
        notes: item.column_values?.find(col => col.id === columnIds.notes)?.text || '',
        durationDays: isAllDay ? duration.value : null
    };
};

/**
 * בניית column_values ליצירת אייטם חדש
 * @param {Date} startDate - תאריך ושעת התחלה
 * @param {Date} endDate - תאריך ושעת סיום
 * @param {Object} columnIds - מזהי העמודות
 * @returns {string} - JSON string של column_values
 */
export const buildColumnValues = (startDate, endDate, columnIds) => {
    if (!startDate || !endDate || !columnIds) {
        throw new Error('Missing required parameters for buildColumnValues');
    }

    // אובייקט Date לא תקין הוא truthy ויעבור את הבדיקה למעלה — חוסם כתיבת "NaN"/Invalid Date
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
        // אותו instance לרישום ולזריקה — log-once מקפל לרשומה אחת
        const dateErr = new Error('Invalid date passed to buildColumnValues');
        dateErr.details = { startDate, endDate };
        logger.error('mondayColumns', 'buildColumnValues: תאריך התחלה/סיום לא תקין', dateErr);
        throw dateErr;
    }

    // חישוב משך זמן
    const durationMinutes = Math.round((endDate - startDate) / 60000);
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    // פורמט תאריך ושעה
    const dateStr = format(startDate, 'yyyy-MM-dd');
    const timeStr = format(startDate, 'HH:mm:ss');

    const columnValues = {};

    // עמודת תאריך + שעה
    if (columnIds.startDate) {
        columnValues[columnIds.startDate] = {
            date: dateStr,
            time: timeStr
        };
    }

    // עמודת משך זמן
    if (columnIds.duration) {
        columnValues[columnIds.duration] = {
            hour: hours,
            minute: minutes
        };
    }

    // אל תשלח עמודת board relation - נשתמש בשם האייטם בלבד

    return JSON.stringify(columnValues);
};

/**
 * בניית query לשליפת אירועים בטווח תאריכים
 * @param {number} boardId - ID של הלוח
 * @param {Date} startDate - תחילת הטווח
 * @param {Date} endDate - סוף הטווח
 * @param {string} dateColumnId - ID של עמודת התאריך
 * @returns {string} - GraphQL query
 */
export const buildFetchEventsQuery = (boardId, startDate, endDate, dateColumnId) => {
    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    return `query {
        boards(ids: [${boardId}]) {
            items_page(
                limit: 500,
                query_params: {
                    rules: [{
                        column_id: "${dateColumnId}",
                        compare_value: ["${startStr}", "${endStr}"],
                        operator: between
                    }]
                }
            ) {
                items {
                    id
                    name
                    column_values {
                        id
                        type
                        text
                        value
                    }
                }
            }
        }
    }`;
};

/**
 * תווית לרכיבי בחירת עמודה בהגדרות: שם העמודה בלוח; אם אין title תקין — המזהה.
 */
export const columnSelectLabel = (col) => {
  if (!col) return '';
  const t = col.title;
  if (t != null && String(t).trim() !== '') return String(t).trim();
  return col.id;
};

