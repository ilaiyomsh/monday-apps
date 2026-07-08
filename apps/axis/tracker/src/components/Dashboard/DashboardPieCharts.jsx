import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from 'recharts';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import useTokens, { useChartPalette } from '../../hooks/useTokens';
import styles from './Dashboard.module.css';

/**
 * תרשימי עוגה (דונאט) - התפלגות שעות
 */
const DashboardPieCharts = ({
    billablePieData, nonBillablePieData, billFilter, projectFilterActive, compactMode,
    enableDistinction, internalPieData, externalPieData, routinePieData, stats
}) => {
    const t = useStableT();
    const { dir: tooltipDir } = useLocale();
    const [selectedCategory, setSelectedCategory] = useState('externalProject');

    const DRILLDOWN_TITLES = useMemo(() => ({
        internalProject: t('dashboard.charts.categoryNames.internalProject'),
        externalProject: t('dashboard.charts.categoryNames.externalProject'),
        routine: t('dashboard.charts.categoryNames.routine'),
    }), [t]);

    // סנכרון: כשלוחצים על כפתור פילטר — הפאי עוקב
    useEffect(() => {
        if (!enableDistinction) return;
        if (billFilter === 'internalProject' || billFilter === 'externalProject' || billFilter === 'routine') {
            setSelectedCategory(billFilter);
        }
    }, [billFilter, enableDistinction]);

    // בניית נתוני פאי ראשי — 3 פרוסות
    const mainPieData = useMemo(() => {
        if (!enableDistinction || !stats) return [];
        const slices = [];
        if (stats.internalHours > 0) {
            slices.push({ name: t('dashboard.charts.legend.internal'), value: stats.internalHours, color: stats.internalColor, category: 'internalProject' });
        }
        if (stats.externalHours > 0) {
            slices.push({ name: t('dashboard.charts.legend.external'), value: stats.externalHours, color: stats.externalColor, category: 'externalProject' });
        }
        if (stats.routineHours > 0) {
            slices.push({ name: t('dashboard.charts.legend.routine'), value: stats.routineHours, color: stats.routineColor, category: 'routine' });
        }
        return slices;
    }, [enableDistinction, stats, t]);

    const drilldownData = useMemo(() => {
        if (!selectedCategory) return [];
        if (selectedCategory === 'internalProject') return internalPieData || [];
        if (selectedCategory === 'externalProject') return externalPieData || [];
        if (selectedCategory === 'routine') return routinePieData || [];
        return [];
    }, [selectedCategory, internalPieData, externalPieData, routinePieData]);

    const handleSliceClick = useCallback((data) => {
        const cat = data?.category;
        if (!cat) return;
        setSelectedCategory(prev => prev === cat ? null : cat);
    }, []);

    if (enableDistinction && !projectFilterActive) {
        return (
            <div className={styles.sectionCard}>
                <div className={styles.pieChartsRow}>
                    <div className={styles.pieSection}>
                        <h3 className={styles.chartTitle}>{t('dashboard.charts.distribution')}</h3>
                        {mainPieData.length > 0 ? (
                            <MemoizedInteractivePie
                                data={mainPieData}
                                selectedCategory={selectedCategory}
                                onSliceClick={handleSliceClick}
                                tooltipDir={tooltipDir}
                                t={t}
                            />
                        ) : (
                            <div className={styles.emptyState}>{t('dashboard.charts.noDataShort')}</div>
                        )}
                    </div>

                    <div className={styles.pieSection}>
                        <h3 className={styles.chartTitle}>
                            {selectedCategory ? DRILLDOWN_TITLES[selectedCategory] : t('dashboard.charts.categoryDrillTitle')}
                        </h3>
                        {selectedCategory && drilldownData.length > 0 ? (
                            <MemoizedPieChartDonut data={drilldownData} tooltipDir={tooltipDir} t={t} />
                        ) : (
                            <div className={styles.emptyState}>
                                {selectedCategory ? t('dashboard.charts.noCategoryData') : t('dashboard.charts.clickPie')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const showBillable = billFilter !== 'nonBillable';
    const showNonBillable = !projectFilterActive && billFilter !== 'billable';
    const singlePie = compactMode || (showBillable !== showNonBillable);

    return (
        <div className={styles.sectionCard}>
            <div className={singlePie ? styles.pieChartsRowSingle : styles.pieChartsRow}>
                {showBillable ? (
                    <div className={styles.pieSection}>
                        <h3 className={styles.chartTitle}>{t('dashboard.charts.projectsDistribution')}</h3>
                        {billablePieData && billablePieData.length > 0 ? (
                            <MemoizedPieChartDonut data={billablePieData} tooltipDir={tooltipDir} t={t} />
                        ) : (
                            <div className={styles.emptyState}>{t('dashboard.charts.noProjectsData')}</div>
                        )}
                    </div>
                ) : null}

                {showNonBillable ? (
                    <div className={styles.pieSection}>
                        <h3 className={styles.chartTitle}>{t('dashboard.charts.routineDistribution')}</h3>
                        {nonBillablePieData && nonBillablePieData.length > 0 ? (
                            <MemoizedPieChartDonut data={nonBillablePieData} tooltipDir={tooltipDir} t={t} />
                        ) : (
                            <div className={styles.emptyState}>{t('dashboard.charts.noRoutineData')}</div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

const ActiveSector = (props) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, strokeColor } = props;
    return (
        <Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={outerRadius + 6}
            startAngle={startAngle} endAngle={endAngle} fill={fill} stroke={strokeColor} strokeWidth={2} />
    );
};

const InteractivePie = ({ data, selectedCategory, onSliceClick, tooltipDir, t }) => {
    const tk = useTokens();
    const palette = useChartPalette();
    const activeIndex = selectedCategory
        ? data.findIndex(d => d.category === selectedCategory)
        : -1;

    const renderActiveShape = useCallback((p) => <ActiveSector {...p} strokeColor={tk.bgPrimary} />, [tk.bgPrimary]);

    // direction:'ltr' — Recharts workaround: ראה DashboardBarChart.
    return (
        <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                    <Pie
                        data={data} cx="50%" cy="50%" innerRadius="50%" outerRadius="78%"
                        dataKey="value" nameKey="name" paddingAngle={2}
                        isAnimationActive={false}
                        onClick={(_, index) => onSliceClick(data[index])}
                        activeIndex={activeIndex >= 0 ? activeIndex : undefined}
                        activeShape={activeIndex >= 0 ? renderActiveShape : undefined}
                        cursor="pointer"
                    >
                        {data.map((entry, index) => (
                            <Cell
                                key={entry.name}
                                fill={entry.color || palette[index % palette.length]}
                                opacity={selectedCategory && entry.category !== selectedCategory ? 0.4 : 1}
                            />
                        ))}
                    </Pie>
                    <Tooltip
                        formatter={(value, name) => [t('dashboard.charts.hoursLabel', { value }), name]}
                        contentStyle={{ direction: tooltipDir, borderRadius: 8, border: `1px solid ${tk.borderMedium}` }}
                    />
                    <Legend
                        formatter={(value) => <span style={{ direction: tooltipDir, fontSize: 12, color: tk.textSecondary }}>{value}</span>}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

const PieChartDonut = ({ data, tooltipDir, t }) => {
    const tk = useTokens();
    const palette = useChartPalette();
    return (
        <div style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                    <Pie data={data} cx="50%" cy="50%" innerRadius="50%" outerRadius="78%"
                        dataKey="value" nameKey="name" paddingAngle={2}
                        isAnimationActive={data.length <= 10}>
                        {data.map((entry, index) => (
                            <Cell key={entry.name} fill={entry.color || palette[index % palette.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                        formatter={(value, name) => [t('dashboard.charts.hoursLabel', { value }), name]}
                        contentStyle={{ direction: tooltipDir, borderRadius: 8, border: `1px solid ${tk.borderMedium}` }}
                    />
                    <Legend
                        formatter={(value) => <span style={{ direction: tooltipDir, fontSize: 12, color: tk.textSecondary }}>{value}</span>}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

const MemoizedInteractivePie = React.memo(InteractivePie);
const MemoizedPieChartDonut = React.memo(PieChartDonut);
export default React.memo(DashboardPieCharts);
