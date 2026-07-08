import React, { useMemo } from 'react';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import useTokens from '../../hooks/useTokens';
import styles from './Dashboard.module.css';

/**
 * כרטיסי KPI - סטטיסטיקות ראשיות
 */
const DashboardStats = ({ stats, billFilter, projectFilterActive, compactMode, enableDistinction }) => {
    const t = useStableT();
    const { dateLocale } = useLocale();
    const tk = useTokens();
    const percentFormatter = useMemo(
        () => new Intl.NumberFormat(dateLocale, { style: 'percent', maximumFractionDigits: 0 }),
        [dateLocale]
    );
    const formatPercent = (num) => percentFormatter.format((num || 0) / 100);
    const { totalHours, billableHours, nonBillableHours, billablePercent,
            internalHours, externalHours, routineHours,
            internalColor, externalColor, routineColor } = stats;

    const percentColor = billablePercent >= 70 ? tk.approvalGreen : tk.pctWarning;

    if (compactMode) {
        return (
            <div className={styles.statCard}>
                <h3 className={styles.chartTitle}>{t("dashboard.stats.totalHours")}</h3>
                <span className={styles.statValueHero}>{totalHours}</span>
            </div>
        );
    }

    if (enableDistinction) {
        const projectHours = Math.round((internalHours + externalHours) * 100) / 100;
        const projectPercent = totalHours > 0
            ? Math.round((projectHours / totalHours) * 100)
            : 0;
        const pctColor = projectPercent >= 70 ? tk.approvalGreen : tk.pctWarning;

        return (
            <div className={styles.statsPyramid}>
                {/* שורה 1: סה"כ שעות */}
                <div className={styles.pyramidRow1}>
                    <div className={styles.statCard}>
                        <h3 className={styles.chartTitle}>{t("dashboard.stats.totalHours")}</h3>
                        <span className={styles.statValueHero}>{totalHours}</span>
                    </div>
                </div>
                {/* שורה 2: אחוז + שעות פרויקטים */}
                <div className={styles.pyramidRow2}>
                    <div className={styles.statCard}>
                        <h3 className={styles.chartTitle}>{t("dashboard.stats.projectsPercent")}</h3>
                        <span className={styles.statValue} style={{ color: pctColor }}>{formatPercent(projectPercent)}</span>
                    </div>
                    <div className={styles.statCard}>
                        <h3 className={styles.chartTitle}>{t("dashboard.stats.projectsHours")}</h3>
                        <span className={`${styles.statValue} ${styles.statBillable}`}>{projectHours}</span>
                    </div>
                </div>
                {/* שורה 3: פנימי + חיצוני + שוטף */}
                <div className={styles.pyramidRow3}>
                    <div className={styles.statCard}>
                        <h3 className={styles.chartTitle}>{t("dashboard.stats.internalHours")}</h3>
                        <span className={styles.statValue} style={{ color: internalColor }}>{internalHours}</span>
                    </div>
                    <div className={styles.statCard}>
                        <h3 className={styles.chartTitle}>{t("dashboard.stats.externalHours")}</h3>
                        <span className={styles.statValue} style={{ color: externalColor }}>{externalHours}</span>
                    </div>
                    <div className={styles.statCard}>
                        <h3 className={styles.chartTitle}>{t("dashboard.stats.routineHours")}</h3>
                        <span className={styles.statValue} style={{ color: routineColor }}>{routineHours}</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.statsPyramid}>
            {/* שורה 1: סה"כ שעות */}
            <div className={styles.pyramidRow1}>
                <div className={styles.statCard}>
                    <h3 className={styles.chartTitle}>{t("dashboard.stats.totalHours")}</h3>
                    <span className={styles.statValueHero}>{totalHours}</span>
                </div>
            </div>
            {/* שורה 2: אחוז + שעות פרויקטים + שעות שוטף */}
            <div className={styles.pyramidRow3}>
                <div className={styles.statCard}>
                    <h3 className={styles.chartTitle}>{t("dashboard.stats.projectsPercent")}</h3>
                    <span className={styles.statValue} style={{ color: percentColor }}>{formatPercent(billablePercent)}</span>
                </div>
                <div className={styles.statCard}>
                    <h3 className={styles.chartTitle}>{t("dashboard.stats.projectsHours")}</h3>
                    <span className={`${styles.statValue} ${styles.statBillable}`}>{billableHours}</span>
                </div>
                <div className={styles.statCard}>
                    <h3 className={styles.chartTitle}>{t("dashboard.stats.routineHours")}</h3>
                    <span className={`${styles.statValue} ${styles.statNonBillable}`}>{nonBillableHours}</span>
                </div>
            </div>
        </div>
    );
};

export default React.memo(DashboardStats);
