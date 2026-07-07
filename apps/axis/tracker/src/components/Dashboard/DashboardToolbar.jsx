import React from 'react';
import { ArrowRight, ArrowLeft, Settings, Download } from 'lucide-react';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import styles from './Dashboard.module.css';

/**
 * סרגל כלים של הדשבורד
 */
const DashboardToolbar = ({ onSwitchToCalendar, isOwner, onOpenSettings, onExport, exportDisabled, hasIncompleteSettings = false }) => {
    const t = useStableT();
    const { isRtl } = useLocale();
    // "Back" צריך להצביע לכיוון ההתחלה של ציר הקריאה: ב-LTR שמאלה (←),
    // ב-RTL ימינה (→). ArrowRight/ArrowLeft של lucide הם אייקונים נפרדים
    // — אין mirroring אוטומטי, לכן בוחרים מפורשות.
    const BackIcon = isRtl ? ArrowRight : ArrowLeft;
    return (
        <div className={styles.toolbar}>
            <div className={styles.toolbarRight}>
                <button
                    type="button"
                    className={styles.backBtn}
                    onClick={onSwitchToCalendar}
                    aria-label={t('dashboard.backToCalendar')}
                >
                    <BackIcon size={20} />
                    <span>{t('dashboard.backToCalendar')}</span>
                </button>
                <h2 className={styles.toolbarTitle}>{t('dashboard.title')}</h2>
            </div>

            <div className={styles.toolbarLeft}>
                <button
                    type="button"
                    className={styles.settingsBtn}
                    onClick={onExport}
                    disabled={exportDisabled}
                    aria-label={t('dashboard.exportCsv')}
                    title={t('dashboard.exportExcel')}
                >
                    <Download size={20} />
                </button>
                {isOwner ? (
                    <button
                        type="button"
                        className={
                            hasIncompleteSettings
                                ? `${styles.settingsBtn} ${styles.settingsBtnIncomplete}`
                                : styles.settingsBtn
                        }
                        onClick={onOpenSettings}
                        aria-label={t('dashboard.settings')}
                        title={hasIncompleteSettings ? t('settings.incompleteWarning') : undefined}
                    >
                        <Settings size={20} />
                    </button>
                ) : null}
            </div>
        </div>
    );
};

export default DashboardToolbar;
