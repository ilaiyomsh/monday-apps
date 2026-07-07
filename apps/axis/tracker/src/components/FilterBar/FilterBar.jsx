import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Filter, ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './FilterBar.module.css';

/**
 * רכיב SplitFilter - פילטר מאוחד עם שני עמודות
 * מאפשר סינון אירועים לפי אנשים ופרויקטים בדרופדאון אחד
 */
const FilterBar = ({
    reporters = [],           // [{id, name, photo}]
    projects = [],            // [{id, name}]
    selectedReporterIds = [],
    selectedProjectIds = [],
    onReporterChange,
    onProjectChange,
    onClear,
    hasActiveFilter,
    isLoadingReporters = false,
    isLoadingProjects = false,
    // Temporary events toggle
    showTemporaryEvents = true,
    onToggleTemporaryEvents = null,
    hasTemporaryEventsFeature = false
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [reporterSearch, setReporterSearch] = useState('');
    const [projectSearch, setProjectSearch] = useState('');

    // Ref על כל הרכיב - כולל הכפתור והדרופדאון
    const wrapperRef = useRef(null);

    // זיהוי קליק מחוץ לרכיב - לפי התבנית המומלצת
    useEffect(() => {
        const handleClickOutside = (event) => {
            // סגור רק אם פתוח והקליק היה מחוץ ל-wrapper
            if (isOpen && wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
                setReporterSearch('');
                setProjectSearch('');
            }
        };

        // הוסף listener רק כשפתוח
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // סינון אנשים לפי חיפוש
    const filteredReporters = useMemo(() =>
        reporters.filter(r =>
            (r.name || '').toLowerCase().includes(reporterSearch.toLowerCase())
        ),
        [reporters, reporterSearch]
    );

    // סינון פרויקטים לפי חיפוש
    const filteredProjects = useMemo(() =>
        projects.filter(p => {
            const name = p.name || p.label || '';
            return name.toLowerCase().includes(projectSearch.toLowerCase());
        }),
        [projects, projectSearch]
    );

    // טוגל בחירת מדווח - לא סוגר את הדרופדאון
    const toggleReporter = (id) => {
        const idStr = String(id);
        const currentIds = selectedReporterIds.map(x => String(x));
        const newIds = currentIds.includes(idStr)
            ? currentIds.filter(x => x !== idStr)
            : [...currentIds, idStr];
        onReporterChange(newIds.map(x => parseInt(x)));
    };

    // טוגל בחירת פרויקט - לא סוגר את הדרופדאון
    const toggleProject = (id) => {
        const idStr = String(id);
        const currentIds = selectedProjectIds.map(x => String(x));
        const newIds = currentIds.includes(idStr)
            ? currentIds.filter(x => x !== idStr)
            : [...currentIds, idStr];
        onProjectChange(newIds);
    };

    // חישוב סה"כ נבחרים
    const totalCount = selectedReporterIds.length + selectedProjectIds.length;

    // קלאסים לכפתור הטריגר
    const triggerClasses = [
        styles.trigger,
        hasActiveFilter ? styles.triggerActive : '',
        isOpen ? styles.triggerOpen : ''
    ].filter(Boolean).join(' ');

    return (
        <div className={styles.filterContainer} ref={wrapperRef}>
            {/* כפתור טריגר */}
            <button
                className={triggerClasses}
                onClick={() => setIsOpen(prev => !prev)}
                type="button"
            >
                <Filter size={18} strokeWidth={2} className={styles.filterIcon} />
                <span className={styles.triggerText}>{t('filterBar.trigger')}</span>
                {totalCount > 0 && (
                    <span className={styles.badge}>{totalCount}</span>
                )}
                <ChevronDown
                    size={18}
                    strokeWidth={2}
                    className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
                />
            </button>

            {/* דרופדאון */}
            {isOpen && (
                <div className={styles.dropdown}>
                    {/* טוגל מתוכננים */}
                    {hasTemporaryEventsFeature && onToggleTemporaryEvents && (
                        <div className={styles.toggleRow}>
                            <span className={styles.toggleLabel}>{t('filterBar.showPlanned')}</span>
                            <label className={styles.toggleSwitch}>
                                <input
                                    type="checkbox"
                                    checked={showTemporaryEvents}
                                    onChange={onToggleTemporaryEvents}
                                />
                                <span className={styles.toggleSlider} />
                            </label>
                        </div>
                    )}
                    <div className={styles.columns}>
                        {/* עמודת אנשים (ימין ב-RTL) */}
                        <div className={styles.column}>
                            <div className={styles.columnHeader}>
                                <span>{t('filterBar.peopleColumn')}</span>
                                {selectedReporterIds.length > 0 && (
                                    <span className={styles.columnBadge}>
                                        {selectedReporterIds.length}
                                    </span>
                                )}
                            </div>
                            <div className={styles.searchContainer}>
                                <Search size={14} className={styles.searchIcon} />
                                <input
                                    type="text"
                                    className={styles.searchInput}
                                    placeholder={t('filterBar.searchPlaceholder')}
                                    value={reporterSearch}
                                    onChange={(e) => setReporterSearch(e.target.value)}
                                />
                            </div>
                            <div className={styles.optionsList}>
                                {isLoadingReporters ? (
                                    <div className={styles.loading}>{t('filterBar.loading')}</div>
                                ) : filteredReporters.length > 0 ? (
                                    filteredReporters.map((reporter) => {
                                        const isSelected = selectedReporterIds
                                            .map(x => String(x))
                                            .includes(String(reporter.id));
                                        return (
                                            <div
                                                key={reporter.id}
                                                className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                                                onClick={() => toggleReporter(reporter.id)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {}}
                                                    className={styles.checkbox}
                                                />
                                                <span className={styles.optionName}>{reporter.name}</span>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className={styles.noResults}>
                                        {reporterSearch ? t('filterBar.noResults') : t('filterBar.noPeopleAvailable')}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* מפריד */}
                        <div className={styles.divider} />

                        {/* עמודת פרויקטים (שמאל ב-RTL) */}
                        <div className={styles.column}>
                            <div className={styles.columnHeader}>
                                <span>{t('filterBar.projectsColumn')}</span>
                                {selectedProjectIds.length > 0 && (
                                    <span className={styles.columnBadge}>
                                        {selectedProjectIds.length}
                                    </span>
                                )}
                            </div>
                            <div className={styles.searchContainer}>
                                <Search size={14} className={styles.searchIcon} />
                                <input
                                    type="text"
                                    className={styles.searchInput}
                                    placeholder={t('filterBar.searchPlaceholder')}
                                    value={projectSearch}
                                    onChange={(e) => setProjectSearch(e.target.value)}
                                />
                            </div>
                            <div className={styles.optionsList}>
                                {isLoadingProjects ? (
                                    <div className={styles.loading}>{t('filterBar.loading')}</div>
                                ) : filteredProjects.length > 0 ? (
                                    filteredProjects.map((project) => {
                                        const projectId = project.id || project.value;
                                        const projectName = project.name || project.label;
                                        const isSelected = selectedProjectIds
                                            .map(x => String(x))
                                            .includes(String(projectId));
                                        return (
                                            <div
                                                key={projectId}
                                                className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                                                onClick={() => toggleProject(projectId)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => {}}
                                                    className={styles.checkbox}
                                                />
                                                <span className={styles.optionName}>{projectName}</span>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className={styles.noResults}>
                                        {projectSearch ? t('filterBar.noResults') : t('filterBar.noProjectsAvailable')}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* פוטר עם כפתור ניקוי */}
                    {hasActiveFilter && (
                        <div className={styles.footer}>
                            <button
                                type="button"
                                className={styles.clearButton}
                                onClick={onClear}
                            >
                                {t('filterBar.clearSelection')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default FilterBar;
