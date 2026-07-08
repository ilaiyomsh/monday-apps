import React, { useEffect, useState, useCallback } from 'react';
import { useStableT } from '../../../i18n/useStableT';
import { safeApi } from '../../../utils/mondayApi';
import { parseStatusColumnLabels } from '../../../utils/eventTypeValidation';
import SearchableSelect from '../../SettingsDialog/SearchableSelect';
import logger from '../../../utils/logger';
import styles from './PortfolioPickStep.module.css';

const PORTFOLIO_OBJECT_TYPE_KEY = 'work-management::portfolio';
const BOARDS_PAGE_SIZE = 500;

/**
 * Step shown when answers.source === 'portfolio'.
 * Picks an existing Portfolio board + (if distinction) a status column on it
 * and a label → internal/external mapping.
 */
const PortfolioPickStep = ({ monday, answers, setAnswers }) => {
    const t = useStableT();
    const [boards, setBoards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusColumns, setStatusColumns] = useState([]);
    const [loadingColumns, setLoadingColumns] = useState(false);

    const selectedBoardId = answers.portfolioBoardId || null;
    const distinction = !!answers.distinction;
    const projectTypeColumnId = answers.projectTypeColumnId || null;
    const projectTypeMapping = answers.projectTypeMapping || {};

    // 1. Page through every board (500 per page) and keep only true Portfolios —
    //    identified by `object_type_unique_key === "work-management::portfolio"`.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const collected = [];
                for (let page = 1; ; page++) {
                    const res = await safeApi(
                        monday,
                        'PortfolioPickStep.fetchBoards',
                        `query { boards(limit: ${BOARDS_PAGE_SIZE}, page: ${page}) { id name object_type_unique_key } }`
                    );
                    const pageBoards = res.data?.boards || [];
                    collected.push(...pageBoards);
                    if (pageBoards.length < BOARDS_PAGE_SIZE) break;
                    if (page > 50) break; // safety cap (25k boards)
                }
                if (cancelled) return;
                const portfolios = collected
                    .filter((b) => b.object_type_unique_key === PORTFOLIO_OBJECT_TYPE_KEY)
                    .map((b) => ({ id: String(b.id), name: b.name }));
                setBoards(portfolios);
            } catch (e) {
                logger.error('PortfolioPickStep', 'Failed to load portfolio boards', e);
                if (!cancelled) setBoards([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [monday]);

    // 2. When a portfolio is picked and distinction is on, fetch its status columns.
    useEffect(() => {
        if (!selectedBoardId || !distinction) {
            setStatusColumns([]);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoadingColumns(true);
            try {
                const res = await safeApi(
                    monday,
                    'PortfolioPickStep.fetchStatusColumns',
                    `query { boards(ids: [${selectedBoardId}]) { columns { id title type settings } } }`
                );
                const all = res.data?.boards?.[0]?.columns || [];
                const status = all
                    .filter((c) => c.type === 'status')
                    .map((c) => ({
                        id: c.id,
                        title: c.title,
                        labels: parseStatusColumnLabels(c.settings).map((l) => ({ id: String(l.id), label: l.label })),
                    }));
                if (!cancelled) setStatusColumns(status);
            } catch (e) {
                logger.error('PortfolioPickStep', 'Failed to load status columns', e);
                if (!cancelled) setStatusColumns([]);
            } finally {
                if (!cancelled) setLoadingColumns(false);
            }
        })();
        return () => { cancelled = true; };
    }, [monday, selectedBoardId, distinction]);

    const onBoardChange = useCallback((id) => {
        setAnswers((prev) => ({
            ...prev,
            portfolioBoardId: id || null,
            projectTypeColumnId: null,
            projectTypeMapping: null,
        }));
    }, [setAnswers]);

    const onColumnChange = useCallback((id) => {
        setAnswers((prev) => ({
            ...prev,
            projectTypeColumnId: id || null,
            projectTypeMapping: {},
        }));
    }, [setAnswers]);

    const onLabelRoleChange = useCallback((labelId, role) => {
        setAnswers((prev) => {
            const next = { ...(prev.projectTypeMapping || {}) };
            if (role === 'none') {
                delete next[labelId];
            } else {
                next[labelId] = role;
            }
            return { ...prev, projectTypeMapping: next };
        });
    }, [setAnswers]);

    const columnOptions = statusColumns.map((c) => ({ id: c.id, name: c.title }));
    const labels = statusColumns.find((c) => c.id === projectTypeColumnId)?.labels || [];

    return (
        <div className={styles.wrap}>
            <div className={styles.card}>
                <div className={styles.title}>{t('wizard.steps.portfolio.title')}</div>
                <div className={styles.hint}>{t('wizard.steps.portfolio.hint')}</div>

                <label className={styles.fieldLabel}>{t('wizard.steps.portfolio.boardLabel')}</label>
                {!loading && boards.length === 0 ? (
                    <div className={styles.warn}>
                        <div>{t('wizard.steps.portfolio.noneFound')}</div>
                        <div className={styles.hint} style={{ marginTop: 6 }}>
                            {t('wizard.steps.portfolio.noneFoundHelp')}
                        </div>
                    </div>
                ) : (
                    <SearchableSelect
                        options={boards}
                        value={selectedBoardId}
                        onChange={onBoardChange}
                        placeholder={t('wizard.steps.portfolio.boardPlaceholder')}
                        isLoading={loading}
                        showSearch={true}
                    />
                )}
            </div>

            {distinction && selectedBoardId && (
                <div className={styles.card}>
                    <label className={styles.fieldLabel}>
                        {t('wizard.steps.portfolio.projectTypeColumnLabel')}
                    </label>
                    <div className={styles.hint}>{t('wizard.steps.portfolio.projectTypeColumnHint')}</div>
                    <SearchableSelect
                        options={columnOptions}
                        value={projectTypeColumnId}
                        onChange={onColumnChange}
                        placeholder={t('wizard.steps.portfolio.projectTypeColumnPlaceholder')}
                        isLoading={loadingColumns}
                        showSearch={false}
                    />

                    {projectTypeColumnId && labels.length > 0 && (
                        <div className={styles.mapping}>
                            <div className={styles.fieldLabel}>{t('wizard.steps.portfolio.mappingLabel')}</div>
                            <div className={styles.hint}>{t('wizard.steps.portfolio.mappingHint')}</div>
                            {labels.map((l) => {
                                const role = projectTypeMapping[l.id] || 'none';
                                return (
                                    <div key={l.id} className={styles.mapRow}>
                                        <span className={styles.mapLabel}>{l.label}</span>
                                        <div className={styles.mapOpts}>
                                            {['internal', 'external', 'none'].map((r) => (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    className={`${styles.mapOpt} ${role === r ? styles.mapOptActive : ''}`}
                                                    onClick={() => onLabelRoleChange(l.id, r)}
                                                >
                                                    {t(`wizard.steps.portfolio.mapping${r === 'internal' ? 'Internal' : r === 'external' ? 'External' : 'None'}`)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PortfolioPickStep;
