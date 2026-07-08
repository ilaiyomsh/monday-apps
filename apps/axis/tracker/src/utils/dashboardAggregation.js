/**
 * פונקציות אגרגציה לדשבורד - Pure functions, ללא React
 * מחשבות סטטיסטיקות, קיבוץ לפי גרנולריות, ונתוני עוגה
 */

import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns';
import { he } from 'date-fns/locale';
import logger from './logger';

/**
 * בדיקה אם הערך הוא אובייקט Date תקין (לא Invalid Date)
 * @param {*} date
 * @returns {boolean}
 */
const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * חילוץ שעות מאירוע דשבורד
 * @param {Object} event - DashboardEvent
 * @returns {number}
 */
export const getEventHours = (event) => {
    return event?.hours || 0;
};

/**
 * חישוב סטטיסטיקות כלליות
 * @param {Array} events - רשימת DashboardEvent
 * @returns {{ totalHours: number, billableHours: number, nonBillableHours: number, billablePercent: number }}
 */
export const calcStats = (events) => {
    if (!events || events.length === 0) {
        return { totalHours: 0, billableHours: 0, nonBillableHours: 0, billablePercent: 0 };
    }

    let totalHours = 0;
    let billableHours = 0;
    let nonBillableHours = 0;

    for (const event of events) {
        const hours = getEventHours(event);
        totalHours += hours;
        if (event.isBillable) {
            billableHours += hours;
        } else {
            nonBillableHours += hours;
        }
    }

    const billablePercent = totalHours > 0
        ? Math.round((billableHours / totalHours) * 100)
        : 0;

    return {
        totalHours: Math.round(totalHours * 100) / 100,
        billableHours: Math.round(billableHours * 100) / 100,
        nonBillableHours: Math.round(nonBillableHours * 100) / 100,
        billablePercent
    };
};

/**
 * יצירת תווית עברית לטווח שבועי
 * אותו חודש: "5-11 ינו׳", חודשים שונים: "28 דצמ׳-3 ינו׳"
 */
const formatWeekLabel = (start, end, dateFnsLocale = he) => {
    if (!isValidDate(start) || !isValidDate(end)) {
        logger.warn('dashboardAggregation', 'formatWeekLabel: תאריך לא תקין', { start, end });
        return '';
    }
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) {
        return `${start.getDate()}-${end.getDate()} ${format(start, 'MMM', { locale: dateFnsLocale })}`;
    }
    return `${start.getDate()} ${format(start, 'MMM', { locale: dateFnsLocale })}-${end.getDate()} ${format(end, 'MMM', { locale: dateFnsLocale })}`;
};

/**
 * יצירת תווית עברית לטווח תאריכים (עבור עמודות מאוחדות)
 */
const formatRangeLabel = (start, end, dateFnsLocale = he) => {
    if (!isValidDate(start) || !isValidDate(end)) {
        logger.warn('dashboardAggregation', 'formatRangeLabel: תאריך לא תקין', { start, end });
        return '';
    }
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) {
        return `${start.getDate()}-${end.getDate()} ${format(start, 'MMM', { locale: dateFnsLocale })}`;
    }
    return `${start.getDate()} ${format(start, 'MMM', { locale: dateFnsLocale })}-${end.getDate()} ${format(end, 'MMM', { locale: dateFnsLocale })}`;
};

/**
 * קיבוץ אירועים לפי גרנולריות זמן
 * @param {Array} events - רשימת DashboardEvent
 * @param {'day'|'week'|'month'|'year'} granularity
 * @returns {Array<{ key: string, label: string, hours: number }>}
 */
