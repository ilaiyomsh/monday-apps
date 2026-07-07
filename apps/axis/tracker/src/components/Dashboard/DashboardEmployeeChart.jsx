import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from 'recharts';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import useTokens from '../../hooks/useTokens';
import styles from './Dashboard.module.css';

/**
 * תרשים עמודות stacked — שעות לפי עובד
 */
const DashboardEmployeeChart = ({ data, enableDistinction, stats }) => {
    const t = useStableT();
    const { dir: tooltipDir } = useLocale();
    const tk = useTokens();

    if (!data || data.length === 0) {
        return (
            <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>{t('dashboard.charts.byEmployee')}</h3>
                <div className={styles.emptyState}>{t('dashboard.charts.noData')}</div>
            </div>
        );
    }

    const barSize = 22;
    const barGap = 18;
    const chartHeight = Math.max(200, data.length * (barSize + barGap) + 60);
    const animate = data.length <= 20;

    // רנדור לייבל סה"כ בקצה העמודה
    const renderTotalLabel = (props) => {
        const { x, y, width, height, value } = props;
        if (!value) return null;
        return (
            <text x={x + width + 6} y={y + height / 2} fill={tk.textSecondary} fontSize={12} dominantBaseline="central">
                {value}
            </text>
        );
    };

    const maxNameLength = Math.max(...data.map(d => d.name.length));
    const yAxisWidth = Math.max(110, Math.min(maxNameLength * 7.5, 180));

    const labels = {
        external: t('dashboard.charts.legend.external'),
        internal: t('dashboard.charts.legend.internal'),
        routine: t('dashboard.charts.legend.routine'),
        billable: t('dashboard.charts.legend.billable'),
        nonBillable: t('dashboard.charts.legend.nonBillable'),
    };

    return (
        <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>{t('dashboard.charts.byEmployee')}</h3>
            {/* direction:'ltr' — Recharts workaround: ראה DashboardBarChart. */}
            <div className={styles.chartContainer} style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart data={data} layout="vertical" margin={{ top: 5, right: 40, left: 10, bottom: 5 }} barSize={barSize} barGap={barGap}>
                        <CartesianGrid strokeDasharray="3 3" stroke={tk.border} />
                        <XAxis
                            type="number"
                            tick={{ fontSize: 12, fill: tk.textSecondary }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            dataKey="name"
                            type="category"
                            width={yAxisWidth}
                            tick={{ fontSize: 12, fill: tk.textSecondary }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip
                            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                            formatter={(value, name) => [t('dashboard.charts.hoursLabel', { value }), name]}
                            contentStyle={{ direction: tooltipDir, borderRadius: 8, border: `1px solid ${tk.borderMedium}` }}
                        />
                        <Legend
                            wrapperStyle={{ direction: tooltipDir }}
                            payload={enableDistinction
                                ? [
                                    { value: labels.external, type: 'square', color: stats.externalColor },
                                    { value: labels.internal, type: 'square', color: stats.internalColor },
                                    { value: labels.routine, type: 'square', color: stats.routineColor },
                                ]
                                : [
                                    { value: labels.billable, type: 'square', color: tk.approvalGreen },
                                    { value: labels.nonBillable, type: 'square', color: tk.primary },
                                ]
                            }
                        />
                        {enableDistinction ? (
                            <>
                                <Bar dataKey="routine" name={labels.routine} stackId="stack" fill={stats.routineColor} radius={[0, 0, 0, 0]} isAnimationActive={animate} />
                                <Bar dataKey="internalProject" name={labels.internal} stackId="stack" fill={stats.internalColor} radius={[0, 0, 0, 0]} isAnimationActive={animate} />
                                <Bar dataKey="externalProject" name={labels.external} stackId="stack" fill={stats.externalColor} radius={[0, 4, 4, 0]} isAnimationActive={animate}>
                                    <LabelList dataKey="total" content={renderTotalLabel} />
                                </Bar>
                            </>
                        ) : (
                            <>
                                <Bar dataKey="billable" name={labels.billable} stackId="stack" fill={tk.approvalGreen} radius={[0, 0, 0, 0]} isAnimationActive={animate} />
                                <Bar dataKey="nonBillable" name={labels.nonBillable} stackId="stack" fill={tk.primary} radius={[0, 4, 4, 0]} isAnimationActive={animate}>
                                    <LabelList dataKey="total" content={renderTotalLabel} />
                                </Bar>
                            </>
                        )}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default React.memo(DashboardEmployeeChart);
