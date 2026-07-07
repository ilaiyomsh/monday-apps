import React, { useState } from 'react';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../Toast';

import logger from '../../utils/logger';
import { useBoardBuilder } from './useBoardBuilder';
import { buildSteps } from './constants';

import WelcomeStep from './steps/WelcomeStep';
import QuestionsStep from './steps/QuestionsStep';
import PortfolioPickStep from './steps/PortfolioPickStep';
import InstallStep from './steps/InstallStep';

import styles from './SettingsWizard.module.css';

/**
 * אשף ההגדרות המינימלי.
 * 3 שלבים: ברוכים הבאים → 3 שאלות → התקנה (יצירת לוחות + שמירת הגדרות).
 *
 * Props:
 *   monday   — Monday SDK instance
 *   context  — Monday SDK context (לא בשימוש כעת, נשאר ל-API תאימות)
 *   mode     — 'firstInstall' | 'reRun' (משפיע רק על מסך הפתיחה)
 *   onClose  — () => void
 */
const SettingsWizard = ({ monday, context, mode = 'firstInstall', onClose }) => {
    const t = useStableT();
    const { dir } = useLocale();
    const isFirstInstall = mode === 'firstInstall';
    const { customSettings, updateSettings } = useSettings();
    const { toasts, removeToast, showSuccess, showErrorWithDetails } = useToast();

    // ברירות מחדל = "לא" (התקנה מינימלית); source ברירת מחדל 'board'.
    const [answers, setAnswers] = useState({
        source: 'board',
        tasks: false,
        stages: false,
        distinction: false,
        portfolioBoardId: null,
        projectTypeColumnId: null,
        projectTypeMapping: null,
    });

    const STEPS = buildSteps(answers);

    // מתחילים מ-welcome ב-firstInstall, או מ-questions ב-reRun
    const [stepIndex, setStepIndex] = useState(isFirstInstall ? 0 : 1);
    const stepDef = STEPS[stepIndex];

    const builder = useBoardBuilder(monday, context);
    const [saved, setSaved] = useState(false);

    const handleInstall = async () => {
        try {
            // W4.6: מקור ההיעדרויות מגיע מההגדרות הקיימות (לא משאלות האשף) —
            // תחת 'dayoff' הבילדר מדלג על יצירת עמודת סוג היום (All-day Type).
            const settings = await builder.build({
                ...answers,
                absenceSource: customSettings?.absenceSource,
            });
            const ok = await updateSettings(settings);
            if (ok) {
                showSuccess(t('toasts.settingsSaved'));
                setSaved(true);
            } else {
                // updateSettings החזיר false — שמירה כושלת. רשומה אחת שנושאת את הודעת
                // המשתמש; ה-UI sink מציג ממנה את הטוסט (איחוד A-double)
                logger.error('SettingsWizard', 'updateSettings returned false during install (save failed)', new Error(t('settings.messages.saveError')));
            }
        } catch (e) {
            showErrorWithDetails(e, { functionName: 'SettingsWizard.handleInstall' });
        }
    };

    // Block "Next" out of the portfolio step until required picks are valid.
    const isMappingComplete = (mapping) => {
        if (!mapping) return false;
        const roles = Object.values(mapping);
        return roles.includes('internal') && roles.includes('external');
    };
    const canAdvance = () => {
        if (stepDef?.id !== 'portfolio') return true;
        if (!answers.portfolioBoardId) return false;
        if (answers.distinction) {
            if (!answers.projectTypeColumnId) return false;
            if (!isMappingComplete(answers.projectTypeMapping)) return false;
        }
        return true;
    };

    const handleNext = () => {
        if (stepIndex < STEPS.length - 1 && canAdvance()) setStepIndex(stepIndex + 1);
    };
    const handleBack = () => {
        if (stepIndex > 0) setStepIndex(stepIndex - 1);
    };

    const handleClose = () => {
        if (typeof onClose === 'function') onClose();
    };

    const renderStep = () => {
        switch (stepDef?.id) {
            case 'welcome':
                return <WelcomeStep />;
            case 'questions':
                return <QuestionsStep answers={answers} setAnswers={setAnswers} />;
            case 'portfolio':
                return <PortfolioPickStep monday={monday} answers={answers} setAnswers={setAnswers} />;
            case 'install':
                return (
                    <InstallStep
                        answers={answers}
                        running={builder.running}
                        progress={builder.progress}
                        error={builder.error}
                        result={builder.result}
                        saved={saved}
                        onInstall={handleInstall}
                        onOpenApp={handleClose}
                    />
                );
            default:
                return null;
        }
    };

    const isWelcome  = stepDef?.id === 'welcome';
    const isInstall  = stepDef?.id === 'install';
    const nextCta    = isWelcome ? t('wizard.getStarted') : t('wizard.next');

    return (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('wizard.dialogAria')}>
        <div className={styles.app} dir={dir}>
            <header className={styles.header}>
                <div className={styles['top-row']}>
                    <div className={styles.brand}>
                        <div className={styles.logo}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                        </div>
                        <div>
                            <div className={styles.eyebrow}>{t('wizard.eyebrow')}</div>
                            <h1>{t('wizard.title')}</h1>
                        </div>
                    </div>
                    <button
                        type="button"
                        className={styles['btn']}
                        onClick={handleClose}
                        aria-label={t('wizard.closeAria')}
                        disabled={builder.running}
                    >{t('wizard.close')}</button>
                </div>

                <div className={styles.stepper} role="tablist" aria-label={t('wizard.stepperAria')}>
                    {STEPS.map((s, i) => {
                        const done   = i < stepIndex || (isInstall && saved);
                        const active = i === stepIndex;
                        return (
                            <div
                                key={s.id}
                                role="tab"
                                aria-selected={active}
                                className={`${styles.step} ${active ? styles.active : ''} ${done ? styles.done : ''}`}
                            >
                                <div className={styles.bar} />
                                <div className={styles['step-label']}>
                                    <span className={styles['step-num']}>{done ? '✓' : i + 1}</span>
                                    <span>{t(s.labelKey)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </header>

            <div className={styles['content-card']}>
                <div className={styles['content-body']}>
                    {renderStep()}
                </div>

                <div className={styles['content-footer']}>
                    <div>
                        {!isWelcome && !isInstall ? (
                            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={handleBack}>{t('wizard.back')}</button>
                        ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {!isInstall ? (
                            <button
                                type="button"
                                className={`${styles.btn} ${styles.primary} ${isWelcome ? styles.lg : ''}`}
                                onClick={handleNext}
                                disabled={!canAdvance()}
                            >{nextCta}</button>
                        ) : null}
                    </div>
                </div>
            </div>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
        </div>
    );
};

export default SettingsWizard;