export const groupByGranularity = (events, granularity, weekStartsOn = 0, dateFnsLocale = he) => {
    if (!events || events.length === 0) return [];

    const groups = {};

    for (const event of events) {
        const date = event.date;
        if (!date) continue;
        // Invalid Date הוא truthy ויעבור את הבדיקה למעלה — דילוג למניעת זריקת RangeError מ-format
        if (!isValidDate(date)) {
            logger.warn('dashboardAggregation', 'groupByGranularity: אירוע עם תאריך לא תקין דולג', event);
            continue;
        }

        let key, label, startDate, endDate;

        switch (granularity) {
            case 'day': {
                const d = String(date.getDate()).padStart(2, '0');
                const m = String(date.getMonth() + 1).padStart(2, '0');
                key = `${date.getFullYear()}-${m}-${d}`;
                label = format(date, 'd MMM', { locale: dateFnsLocale });
                startDate = date;
                endDate = date;
                break;
            }
            case 'week': {
                const ws = startOfWeek(date, { weekStartsOn });
                const we = endOfWeek(date, { weekStartsOn });
                const wNum = String(Math.ceil(((ws - new Date(ws.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0');
                key = `${ws.getFullYear()}-W${wNum}`;
                label = formatWeekLabel(ws, we, dateFnsLocale);
                startDate = ws;
                endDate = we;
                break;
            }
            case 'month': {
                const m = String(date.getMonth() + 1).padStart(2, '0');
                key = `${date.getFullYear()}-${m}`;
                label = format(date, 'MMM yy', { locale: dateFnsLocale });
                startDate = startOfMonth(date);
                endDate = endOfMonth(date);
                break;
            }
            case 'year': {
                key = String(date.getFullYear());
                label = key;
                startDate = new Date(date.getFullYear(), 0, 1);
                endDate = new Date(date.getFullYear(), 11, 31);
                break;
            }
            default:
                continue;
        }

        if (!groups[key]) {
            groups[key] = { key, label, hours: 0, startDate, endDate };
        }
        groups[key].hours += getEventHours(event);
    }

    // מיון לפי key כרונולוגי
    return Object.values(groups)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(g => ({ ...g, hours: Math.round(g.hours * 100) / 100 }));
};

/**
 * בניית נתונים לתרשים עוגה
 * @param {Array} events - רשימת DashboardEvent (כבר מסוננים לקטגוריה)
 * @param {'billable'|'nonBillable'} type - סוג הקיבוץ
 * @returns {Array<{ name: string, value: number, color: string }>}
 */
export const buildPieData = (events, type) => {
    if (!events || events.length === 0) return [];

    const groups = {};

    for (const event of events) {
        // קיבוץ לפי לייבל — billable: stageLabel, nonBillable: nonBillableType
        const groupKey = type === 'nonBillable'
            ? (event.nonBillableType || 'אחר')
            : (event.stageLabel || event.eventTypeLabel || 'פרויקטים');
        const color = type === 'nonBillable'
            ? (event.nonBillableColor || event.eventTypeColor || '#0073ea')
            : (event.stageColor || event.eventTypeColor || '#0073ea');

        if (!groups[groupKey]) {
            groups[groupKey] = { name: groupKey, value: 0, color };
        }
        groups[groupKey].value += getEventHours(event);
    }

    return Object.values(groups)
        .map(g => ({ ...g, value: Math.round(g.value * 100) / 100 }))
        .sort((a, b) => b.value - a.value);
};

/**
 * אגרגציה משולבת — מעבר יחיד על המערך
 * מחשב stats + פיצול billable/nonBillable + קיבוץ גרנולריות + pie data בבת אחת
 * @param {Array} events - רשימת DashboardEvent מסוננת
 * @param {'day'|'week'|'month'|'year'} granularity
 * @returns {{ stats, barData, billablePieData, nonBillablePieData }}
 */
export const aggregateAll = (events, granularity, enableDistinction = false, reporters = [], weekStartsOn = 0, dateFnsLocale = he) => {
    if (!events || events.length === 0) {
        return {
            stats: { totalHours: 0, billableHours: 0, nonBillableHours: 0, billablePercent: 0,
                     internalHours: 0, externalHours: 0, routineHours: 0 },
            barData: [],
            billablePieData: [],
            nonBillablePieData: [],
            internalPieData: [],
            externalPieData: [],
            routinePieData: [],
            employeeBarData: []
        };
    }

    let totalHours = 0;
    let billableHours = 0;
    let nonBillableHours = 0;
    let internalHours = 0, externalHours = 0, routineHours = 0;
    // צבעי קטגוריות מעמודת הסטטוס (נלקח מהאירוע הראשון בכל קטגוריה)
    let internalColor = null, externalColor = null, routineColor = null;
    const granularityGroups = {};
    const billablePieGroups = {};
    const nonBillablePieGroups = {};
    const internalPieGroups = {}, externalPieGroups = {}, routinePieGroups = {};
    const employeeGroups = {};

    for (const event of events) {
        const hours = event?.hours || 0;
        totalHours += hours;

        // פיצול billable / non-billable + pie groups
        if (event.isBillable) {
            billableHours += hours;
            // קיבוץ לפי stageLabel (עמודת סיווג) עם צבע מהעמודה, fallback ל-eventTypeLabel
            const groupKey = event.stageLabel || event.eventTypeLabel || 'פרויקטים';
            const color = event.stageColor || event.eventTypeColor || '#0073ea';
            if (!billablePieGroups[groupKey]) {
                billablePieGroups[groupKey] = { name: groupKey, value: 0, color };
            }
            billablePieGroups[groupKey].value += hours;
        } else {
            nonBillableHours += hours;
            // קיבוץ לפי nonBillableType עם צבע מעמודת nonBillableStatus
            const groupKey = event.nonBillableType || 'אחר';
            const color = event.nonBillableColor || event.eventTypeColor || '#0073ea';
            if (!nonBillablePieGroups[groupKey]) {
                nonBillablePieGroups[groupKey] = { name: groupKey, value: 0, color };
            }
            nonBillablePieGroups[groupKey].value += hours;
        }

        // פיצול 3-כיווני למצב הבחנה
        if (enableDistinction) {
            if (event.category === 'internalProject') {
                internalHours += hours;
                if (!internalColor) internalColor = event.eventTypeColor;
                const gk = event.stageLabel || 'פנימי';
                const gc = event.stageColor || event.eventTypeColor || '#0073ea';
                if (!internalPieGroups[gk]) internalPieGroups[gk] = { name: gk, value: 0, color: gc };
                internalPieGroups[gk].value += hours;
            } else if (event.category === 'externalProject') {
                externalHours += hours;
                if (!externalColor) externalColor = event.eventTypeColor;
                const gk = event.stageLabel || 'חיצוני';
                const gc = event.stageColor || event.eventTypeColor || '#00ca72';
                if (!externalPieGroups[gk]) externalPieGroups[gk] = { name: gk, value: 0, color: gc };
                externalPieGroups[gk].value += hours;
            } else if (event.category === 'routine') {
                routineHours += hours;
                if (!routineColor) routineColor = event.eventTypeColor;
                const gk = event.nonBillableType || 'אחר';
                const gc = event.nonBillableColor || event.eventTypeColor || '#fdab3d';
                if (!routinePieGroups[gk]) routinePieGroups[gk] = { name: gk, value: 0, color: gc };
                routinePieGroups[gk].value += hours;
            }
        }

        // אגרגציה לפי עובד
        if (event.reporterId != null) {
            const empKey = String(event.reporterId);
            if (!employeeGroups[empKey]) {
                employeeGroups[empKey] = {
                    reporterId: empKey,
                    billable: 0, nonBillable: 0,
                    internalProject: 0, externalProject: 0, routine: 0,
                    total: 0
                };
            }
            const eg = employeeGroups[empKey];
            eg.total += hours;
            if (event.isBillable) {
                eg.billable += hours;
            } else {
                eg.nonBillable += hours;
            }
            if (enableDistinction) {
                if (event.category === 'internalProject') eg.internalProject += hours;
                else if (event.category === 'externalProject') eg.externalProject += hours;
                else if (event.category === 'routine') eg.routine += hours;
            }
        }

        // קיבוץ גרנולריות
        const date = event.date;
        if (!date) continue;
        // Invalid Date הוא truthy ויעבור את הבדיקה למעלה — דילוג למניעת זריקת RangeError מ-format
        if (!isValidDate(date)) {
            logger.warn('dashboardAggregation', 'aggregateAll: אירוע עם תאריך לא תקין דולג מהקיבוץ', event);
            continue;
        }

        let key, label, startDate, endDate;
        switch (granularity) {
            case 'day': {
                const d = String(date.getDate()).padStart(2, '0');
                const m = String(date.getMonth() + 1).padStart(2, '0');
                key = `${date.getFullYear()}-${m}-${d}`;
                label = format(date, 'd MMM', { locale: dateFnsLocale });
                startDate = date;
                endDate = date;
                break;
            }
            case 'week': {
                const ws = startOfWeek(date, { weekStartsOn });
                const we = endOfWeek(date, { weekStartsOn });
                const wNum = String(Math.ceil(((ws - new Date(ws.getFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0');
                key = `${ws.getFullYear()}-W${wNum}`;
                label = formatWeekLabel(ws, we, dateFnsLocale);
                startDate = ws;
                endDate = we;
                break;
            }
            case 'month': {
                const m = String(date.getMonth() + 1).padStart(2, '0');
                key = `${date.getFullYear()}-${m}`;
                label = format(date, 'MMM yy', { locale: dateFnsLocale });
                startDate = startOfMonth(date);
                endDate = endOfMonth(date);
                break;
            }
            case 'year': {
                key = String(date.getFullYear());
                label = key;
                startDate = new Date(date.getFullYear(), 0, 1);
                endDate = new Date(date.getFullYear(), 11, 31);
                break;
            }
            default:
                continue;
        }
        if (!granularityGroups[key]) {
            granularityGroups[key] = { key, label, hours: 0, startDate, endDate };
        }
        granularityGroups[key].hours += hours;
    }

    const billablePercent = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;
    const round2 = v => Math.round(v * 100) / 100;
    const sortedPie = (groups) => Object.values(groups)
        .map(g => ({ ...g, value: round2(g.value) }))
        .sort((a, b) => b.value - a.value);

    // בניית נתוני עמודות עובדים — join עם רשימת reporters לשמות
    const reporterMap = new Map(reporters.map(r => [String(r.id), r.name]));
    const employeeBarData = Object.values(employeeGroups)
        .map(eg => ({
            name: reporterMap.get(eg.reporterId) || `עובד ${eg.reporterId}`,
            ...(enableDistinction
                ? { internalProject: round2(eg.internalProject), externalProject: round2(eg.externalProject), routine: round2(eg.routine) }
                : { billable: round2(eg.billable), nonBillable: round2(eg.nonBillable) }
            ),
            total: round2(eg.total)
        }))
        .sort((a, b) => b.total - a.total);

    return {
        stats: {
            totalHours: round2(totalHours),
            billableHours: round2(billableHours),
            nonBillableHours: round2(nonBillableHours),
            billablePercent,
            internalHours: round2(internalHours),
            externalHours: round2(externalHours),
            routineHours: round2(routineHours),
            internalColor: internalColor || '#0073ea',
            externalColor: externalColor || '#00ca72',
            routineColor: routineColor || '#fdab3d'
        },
        barData: Object.values(granularityGroups)
            .sort((a, b) => a.key.localeCompare(b.key))
            .map(g => ({ ...g, hours: round2(g.hours) })),
        billablePieData: sortedPie(billablePieGroups),
        nonBillablePieData: sortedPie(nonBillablePieGroups),
        internalPieData: sortedPie(internalPieGroups),
        externalPieData: sortedPie(externalPieGroups),
        routinePieData: sortedPie(routinePieGroups),
        employeeBarData
    };
};

/**
 * איחוד עמודות כשיש יותר מדי — ממוצע לכל קבוצה
 * @param {Array} barData - נתוני עמודות עם startDate/endDate
 * @param {number} maxBars - מספר עמודות מקסימלי (ברירת מחדל: 16)
 * @returns {Array}
 */
export const consolidateBarData = (barData, maxBars = 25, dateFnsLocale = he) => {
    if (!barData || barData.length <= maxBars) return barData;

    const groupSize = Math.ceil(barData.length / maxBars);
    const result = [];

    for (let i = 0; i < barData.length; i += groupSize) {
        const chunk = barData.slice(i, i + groupSize);
        const avgHours = Math.round((chunk.reduce((sum, b) => sum + b.hours, 0) / chunk.length) * 100) / 100;
        const firstBar = chunk[0];
        const lastBar = chunk[chunk.length - 1];

        result.push({
            key: firstBar.key,
            label: formatRangeLabel(firstBar.startDate, lastBar.endDate, dateFnsLocale),
            hours: avgHours,
            startDate: firstBar.startDate,
            endDate: lastBar.endDate
        });
    }

    return result;
};
