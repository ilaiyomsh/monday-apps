import React from 'react';
import { useStableT } from '../../../i18n/useStableT';
import styles from './QuestionsStep.module.css';

/**
 * Minimal questions that decide how the boards we create will look:
 *   0. Source?      ('board' = create everything, 'portfolio' = connect to existing Portfolio)
 *   1. Tasks?       (hidden when source = 'portfolio'; forced true)
 *   2. Stages?
 *   3. Internal vs. external?
 */
const Choice = ({ title, hint, value, onChange, options }) => (
    <div className={styles.card}>
        <div className={styles.title}>{title}</div>
        {hint ? <div className={styles.hint}>{hint}</div> : null}
        <div className={styles.opts}>
            {options.map((opt) => (
                <button
                    key={String(opt.value)}
                    type="button"
                    className={`${styles.opt} ${value === opt.value ? styles.active : ''}`}
                    onClick={() => onChange(opt.value)}
                >{opt.label}</button>
            ))}
        </div>
    </div>
);

const QuestionsStep = ({ answers, setAnswers }) => {
    const t = useStableT();
    const setKey = (key) => (val) => setAnswers((prev) => {
        const next = { ...prev, [key]: val };
        // Switching back to 'board' mode: clear any picked portfolio-only fields.
        if (key === 'source' && val !== 'portfolio') {
            next.portfolioBoardId = null;
            next.projectTypeColumnId = null;
            next.projectTypeMapping = null;
        }
        return next;
    });
    const yesLabel = t('common.yes');
    const noLabel = t('common.no');
    const boolOpts = [
        { value: false, label: noLabel },
        { value: true,  label: yesLabel },
    ];
    const sourceOpts = [
        { value: 'board',     label: t('wizard.steps.questions.source.createLabel') },
        { value: 'portfolio', label: t('wizard.steps.questions.source.portfolioLabel') },
    ];

    return (
        <div className={styles.wrap}>
            <Choice
                title={t('wizard.steps.questions.source.title')}
                hint={t('wizard.steps.questions.source.hint')}
                value={answers.source || 'board'}
                onChange={setKey('source')}
                options={sourceOpts}
            />
            <Choice
                title={t('wizard.steps.questions.tasks.title')}
                hint={t('wizard.steps.questions.tasks.hint')}
                value={answers.tasks}
                onChange={setKey('tasks')}
                options={boolOpts}
            />
            <Choice
                title={t('wizard.steps.questions.stages.title')}
                hint={t('wizard.steps.questions.stages.hint')}
                value={answers.stages}
                onChange={setKey('stages')}
                options={boolOpts}
            />
            <Choice
                title={t('wizard.steps.questions.distinction.title')}
                hint={t('wizard.steps.questions.distinction.hint')}
                value={answers.distinction}
                onChange={setKey('distinction')}
                options={boolOpts}
            />
        </div>
    );
};

export default QuestionsStep;
