import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useStableT } from '../../i18n/useStableT';
import { useSettings } from '../../contexts/SettingsContext';
import { useMondayContext } from '../../contexts/MondayContext';
import { getEffectiveBoardId } from '../../utils/boardIdResolver';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useFilterOptions } from '../../hooks/useFilterOptions';
import { format } from 'date-fns';
import { useLocale } from '../../hooks/useLocale';
import { aggregateAll, consolidateBarData } from '../../utils/dashboardAggregation';
import { exportDashboardToExcel } from '../../utils/excelExporter';
import { buildDateFilterRule, getEffectiveDateRange, shiftPeriod } from '../../utils/dateFilterUtils';
import DashboardToolbar from './DashboardToolbar';
import DashboardFilterPanel from './DashboardFilterPanel';
import DashboardStats from './DashboardStats';
import DashboardBarChart from './DashboardBarChart';
import DashboardEmployeeChart from './DashboardEmployeeChart';
import DashboardPieCharts from './DashboardPieCharts';
import StopwatchLoader from '../StopwatchLoader/StopwatchLoader';
import loaderStyles from '../StopwatchLoader/StopwatchLoader.module.css';
import styles from './Dashboard.module.css';
import logger from '../../utils/logger';

/**
 * ברירת מחדל: תחילת וסוף החודש הנוכחי בפורמט YYYY-MM-DD
 */
