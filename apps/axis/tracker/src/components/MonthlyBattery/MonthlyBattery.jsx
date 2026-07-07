import React, { useState, useRef } from 'react';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import styles from './MonthlyBattery.module.css';

const MonthlyBattery = ({
    breakdown = [],
    totalHours = 0,
    targetHours = 182.5,
    loading = false
}) => {
    const t = useStableT();
    const { dateLocale } = useLocale();
    const [showTooltip, setShowTooltip] = useState(false);
    const batteryRef = useRef(null);

    const percentage = targetHours > 0 ? Math.round((totalHours / targetHours) * 100) : 0;
    const fillPercent = Math.min(percentage, 100);
    const formatNum = (n) => Number(n || 0).toLocaleString(dateLocale);
    const hoursUnit = t('monthlyBattery.hoursUnit');

    return (
        <div className={styles.container}>
            {/* הבטרייה */}
            <div
                className={styles.batteryWrapper}
                ref={batteryRef}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
            >
                <div className={styles.batteryTrack}>
                    {loading ? (
                        <div className={styles.batteryLoading} />
                    ) : (
                        <div className={styles.batteryFill} style={{ width: `${fillPercent}%` }}>
                            {breakdown.map((item) => {
                                const segmentPercent = targetHours > 0
                                    ? (item.hours / targetHours) * 100
                                    : 0;
                                if (segmentPercent <= 0) return null;
                                // הגנה מפני חלוקה באפס: totalHours יכול להיות 0 כש-breakdown ריק/אפס
                                const segmentWidth = totalHours > 0
                                    ? (item.hours / totalHours) * 100
                                    : 0;
                                return (
                                    <div
                                        key={item.index}
                                        className={styles.batterySegment}
                                        style={{
                                            width: `${segmentWidth}%`,
                                            backgroundColor: item.color
                                        }}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* אחוז */}
                <span className={styles.percentText}>
                    {loading ? '...' : `${percentage}%`}
                </span>

                {/* Tooltip */}
                {showTooltip && !loading && breakdown.length > 0 && (
                    <div className={styles.tooltip}>
                        {breakdown.map((item) => (
                            <div key={item.index} className={styles.tooltipRow}>
                                <span
                                    className={styles.tooltipDot}
                                    style={{ backgroundColor: item.color }}
                                />
                                <span className={styles.tooltipLabel}>{item.label}</span>
                                <span className={styles.tooltipHours}>{formatNum(item.hours)} {hoursUnit}</span>
                            </div>
                        ))}
                        <div className={styles.tooltipDivider} />
                        <div className={styles.tooltipTotal}>
                            <span>{t('monthlyBattery.total')}</span>
                            <span>{formatNum(totalHours)} / {formatNum(targetHours)} {hoursUnit}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MonthlyBattery;
