import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorPicker } from '@vibe/core';
import { Search } from 'lucide-react';
import { useAllBoardProjects } from '../../hooks/useAllBoardProjects';
import { useProjectColors } from '../../contexts/ProjectColorsContext';
import {
    VIBE_CONTENT_COLORS,
    VIBE_COLOR_TO_HEX,
    hexToVibeColor,
    stringToColor,
    ROUTINE_COLOR_KEY
} from '../../utils/colorUtils';
import logger from '../../utils/logger';
import styles from './ProjectColorsTab.module.css';

const ProjectColorsTab = () => {
    const { t } = useTranslation();
    const { projects, loading: projectsLoading, error } = useAllBoardProjects();
    const { colorMap, setProjectColor, mergeAndPersist, loading: colorsLoading } = useProjectColors();
    const [openProjectId, setOpenProjectId] = useState(null);
    const [search, setSearch] = useState('');
    const popoverRef = useRef(null);

    // ממזג ID-ים חדשים למיפוי הצבעים (eager — חדשים מקבלים stringToColor)
    useEffect(() => {
        if (!projects || projects.length === 0) return;
        const ids = projects.map(p => String(p.id));
        logger.debug('ProjectColorsTab', 'Merging board projects into color map', { count: ids.length });
        mergeAndPersist(ids);
    }, [projects, mergeAndPersist]);

    useEffect(() => {
        if (!openProjectId) return;
        const handleClickOutside = (e) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target)) {
                setOpenProjectId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openProjectId]);

    const filteredSortedProjects = useMemo(() => {
        const q = search.trim().toLowerCase();
        const base = q
            ? (projects || []).filter(p => (p.name || '').toLowerCase().includes(q))
            : (projects || []);
        return [...base].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [projects, search]);

    const handleColorSelect = (projectId, value) => {
        // ColorPicker.onSave מחזיר array של שמות Vibe; ממירים ל-HEX לאחסון
        const vibeName = Array.isArray(value) ? value[0] : value;
        const hex = vibeName && VIBE_COLOR_TO_HEX[vibeName] ? VIBE_COLOR_TO_HEX[vibeName] : null;
        logger.debug('ProjectColorsTab', 'Color selected', { projectId, vibeName, hex });
        if (hex) {
            setProjectColor(projectId, hex);
        }
        setOpenProjectId(null);
    };

    const renderRow = (rowId, displayName) => {
        const currentHex = colorMap[rowId] || stringToColor(rowId);
        const currentVibeName = hexToVibeColor(currentHex);
        const isOpen = openProjectId === rowId;

        return (
            <li key={rowId} className={styles.row}>
                <span className={styles.name} title={displayName}>{displayName}</span>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.swatch}
                        style={{ backgroundColor: currentHex }}
                        aria-label={displayName}
                        onClick={() => setOpenProjectId(isOpen ? null : rowId)}
                    />
                    {isOpen && (
                        <div className={styles.popover} ref={popoverRef}>
                            <ColorPicker
                                value={currentVibeName || ''}
                                colorsList={VIBE_CONTENT_COLORS}
                                isBlackListMode={false}
                                forceUseRawColorList
                                isMultiselect={false}
                                numberOfColorsInLine={7}
                                colorSize="small"
                                onSave={(value) => handleColorSelect(rowId, value)}
                            />
                        </div>
                    )}
                </div>
            </li>
        );
    };

    if (projectsLoading || colorsLoading) {
        return <div className={styles.empty}>{t('settings.projectColors.loading')}</div>;
    }
    if (error) {
        return <div className={styles.empty}>{error}</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.searchWrapper}>
                <Search size={16} className={styles.searchIcon} />
                <input
                    type="text"
                    className={styles.searchInput}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('settings.projectColors.searchPlaceholder')}
                />
            </div>

            <ul className={styles.list}>
                {renderRow(ROUTINE_COLOR_KEY, t('settings.projectColors.routineRow'))}

                {(!projects || projects.length === 0) && (
                    <li className={styles.empty}>{t('settings.projectColors.noProjects')}</li>
                )}
                {projects && projects.length > 0 && filteredSortedProjects.length === 0 && (
                    <li className={styles.empty}>{t('settings.projectColors.noResults')}</li>
                )}
                {filteredSortedProjects.map((project) =>
                    renderRow(String(project.id), project.name)
                )}
            </ul>
        </div>
    );
};

export default ProjectColorsTab;
