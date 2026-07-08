import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import useTokens from '../../hooks/useTokens';
import styles from './Dashboard.module.css';

/**
 * תרשים עמודות - שעות לפי גרנולריות
 * @param {{ data: Array, granularity: string }} props
 */
const DashboardBarChart = ({ data, granularity, isConsolidated }) => {
    const t = useStableT();
    const { isRtl } = useLocale();
    const tk = useTokens();
    const granLabel = t(`dashboard.granularity.${granularity}`, { defaultValue: granularity });
    const title = isConsolidated
        ? t('dashboard.charts.byPeriodAvg', { granularity: granLabel })
        : t('dashboard.charts.byPeriod', { granularity: granLabel });

    if (!data || data.length === 0) {
        return (
            <div className={styles.chartCard}>
                <h3 className={styles.chartTitle}>{title}</h3>
                <div className={styles.emptyState}>{t('dashboard.charts.noData')}</div>
            </div>
        );
    }

    return (
        <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>{title}</h3>
            {/* direction:'ltr' — Recharts מצייר ציר X משמאל-לימין; ב-RTL ה-tooltip
                והלייאאוט הפנימי של ResponsiveContainer מתבלבלים בלי forcing LTR
                כאן. ה-RTL מטופל ידנית ב-Tooltip contentStyle. */}
            <div className={styles.chartContainer} style={{ direction: 'ltr' }}>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={tk.border} />
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 12, fill: tk.textSecondary }}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: tk.textSecondary }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip
                            cursor={false}
                            formatter={(value) => [t('dashboard.charts.hoursLabel', { value }), t('dashboard.charts.hoursUnit')]}
                            contentStyle={{ direction: isRtl ? 'rtl' : 'ltr', borderRadius: 8, border: `1px solid ${tk.borderMedium}` }}
                        />
                        <Bar dataKey="hours" fill={tk.primary} radius={[4, 4, 0, 0]} isAnimationActive={data.length <= 20} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default React.memo(DashboardBarChart);
