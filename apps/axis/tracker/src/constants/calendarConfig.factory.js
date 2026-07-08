import { format, parse, getDay, startOfWeek } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import { dateFnsLocalizer } from 'react-big-calendar';

/**
 * Calendar config factory (Increment 6).
 *
 * הופך את calendarConfig מקובץ קבוע לקבצי-בסיס פרמטריים. כל הרכיבים
 * שצורכים את הקובץ עוברים דרך factory עם {language, weekStartDay,
 * workDays, timeFormat} — מה שמאפשר locales שונים בלי שכפול קוד.
 *
 * שמרנות: כברירת מחדל מחזיר עברית. שפה לא נתמכת נופלת ל-he (לא לאנגלית
 * — כדי לא להפתיע משתמשים קיימים אם הקונטקסט מחזיר ערך מוזר).
 */

const SUPPORTED = ['he', 'en'];

const DATE_FNS_LOCALES = {
    he,
    en: enUS
};

// פונקציות module-level — מבטיחות שאותו createMessages יחזיר את אותם
// ערכי function (toEqual של ויטסט תופס שוויון רפרנס בלבד).
const SHOW_MORE_HE = total => `+ עוד ${total}`;
const SHOW_MORE_EN = total => `+ ${total} more`;

/**
 * messages של react-big-calendar — 12 מפתחות חובה.
 *
 * @param {'he' | 'en'} language
 * @returns {Object<string, string>}
 */
export function createMessages(language) {
    const lang = SUPPORTED.includes(language) ? language : 'he';

    if (lang === 'en') {
        return {
            today: 'Today',
            previous: 'Previous',
            next: 'Next',
            month: 'Month',
            week: 'Week',
            work_week: 'Work week',
            three_day: '3 days',
            day: 'Day',
            agenda: 'Agenda',
            date: 'Date',
            time: 'Time',
            event: 'Event',
            allDay: 'All day',
            noEventsInRange: 'No events in this range',
            showMore: SHOW_MORE_EN
        };
    }

    return {
        today: 'היום',
        previous: 'קודם',
        next: 'הבא',
        month: 'חודש',
        week: 'שבוע',
        work_week: 'שבוע עבודה',
        three_day: '3 ימים',
        day: 'יום',
        agenda: 'סדר יום',
        date: 'תאריך',
        time: 'שעה',
        event: 'אירוע',
        allDay: 'כל היום',
        noEventsInRange: 'אין אירועים בטווח זה',
        showMore: SHOW_MORE_HE
    };
}

/**
 * localizer של react-big-calendar עם startOfWeek שמכבד weekStartDay.
 *
 * @param {object} options
 * @param {'he' | 'en'} [options.language='he']
 * @param {number} [options.weekStartDay=0] 0=ראשון, 1=שני, ... 6=שבת
 */
export function createLocalizer({ language = 'he', weekStartDay = 0 } = {}) {
    // weekStartsOn של date-fns מחייב number (0–6). settings מ-storage עלולים לחזור
    // כסטרינג ("0"), מה שגרם ל-RangeError "Invalid time value" ב-rbc internals.
    const wkStart = Number(weekStartDay) || 0;

    const customStartOfWeek = (date) => startOfWeek(date, { weekStartsOn: wkStart });

    const baseLocalizer = dateFnsLocalizer({
        format,
        parse,
        startOfWeek: customStartOfWeek,
        getDay,
        // רושמים את שני ה-locales תמיד + alias 'en-US' כדי לסבול קוד שמעביר culture
        // לא תואם. במצב קודם ה-rbc internal ניסה locales['he']/['en-US'] ולא מצא,
        // ו-format() נקרא עם locale=undefined → קריסות בתצוגות week/month.
        locales: { he, en: enUS, 'en-US': enUS, 'he-IL': he }
    });

    // חושפים את ה-startOfWeek-of-date כ-customStartOfWeek (Date → Date)
    // תחת שם נפרד ולא דורסים את `localizer.startOfWeek` ש-rbc משתמש בו
    // (firstOfWeek שמחזיר NUMBER 0–6). דריסה גרמה ל-rbc visibleDays
    // לקרוא startOfWeek ללא ארגומנטים → undefined → קריסה ב-Month view
    // ("Cannot read properties of undefined (reading '0')").
    baseLocalizer.customStartOfWeek = customStartOfWeek;
    return baseLocalizer;
}

/**
 * formats של react-big-calendar — locale-aware.
 *
 * @param {'he' | 'en'} language
 */
function createFormats(language) {
    const lang = SUPPORTED.includes(language) ? language : 'he';
    const dateFnsLocale = DATE_FNS_LOCALES[lang];

    return {
        monthHeaderFormat: (date) => format(date, 'MMMM yyyy', { locale: dateFnsLocale }),
        dayHeaderFormat: (date) => format(date, 'EEEE, dd/MM', { locale: dateFnsLocale }),
        dayRangeHeaderFormat: ({ start, end }) =>
            `${format(start, 'dd/MM', { locale: dateFnsLocale })} – ${format(end, 'dd/MM', { locale: dateFnsLocale })}`,
        weekdayFormat: (date) => format(date, 'EEEE', { locale: dateFnsLocale }),
        agendaDateFormat: (date) => format(date, 'EEEE, dd/MM/yyyy', { locale: dateFnsLocale }),
        agendaHeaderFormat: ({ start, end }) =>
            `${format(start, 'dd/MM/yyyy', { locale: dateFnsLocale })} – ${format(end, 'dd/MM/yyyy', { locale: dateFnsLocale })}`
    };
}

/**
 * factory ראשי שמרכיב הכל ביחד.
 *
 * @param {object} options
 * @param {'he' | 'en'} options.language
 * @param {number} [options.weekStartDay=0]
 * @param {number[]} [options.workDays=[0,1,2,3,4]]
 * @param {'24h' | '12h'} [options.timeFormat='24h']
 * @returns {{ localizer, messages, formats }}
 */
export function createCalendarConfig({
    language,
    weekStartDay = 0,
    workDays = [0, 1, 2, 3, 4], // eslint-disable-line no-unused-vars
    timeFormat = '24h' // eslint-disable-line no-unused-vars
} = {}) {
    return {
        localizer: createLocalizer({ language, weekStartDay }),
        messages: createMessages(language),
        formats: createFormats(language)
    };
}

const calendarConfigFactory = {
    createCalendarConfig,
    createLocalizer,
    createMessages
};
export default calendarConfigFactory;