const getDefaultDateRange = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
        from: `${year}-${month}-01`,
        to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`
    };
};

/**
 * דשבורד ראשי - תצוגת ניתוח שעות
 */
const Dashboard = ({ monday, onSwitchToCalendar, onOpenSettings, isOwner, hasIncompleteSettings = false }) => {
    const t = useStableT();
    const { dateFnsLocale } = useLocale();
    const { customSettings } = useSettings();
    const { context } = useMondayContext();

    const effectiveBoardId = useMemo(() =>
        getEffectiveBoardId(customSettings, context),
        [customSettings, context]
    );

    // State - פילטרים
    const [selectedReporterIds, setSelectedReporterIds] = useState([]);
    const [selectedProjectIds, setSelectedProjectIds] = useState([]);
    const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
    const enableDistinction = !!customSettings?.enableProjectTypeDistinction;
    const [billFilter, setBillFilter] = useState('all');
    const [granularity, setGranularity] = useState('day');
    const defaultRange = useMemo(() => getDefaultDateRange(), []);
    const [dateFrom, setDateFrom] = useState(defaultRange.from);
    const [dateTo, setDateTo] = useState(defaultRange.to);
    const [dateCondition, setDateCondition] = useState('week');
    const [periodAnchor, setPeriodAnchor] = useState(() => new Date());

    // איפוס פילטר סוג חיוב כשמשנים מצב הבחנה
    useEffect(() => { setBillFilter('all'); }, [enableDistinction]);

    // גזירת גרנולריות אוטומטית מתנאי התאריך
    useEffect(() => {
        setGranularity(dateCondition === 'year' ? 'month' : 'day');
    }, [dateCondition]);

    // Ref לניקוי cascading filter ללא תלות מעגלית
    const selectedProjectIdsRef = useRef(selectedProjectIds);
    selectedProjectIdsRef.current = selectedProjectIds;

    // Hooks
    const { events, loading, error, fetchEvents, customers: filterCustomers, projects: filterProjects } = useDashboardData(monday, context);
    const { reporters, loadingReporters } = useFilterOptions(monday, effectiveBoardId, customSettings);
    const loadingFilterProjects = loading;

    // סינון פרויקטים לפי לקוחות נבחרים (cascading filter)
    const visibleFilterProjects = useMemo(() => {
        if (selectedCustomerIds.length === 0) return filterProjects;
        const customerSet = new Set(selectedCustomerIds.map(String));
        return filterProjects.filter(p => p.customerId && customerSet.has(String(p.customerId)));
    }, [filterProjects, selectedCustomerIds]);

    // ניקוי פרויקטים שלא שייכים ללקוחות הנבחרים
    useEffect(() => {
        if (selectedCustomerIds.length === 0 || selectedProjectIdsRef.current.length === 0) return;
        const visibleIds = new Set(visibleFilterProjects.map(p => String(p.id)));
        const current = selectedProjectIdsRef.current;
        const cleaned = current.filter(id => visibleIds.has(String(id)));
        if (cleaned.length !== current.length) {
            setSelectedProjectIds(cleaned);
        }
    }, [selectedCustomerIds, visibleFilterProjects]);

    // חישוב טווח תאריכים אפקטיבי לפי תנאי
    const isPeriodCondition = dateCondition === 'day' || dateCondition === 'month' || dateCondition === 'week' || dateCondition === 'year';
    const effectiveDateFrom = isPeriodCondition
        ? format(periodAnchor, 'yyyy-MM-dd')
        : dateFrom;
    const effectiveDateTo = isPeriodCondition
        ? format(periodAnchor, 'yyyy-MM-dd')
        : dateTo;
    const effectiveRange = useMemo(
        () => getEffectiveDateRange(dateCondition, effectiveDateFrom, effectiveDateTo),
        [dateCondition, effectiveDateFrom, effectiveDateTo]
    );

    // בניית חוקי פילטר צד-שרת (GraphQL rules)
    const serverFilterRules = useMemo(() => {
        const rules = [];

        // חוק תאריכים
        if (customSettings?.dateColumnId) {
            rules.push(buildDateFilterRule(
                dateCondition,
                customSettings.dateColumnId,
                effectiveRange.from,
                effectiveRange.to
            ));
        }

        // סינון מדווח ברמת ה-API — פורמט People: "person-{id}"
        if (selectedReporterIds.length > 0 && customSettings?.reporterColumnId) {
            rules.push({
                column_id: customSettings.reporterColumnId,
                compare_value: selectedReporterIds.map(id => `person-${id}`),
                operator: "any_of"
            });
        }

        // סינון פרויקט ברמת ה-API — board_relation + any_of עם מזהים מספריים
        if (selectedProjectIds.length > 0 && customSettings?.projectColumnId) {
            rules.push({
                column_id: customSettings.projectColumnId,
                compare_value: selectedProjectIds.map(id => parseInt(id)),
                operator: "any_of"
            });
        }

        // סינון לקוח ברמת ה-API
        if (selectedCustomerIds.length > 0 && customSettings?.customerReportColumnId) {
            rules.push({
                column_id: customSettings.customerReportColumnId,
                compare_value: selectedCustomerIds.map(id => parseInt(id, 10)),
                operator: "any_of"
            });
        }

        return rules;
    }, [dateCondition, effectiveRange, selectedReporterIds, selectedProjectIds, selectedCustomerIds, customSettings?.dateColumnId, customSettings?.reporterColumnId, customSettings?.projectColumnId, customSettings?.customerReportColumnId]);

    // טעינת נתונים כשמשתנה הטווח או הפילטרים — עם debounce של 300ms
    useEffect(() => {
        if (!monday || !effectiveBoardId) return;

        const timer = setTimeout(() => {
            const from = new Date(effectiveRange.from + 'T00:00:00');
            const to = new Date(effectiveRange.to + 'T23:59:59');

            if (isNaN(from.getTime()) || isNaN(to.getTime())) return;

            fetchEvents(from, to, serverFilterRules);
        }, 300);

        return () => clearTimeout(timer);
    }, [effectiveRange, monday, effectiveBoardId, fetchEvents, serverFilterRules]);

    // סינון צד-לקוח
    const specificProjects = selectedProjectIds.length > 0;
    const filteredEvents = useMemo(() => {
        let filtered = events;

        // סינון מדווחים - השוואה כ-string כי Monday API מחזיר ID כ-string וFilterBar מחזיר numbers
        if (selectedReporterIds.length > 0) {
            const reporterStrs = selectedReporterIds.map(id => String(id));
            filtered = filtered.filter(e => e.reporterId && reporterStrs.includes(String(e.reporterId)));
        }

        if (specificProjects) {
            // כשמסננים לפי פרויקט — לא לחיוב לא רלוונטי (אין להם פרויקט)
            const projectStrs = selectedProjectIds.map(id => String(id));
            filtered = filtered.filter(e => e.isBillable && e.projectId && projectStrs.includes(String(e.projectId)));
        } else if (enableDistinction) {
            // מצב הבחנה — סינון לפי קטגוריה
            if (billFilter === 'internalProject') filtered = filtered.filter(e => e.category === 'internalProject');
            else if (billFilter === 'externalProject') filtered = filtered.filter(e => e.category === 'externalProject');
            else if (billFilter === 'routine') filtered = filtered.filter(e => e.category === 'routine');
        } else {
            // סינון סוג חיוב — רק כשלא מסננים לפי פרויקט
            if (billFilter === 'billable') {
                filtered = filtered.filter(e => e.isBillable);
            } else if (billFilter === 'nonBillable') {
                filtered = filtered.filter(e => !e.isBillable);
            }
        }

        return filtered;
    }, [events, selectedReporterIds, selectedProjectIds, specificProjects, billFilter, enableDistinction]);

    // אגרגציה משולבת — מעבר יחיד על המערך במקום 4 מעברים נפרדים
    const weekStartsOn = customSettings?.weekStartDay ?? 0;
    const { stats, barData: rawBarData, billablePieData, nonBillablePieData, internalPieData, externalPieData, routinePieData, employeeBarData } = useMemo(
        () => aggregateAll(filteredEvents, granularity, enableDistinction, reporters, weekStartsOn, dateFnsLocale),
        [filteredEvents, granularity, enableDistinction, reporters, weekStartsOn, dateFnsLocale]
    );

    // איחוד עמודות כשיש יותר מדי
    const barData = useMemo(
        () => consolidateBarData(rawBarData, undefined, dateFnsLocale),
        [rawBarData, dateFnsLocale]
    );

    const projectFilterActive = specificProjects;
    const compactMode = projectFilterActive || billFilter !== 'all';

    // שינוי תאריכים עם וולידציה
    const handleDateFromChange = useCallback((value) => {
        if (value <= dateTo) {
            setDateFrom(value);
        } else {
            setDateFrom(value);
            setDateTo(value);
        }
    }, [dateTo]);

    const handleDateToChange = useCallback((value) => {
        if (value >= dateFrom) {
            setDateTo(value);
        } else {
            setDateTo(value);
            setDateFrom(value);
        }
    }, [dateFrom]);

    const handleDateConditionChange = useCallback((newCondition) => {
        setDateCondition(newCondition);
        if (newCondition === 'day' || newCondition === 'month' || newCondition === 'week' || newCondition === 'year') {
            setPeriodAnchor(new Date());
        }
    }, []);

    const handlePeriodPrev = useCallback(() => {
        setPeriodAnchor(prev => shiftPeriod(dateCondition, prev, -1));
    }, [dateCondition]);

    const handlePeriodNext = useCallback(() => {
        setPeriodAnchor(prev => shiftPeriod(dateCondition, prev, 1));
    }, [dateCondition]);

    // ייצוא Excel
    const handleExport = useCallback(async () => {
        try {
            const filename = `${t('dashboard.exportFilename')}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
            await exportDashboardToExcel(filteredEvents, reporters, filename, enableDistinction);
        } catch (err) {
            logger.error('Dashboard', t('dashboard.exportError'), err);
        }
    }, [filteredEvents, reporters, enableDistinction, t]);

    // האם במצב טעינה ראשונית (אין נתונים כלל)
    const isInitialLoading = loading && events.length === 0;

    // אוברליי טעינה — טעינה ראשונית + מעברי תקופה
    const [showOverlay, setShowOverlay] = useState(true);
    const [overlayFading, setOverlayFading] = useState(false);
    const prevLoadingRef = useRef(loading);
    const overlayTimerRef = useRef(null);

    useEffect(() => {
        const wasLoading = prevLoadingRef.current;
        prevLoadingRef.current = loading;

        // התחלת טעינה — הצג אוברליי
        if (loading && !wasLoading) {
            clearTimeout(overlayTimerRef.current);
            setShowOverlay(true);
            setOverlayFading(false);
        } else if (!loading && wasLoading) {
            // סיום טעינה — fadeout
            setOverlayFading(true);
            overlayTimerRef.current = setTimeout(() => {
                setShowOverlay(false);
                setOverlayFading(false);
            }, 300);
        }

        return () => clearTimeout(overlayTimerRef.current);
    }, [loading]);

    return (
        <div className={styles.dashboard}>
            <DashboardToolbar
                onSwitchToCalendar={onSwitchToCalendar}
                isOwner={isOwner}
                onOpenSettings={onOpenSettings}
                onExport={handleExport}
                exportDisabled={isInitialLoading}
                hasIncompleteSettings={hasIncompleteSettings}
            />

            <div className={styles.content} style={{ position: 'relative' }}>
                {/* אוברליי טעינה ראשונית — שקוף חלקית, רואים דשבורד ברקע */}
                {showOverlay && (
                    <div className={overlayFading ? loaderStyles.viewChangeOverlayFadeOut : loaderStyles.viewChangeOverlay}>
                        <StopwatchLoader size={80} />
                    </div>
                )}

                <DashboardFilterPanel
                    filterCustomers={filterCustomers}
                    loadingFilterCustomers={loading}
                    hasCustomerColumn={!!customSettings?.customerReportColumnId}
                    selectedCustomerIds={selectedCustomerIds}
                    onCustomerChange={setSelectedCustomerIds}
                    filterProjects={visibleFilterProjects}
                    loadingFilterProjects={loadingFilterProjects}
                    selectedProjectIds={selectedProjectIds}
                    onProjectChange={setSelectedProjectIds}
                    reporters={reporters}
                    loadingReporters={loadingReporters}
                    selectedReporterIds={selectedReporterIds}
                    onReporterChange={setSelectedReporterIds}
                    billFilter={billFilter}
                    onBillFilterChange={setBillFilter}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={handleDateFromChange}
                    onDateToChange={handleDateToChange}
                    dateCondition={dateCondition}
                    onDateConditionChange={handleDateConditionChange}
                    periodAnchor={periodAnchor}
                    onPeriodPrev={handlePeriodPrev}
                    onPeriodNext={handlePeriodNext}
                    projectFilterActive={projectFilterActive}
                    enableDistinction={enableDistinction}
                />

                {error ? (
                    <div className={styles.errorState}>{error}</div>
                ) : (
                    <>
                        <div className={`${styles.topRow} ${compactMode ? styles.topRowProjectMode : ''}`}>
                            <DashboardStats stats={stats} billFilter={billFilter} projectFilterActive={projectFilterActive} compactMode={compactMode} enableDistinction={enableDistinction} />
                            <DashboardPieCharts
                                billablePieData={billablePieData}
                                nonBillablePieData={nonBillablePieData}
                                billFilter={billFilter}
                                projectFilterActive={projectFilterActive}
                                compactMode={compactMode}
                                enableDistinction={enableDistinction}
                                internalPieData={internalPieData}
                                externalPieData={externalPieData}
                                routinePieData={routinePieData}
                                stats={stats}
                            />
                        </div>
                        <DashboardBarChart data={barData} granularity={granularity} isConsolidated={rawBarData.length > barData.length} />
                        <DashboardEmployeeChart data={employeeBarData} enableDistinction={enableDistinction} stats={stats} />
                        <div className={styles.footer}>
                            {t('dashboard.recordsCount', { count: filteredEvents.length })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
