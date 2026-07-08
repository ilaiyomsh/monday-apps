import React, { useState } from 'react';
import { useStableT } from '../../../i18n/useStableT';
import styles from './InstallStep.module.css';

/**
 * Install step. Shows progress bar (always) + collapsed log (toggle).
 */

const expectedSteps = (answers) => {
    // Rough count of `log()` calls in useBoardBuilder for the given answers,
    // so the progress bar fills proportionally.
    let n = 1;             // target line
    if (answers.source === 'portfolio') {
        n += 1;            // create Time Logs board
        n += 5;            // date, endTime, duration, project link, reporter
        if (answers.tasks) n += 1;  // task link
        n += 1;            // eventType
        n += 3;            // routineType, allDayType, temporary
        if (answers.stages) n += 1; // classification
        n += 1;            // notes
        n += 1;            // seed portfolio sample logs
        n += 1;            // saving settings
        return n;
    }
    n += 2;                // create Customers, Projects
    n += 1;                // Customer link
    n += 1;                // Customers ← Projects link
    n += 1;                // Owners
    if (answers.distinction) n += 1; // Project Type
    if (answers.tasks) n += 3;       // Tasks board, Tasks→Project, Projects→Tasks
    n += 1;                // create Time Logs
    n += 6;                // Date, End Time, Duration, Project, Customer, Reporter
    if (answers.tasks) n += 2;       // Task link + Tasks ← Time Logs
    n += 2;                // Event Type, Routine Type
    n += 2;                // All-day Type, Temporary
    if (answers.stages) n += 1;      // Classification
    n += 1;                // Notes
    n += 3;                // seed customers, projects, time logs
    if (answers.tasks) n += 1;       // seed tasks
    n += 1;                // saving settings
    return n;
};

const InstallStep = ({ answers, running, progress, error, result, saved, onInstall, onOpenApp }) => {
    const t = useStableT();
    const [showDetails, setShowDetails] = useState(false);
    const yesLabel = t('common.yes');
    const noLabel = t('common.no');
    const summary = [
        t('wizard.steps.install.summary.tasks', { value: answers.tasks ? yesLabel : noLabel }),
        t('wizard.steps.install.summary.stages', { value: answers.stages ? yesLabel : noLabel }),
        t('wizard.steps.install.summary.distinction', { value: answers.distinction ? yesLabel : noLabel }),
    ].join(' • ');

    const total = expectedSteps(answers);
    const done = progress.length;
    const pct = saved ? 100 : Math.min(95, Math.round((done / total) * 100));
    const showProgress = running || progress.length > 0 || error;

    const lastLine = progress[progress.length - 1] || '';

    return (
        <div className={styles.wrap}>
            <div className={styles.summary}>
                <div className={styles.summaryTitle}>{t('wizard.steps.install.yourChoices')}</div>
                <div className={styles.summaryText}>{summary}</div>
            </div>

            {!running && !saved && !error && (
                <button type="button" className={styles.installBtn} onClick={onInstall}>
                    {t('wizard.steps.install.createButton')}
                </button>
            )}

            {showProgress && (
                <div className={styles.progressBlock}>
                    <div className={styles.progressBar}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${pct}%` }}
                            data-state={error ? 'error' : saved ? 'done' : 'running'}
                        />
                    </div>
                    <div className={styles.progressMeta}>
                        <span className={styles.progressPct}>{pct}%</span>
                        <span className={styles.progressNow}>{error ? t('wizard.steps.install.errorPrefix') : saved ? t('wizard.steps.install.donePrefix') : lastLine || t('wizard.steps.install.starting')}</span>
                        {!error && (
                            <button
                                type="button"
                                className={styles.detailsBtn}
                                onClick={() => setShowDetails((v) => !v)}
                            >
                                {showDetails ? t('wizard.steps.install.hideDetails') : t('wizard.steps.install.showDetails')}
                            </button>
                        )}
                    </div>

                    {(showDetails || error) && (
                        <div className={styles.log}>
                            {progress.map((msg, i) => (
                                <div key={i} className={styles.logLine}>{msg}</div>
                            ))}
                            {error && <div className={styles.logError}>{t('wizard.steps.install.errorLogPrefix', { message: error })}</div>}
                            {running && <div className={styles.logLine}>...</div>}
                        </div>
                    )}
                </div>
            )}

            {saved && result && (
                <div className={styles.success}>
                    <div className={styles.successTitle}>{t('wizard.steps.install.successTitle')}</div>
                    <div className={styles.successText}>
                        {t('wizard.steps.install.successText', { count: Object.keys(result.boards).length })}
                    </div>
                    <button type="button" className={styles.openBtn} onClick={onOpenApp}>
                        {t('wizard.steps.install.openApp')}
                    </button>
                </div>
            )}

            {error && !running && (
                <button type="button" className={styles.installBtn} onClick={onInstall}>
                    {t('wizard.steps.install.tryAgain')}
                </button>
            )}
        </div>
    );
};

export default InstallStep;
