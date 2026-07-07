import React from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import { Navigate } from 'react-big-calendar';
import TimeGrid from 'react-big-calendar/lib/TimeGrid';

// בחירת date-fns locale לפי culture/language. מקור אמת יחיד עבור
// היומן + הוויוז המותאמים. אם culture לא נתמך — נופלים ל-he (שמרני).
const pickLocale = (culture) => {
    if (!culture) return he;
    const c = String(culture).toLowerCase();
    if (c === 'en' || c === 'en-us') return enUS;
    return he;
};

/**
 * יוצר WorkWeekView דינמי לפי ימי עבודה ויום תחילת שבוע
 * @param {number[]} workDays - מערך ימים [0-6], 0=ראשון
 * @param {number} weekStartDay - יום ראשון בשבוע
 */
export const createWorkWeekView = (workDays = [0, 1, 2, 3, 4], weekStartDay = 0, culture = 'he') => {
    const wkStart = Number(weekStartDay) || 0;
    const dateFnsLocale = pickLocale(culture);

    const View = (props) => {
        const { date } = props;
        const range = View.range(date);
        return <TimeGrid {...props} range={range} eventOffset={15} />;
    };

    View.range = (date) => {
        const start = startOfWeek(date, { weekStartsOn: wkStart });
        return workDays
            .map(d => addDays(start, (d - wkStart + 7) % 7))
            .sort((a, b) => a - b);
    };

    View.navigate = (date, action) => {
        switch (action) {
            case Navigate.PREVIOUS: return addDays(date, -7);
            case Navigate.NEXT: return addDays(date, 7);
            case Navigate.TODAY: return new Date();
            default: return date;
        }
    };

    View.title = (date) => format(date, 'MMMM yyyy', { locale: dateFnsLocale });

    return View;
};

/**
 * תצוגת 3 ימים למובייל - היום במרכז
 * Factory — מקבל culture כדי שכותרת החודש תהיה בשפה הנכונה.
 */
export const createThreeDayView = (culture = 'he') => {
    const dateFnsLocale = pickLocale(culture);

    const View = (props) => {
        const { date } = props;
        const range = View.range(date);
        return <TimeGrid {...props} range={range} eventOffset={15} />;
    };

    View.range = (date) => [-1, 0, 1].map(i => addDays(date, i)); // אתמול, היום, מחר

    View.navigate = (date, action) => {
        switch (action) {
            case Navigate.PREVIOUS: return addDays(date, -3);
            case Navigate.NEXT: return addDays(date, 3);
            case Navigate.TODAY: return new Date();
            default: return date;
        }
    };

    View.title = (date) => format(date, 'MMMM yyyy', { locale: dateFnsLocale });

    return View;
};

// יצירת רשימת שעות בקפיצות של 15 דקות
export const generateTimeOptions15Minutes = (minTime = "00:00", maxTime = "23:45") => {
    const times = [];
    const [minHours, minMinutes] = minTime.split(':').map(Number);
    const [maxHours, maxMinutes] = maxTime.split(':').map(Number);
    const minTotalMinutes = minHours * 60 + minMinutes;
    const maxTotalMinutes = maxHours * 60 + maxMinutes;
    
    for (let i = 0; i < 24; i++) {
        for (let j = 0; j < 60; j += 15) {
            const totalMinutes = i * 60 + j;
            if (totalMinutes >= minTotalMinutes && totalMinutes <= maxTotalMinutes) {
                const hour = i.toString().padStart(2, '0');
                const minute = j.toString().padStart(2, '0');
                const label = `${hour}:${minute}`;
                times.push({ value: label, label: label });
            }
        }
    }
    return times;
};

export const timeOptions15Minutes = generateTimeOptions15Minutes();

// יצירת רשימת משכי זמן בקפיצות של 15 דקות (מ-00:30 ומעלה)
export const generateDurationOptions15Minutes = () => {
    const durations = [];
    // מ-15 דקות עד 12 שעות
    for (let i = 0; i <= 12; i++) {
        for (let j = 0; j < 60; j += 15) {
            const totalMinutes = i * 60 + j;
            if (totalMinutes < 30) continue; // מינימום 30 דקות
            const hour = i.toString().padStart(2, '0');
            const minute = j.toString().padStart(2, '0');
            const label = `${hour}:${minute}`;
            durations.push({ value: label, label: label });
        }
    }
    return durations;
};

export const durationOptions15Minutes = generateDurationOptions15Minutes();

export const roundToNearest15Minutes = (date) => {
    if (!date || !(date instanceof Date)) return date;
    const rounded = new Date(date);
    const minutes = rounded.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;
    if (roundedMinutes === 60) {
        rounded.setHours(rounded.getHours() + 1);
        rounded.setMinutes(0);
    } else {
        rounded.setMinutes(roundedMinutes);
    }
    rounded.setSeconds(0);
    rounded.setMilliseconds(0);
    return rounded;
};

export const DEFAULT_MIN_TIME = new Date(1970, 1, 1, 6, 0, 0);
export const DEFAULT_MAX_TIME = new Date(1970, 1, 1, 22, 0, 0);

/**
 * קבועי הגדרות ברירת מחדל ללוח השנה
 */
export const CALENDAR_DEFAULTS = {
    // זמן גלילה ראשוני - 08:00 בבוקר
    SCROLL_TO_TIME: new Date(1970, 1, 1, 8, 0, 0),
    // שעות הצגה - 00:00 עד 23:59
    MIN_HOUR: 0,
    MAX_HOUR: 23,
    // קפיצות זמן
    STEP_MINUTES: 15,
    TIMESLOTS_PER_HOUR: 4,
    // ימי שבוע עבודה (ראשון עד חמישי)
    WORK_WEEK_DAYS: [0, 1, 2, 3, 4]
};

export const formats = {
    timeGutterFormat: (date, culture, localizer) =>
        localizer.format(date, 'HH:mm', culture),
    eventTimeRangeFormat: ({ start, end }, culture, localizer) =>
        `${localizer.format(start, 'HH:mm', culture)} - ${localizer.format(end, 'HH:mm', culture)}`,
    agendaTimeRangeFormat: ({ start, end }, culture, localizer) =>
        `${localizer.format(start, 'HH:mm', culture)} - ${localizer.format(end, 'HH:mm', culture)}`,
    dayHeaderFormat: (date, culture, localizer) =>
        localizer.format(date, 'EEEE d', culture),
};
