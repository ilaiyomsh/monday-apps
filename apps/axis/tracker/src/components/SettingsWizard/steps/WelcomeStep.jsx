import React from 'react';
import { useStableT } from '../../../i18n/useStableT';
import styles from './WelcomeStep.module.css';

/**
 * שלב 1 באשף — מסך פתיחה.
 * מוצג רק במצב firstInstall; ב-reRun מדלגים.
 *
 * Inline SVG icons (sparkles, zap, layers, settings) ported verbatim
 * from the mockup so this step has no external icon dependency.
 */

const ICON_SPARKLES = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 14 9 20 11 14 13 12 19 10 13 4 11 10 9 Z"/><path d="M19 3 20 6 23 7 20 8 19 11 18 8 15 7 18 6 Z"/><path d="M5 15 6 17 8 18 6 19 5 21 4 19 2 18 4 17 Z"/></svg>';
const ICON_ZAP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>';
const ICON_LAYERS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
const ICON_SETTINGS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

const Svg = ({ html }) => <span dangerouslySetInnerHTML={{ __html: html }} />;

const WelcomeStep = () => {
    const t = useStableT();
    return (
        <div className={styles.welcome}>
            <div className={styles.mark}><Svg html={ICON_SPARKLES} /></div>
            <h2 className={styles.headline}>{t('wizard.steps.welcome.headline')}</h2>
            <p className={styles.lede}>
                {t('wizard.steps.welcome.lede')}
            </p>
            <div className={styles.feats}>
                <div className={styles.card}>
                    <div className={styles.ic}><Svg html={ICON_ZAP} /></div>
                    <h4 className={styles.cardTitle}>{t('wizard.steps.welcome.cards.zeroSetup.title')}</h4>
                    <p className={styles.cardDesc}>{t('wizard.steps.welcome.cards.zeroSetup.desc')}</p>
                </div>
                <div className={styles.card}>
                    <div className={styles.ic}><Svg html={ICON_LAYERS} /></div>
                    <h4 className={styles.cardTitle}>{t('wizard.steps.welcome.cards.sampleData.title')}</h4>
                    <p className={styles.cardDesc}>{t('wizard.steps.welcome.cards.sampleData.desc')}</p>
                </div>
                <div className={styles.card}>
                    <div className={styles.ic}><Svg html={ICON_SETTINGS} /></div>
                    <h4 className={styles.cardTitle}>{t('wizard.steps.welcome.cards.fullControl.title')}</h4>
                    <p className={styles.cardDesc}>{t('wizard.steps.welcome.cards.fullControl.desc')}</p>
                </div>
            </div>
        </div>
    );
};

export default WelcomeStep;
