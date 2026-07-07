import React, { useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import { Dropdown } from '@vibe/core';
import SegmentedToggle from './SegmentedToggle';
import DatePickerInput from '../DatePickerInput';
import StopwatchLoader from '../StopwatchLoader/StopwatchLoader';
import { formatPeriodLabel } from '../../utils/dateFilterUtils';
import styles from './Dashboard.module.css';

/**
 * פאנל פילטרים של הדשבורד — שורה אחת RTL
 */
const DashboardFilterPanel = ({
    // Customers multi-select (cascading → Projects)
    filterCustomers = [],
    loadingFilterCustomers = false,
    hasCustomerColumn = false,
    selectedCustomerIds = [],
    onCustomerChange,
    // Projects multi-select
    filterProjects,
    loadingFilterProjects,
    selectedProjectIds,
    onProjectChange,
    // Reporters multi-select
    reporters,
    loadingReporters,
    selectedReporterIds,
    onReporterChange,
    // Billable toggle
    billFilter,
    onBillFilterChange,
    // Date range
    dateFrom,
    dateTo,
    onDateFromChange,
    onDateToChange,
    // Date condition
    dateCondition,
    onDateConditionChange,
    periodAnchor,
    onPeriodPrev,
    onPeriodNext,
    projectFilterActive,
    enableDistinction,
    isLoading
}) => {
    const t = useStableT();
    const { isRtl, dateFnsLocale } = useLocale();

    const BILL_OPTIONS = useMemo(() => [
        { value: 'all', label: t('dashboard.billFilter.all') },
        { value: 'billable', label: t('dashboard.billFilter.billable') },
        { value: 'nonBillable', label: t('dashboard.billFilter.nonBillable') }
    ], [t]);

    const DISTINCTION_BILL_OPTIONS = useMemo(() => [
        { value: 'all', label: t('dashboard.billFilter.all') },
        { value: 'internalProject', label: t('dashboard.billFilter.internalProject') },
        { value: 'externalProject', label: t('dashboard.billFilter.externalProject') },
        { value: 'routine', label: t('dashboard.billFilter.routine') }
    ], [t]);

    const DATE_CONDITION_OPTIONS = useMemo(() => [
        { value: 'day',     label: t('dashboard.granularity.day') },
        { value: 'week',    label: t('dashboard.granularity.week') },
        { value: 'month',   label: t('dashboard.granularity.month') },
        { value: 'year',    label: t('dashboard.granularity.year') },
        { value: 'between', label: t('dashboard.granularity.between') },
    ], [t]);

    // המרה מ-{ id, name } לפורמט Vibe { value, label }
    const customerOptions = useMemo(() =>
        (filterCustomers || []).map(c => ({ value: String(c.id), label: c.name })),
        [filterCustomers]
    );
    const projectOptions = useMemo(() =>
        (filterProjects || []).map(p => ({ value: String(p.id), label: p.name })),
        [filterProjects]
    );
    const reporterOptions = useMemo(() =>
        (reporters || []).map(r => ({ value: String(r.id), label: r.name })),
        [reporters]
    );

    const selectedCustomerValues = useMemo(() =>
        customerOptions.filter(o => selectedCustomerIds.map(String).includes(o.value)),
        [customerOptions, selectedCustomerIds]
    );
    const selectedProjectValues = useMemo(() =>
        projectOptions.filter(o => selectedProjectIds.map(String).includes(o.value)),
        [projectOptions, selectedProjectIds]
    );
    const selectedReporterValues = useMemo(() =>
        reporterOptions.filter(o => selectedReporterIds.map(String).includes(o.value)),
        [reporterOptions, selectedReporterIds]
    );

    const handleCustomerChange = useCallback((selected) => {
        onCustomerChange(selected ? selected.map(o => o.value) : []);
    }, [onCustomerChange]);

    const handleProjectChange = useCallback((selected) => {
        onProjectChange(selected ? selected.map(o => o.value) : []);
    }, [onProjectChange]);

    const handleReporterChange = useCallback((selected) => {
        onReporterChange(selected ? selected.map(o => o.value) : []);
    }, [onReporterChange]);

    const isPeriodCondition = dateCondition !== 'between';

    const renderDateArea = () => {
        if (isPeriodCondition) {
            // ניווט תקופתי: prev/next arrows. ב-RTL: ▸ ימינה = קודם, ◂ שמאלה = הבא.
            // ב-LTR: ◂ שמאלה = קודם, ▸ ימינה = הבא (סדר טבעי לעין מערבית).
            const prevArrow = isRtl ? '▸' : '◂';
            const nextArrow = isRtl ? '◂' : '▸';
            return (
                <div className={styles.periodNav}>
                    <button
                        className={styles.periodArrow}
                        onClick={onPeriodPrev}
                        aria-label={t("dashboard.filters.previousPeriod")}
                    >
                        {prevArrow}
                    </button>
                    <span className={styles.periodLabel}>
                        {formatPeriodLabel(dateCondition, periodAnchor, dateFnsLocale)}
                    </span>
                    <button
                        className={styles.periodArrow}
                        onClick={onPeriodNext}
                        aria-label={t("dashboard.filters.nextPeriod")}
                    >
                        {nextArrow}
                    </button>
                </div>
            );
        }

        // ברירת מחדל: שני פיקרים (between)
        return (
            <>
                <DatePickerInput
                    label={t("dashboard.filters.fromDate")}
                    date={dateFrom ? new Date(dateFrom + 'T00:00:00') : undefined}
                    onDateChange={(d) => onDateFromChange(d ? format(d, 'yyyy-MM-dd') : dateFrom)}
                />
                <DatePickerInput
                    label={t("dashboard.filters.toDate")}
                    date={dateTo ? new Date(dateTo + 'T00:00:00') : undefined}
                    onDateChange={(d) => onDateToChange(d ? format(d, 'yyyy-MM-dd') : dateTo)}
                />
            </>
        );
    };

    return (
        <div className={styles.filterPanel}>
            {/* שורה עליונה: פילטרים + סוג דיווח */}
            <div className={styles.filterRowTop}>
                <div className={styles.filterRowTopRight}>
                    {hasCustomerColumn && (customerOptions.length > 0 || loadingFilterCustomers) && (
                        <Dropdown
                            placeholder={t("dashboard.filters.allCustomers")}
                            options={customerOptions}
                            value={selectedCustomerValues}
                            onChange={handleCustomerChange}
                            onClear={() => onCustomerChange([])}
                            multi
                            searchable
                            clearable
                            rtl={isRtl}
                            size="small"
                            isLoading={loadingFilterCustomers}
                            noOptionsMessage={() => t('dashboard.filters.allCustomers')}
                            className={styles.vibeDropdown}
                        />
                    )}
                    <Dropdown
                        placeholder={t("dashboard.filters.allProjects")}
                        options={projectOptions}
                        value={selectedProjectValues}
                        onChange={handleProjectChange}
                        onClear={() => onProjectChange([])}
                        multi
                        searchable
                        clearable
                        rtl={isRtl}
                        size="small"
                        isLoading={loadingFilterProjects}
                        noOptionsMessage={() => t('dashboard.filters.allProjects')}
                        className={styles.vibeDropdownWide}
                    />
                    <Dropdown
                        placeholder={t("dashboard.filters.allEmployees")}
                        options={reporterOptions}
                        value={selectedReporterValues}
                        onChange={handleReporterChange}
                        onClear={() => onReporterChange([])}
                        multi
                        searchable
                        clearable
                        rtl={isRtl}
                        size="small"
                        isLoading={loadingReporters}
                        noOptionsMessage={() => t('dashboard.filters.allEmployees')}
                        className={styles.vibeDropdown}
                    />
                </div>
                {!projectFilterActive && (
                    <div className={styles.filterRowTopLeft}>
                        <SegmentedToggle
                            options={enableDistinction ? DISTINCTION_BILL_OPTIONS : BILL_OPTIONS}
                            selected={billFilter}
                            onChange={onBillFilterChange}
                            ariaLabel={t("dashboard.billFilter.all")}
                        />
                    </div>
                )}
            </div>

            {/* קו מפריד */}
            <div className={styles.filterDivider} />

            {/* שורה תחתונה: תאריכים */}
            <div className={styles.filterRowBottom}>
                {renderDateArea()}
                <SegmentedToggle
                    options={DATE_CONDITION_OPTIONS}
                    selected={dateCondition}
                    onChange={onDateConditionChange}
                    ariaLabel={t("dashboard.granularity.day")}
                />
                {isLoading && <StopwatchLoader size={26} />}
            </div>
        </div>
    );
};

export default DashboardFilterPanel;
