import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGantt } from '../../hooks/useGantt';
import styles from './ProjectFilterDropdown.module.css';

interface ProjectFilterDropdownProps {
  iconOnly?: boolean;
}

export const ProjectFilterDropdown: React.FC<ProjectFilterDropdownProps> = ({ iconOnly = false }) => {
  const { t } = useTranslation();
  const {
    pmFilter,
    setPmFilter,
    projectTypeFilter,
    setProjectTypeFilter,
    availablePMs,
    availableProjectTypes,
    showOnlyActiveProjectsWithoutAllocations,
    setShowOnlyActiveProjectsWithoutAllocations,
    settings,
  } = useGantt();
  // The "active projects without allocations" toggle only makes sense when the
  // settings enable active-project filtering — otherwise activeProjectIds covers everything.
  const canFilterActiveOnly = !!settings?.filterActiveProjects && !!settings?.projectStatusColumnId;

  const [isOpen, setIsOpen] = useState(false);
  const [pmSearch, setPmSearch] = useState('');
  const [typeSearch, setTypeSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Calculate dropdown position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }, []);

  // Close on outside click (and reset search)
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setIsOpen(false);
      setPmSearch('');
      setTypeSearch('');
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, updatePosition]);

  // Filter PMs by search
  const filteredPMs = useMemo(() => {
    if (!pmSearch.trim()) return availablePMs;
    const query = pmSearch.toLowerCase();
    return availablePMs.filter(pm => pm.name.toLowerCase().includes(query));
  }, [availablePMs, pmSearch]);

  // Filter project types by search
  const filteredTypes = useMemo(() => {
    if (!typeSearch.trim()) return availableProjectTypes;
    const query = typeSearch.toLowerCase();
    return availableProjectTypes.filter(type => type.label.toLowerCase().includes(query));
  }, [availableProjectTypes, typeSearch]);

  const totalActiveFilters = pmFilter.length + projectTypeFilter.length + (showOnlyActiveProjectsWithoutAllocations ? 1 : 0);
  const hasActiveFilter = totalActiveFilters > 0;

  const togglePm = (id: string) => {
    if (pmFilter.includes(id)) {
      setPmFilter(pmFilter.filter(pmId => pmId !== id));
    } else {
      setPmFilter([...pmFilter, id]);
    }
  };

  const toggleType = (label: string) => {
    if (projectTypeFilter.includes(label)) {
      setProjectTypeFilter(projectTypeFilter.filter(t => t !== label));
    } else {
      setProjectTypeFilter([...projectTypeFilter, label]);
    }
  };

  const clearAllFilters = () => {
    setPmFilter([]);
    setProjectTypeFilter([]);
    setShowOnlyActiveProjectsWithoutAllocations(false);
  };

  // Don't render if no filter options are available (and no active-only toggle to show)
  if (availablePMs.length === 0 && availableProjectTypes.length === 0 && !canFilterActiveOnly) {
    return null;
  }

  const triggerClasses = iconOnly
    ? [
        styles.iconTrigger,
        hasActiveFilter ? styles.iconTriggerActive : '',
        isOpen ? styles.iconTriggerOpen : ''
      ].filter(Boolean).join(' ')
    : [
        styles.trigger,
        hasActiveFilter ? styles.triggerActive : '',
        isOpen ? styles.triggerOpen : ''
      ].filter(Boolean).join(' ');

  const handleToggle = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    if (!newIsOpen) {
      setPmSearch('');
      setTypeSearch('');
    }
  };

  return (
    <div className={styles.filterContainer}>
      {iconOnly ? (
        <button
          ref={triggerRef}
          onClick={handleToggle}
          className={triggerClasses}
          title={t('projectFilter.button')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          {totalActiveFilters > 0 && (
            <span className={styles.iconBadge}>{totalActiveFilters}</span>
          )}
        </button>
      ) : (
        <button ref={triggerRef} onClick={handleToggle} className={triggerClasses}>
          <span className={styles.filterIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </span>
          <span className={styles.triggerText}>{t('projectFilter.button')}</span>
          {totalActiveFilters > 0 && (
            <span className={styles.badge}>{totalActiveFilters}</span>
          )}
          <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
      )}

      {isOpen && createPortal(
        <div ref={dropdownRef} className={styles.dropdown} style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}>
          {canFilterActiveOnly && (
            <label className={styles.topToggle}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={showOnlyActiveProjectsWithoutAllocations}
                onChange={(e) => setShowOnlyActiveProjectsWithoutAllocations(e.target.checked)}
              />
              <span className={styles.topToggleLabel}>{t('projectFilter.activeWithoutAllocations')}</span>
            </label>
          )}
          <div className={styles.columns}>
            {/* PM Column */}
            {availablePMs.length > 0 && (
              <div className={styles.column}>
                <div className={styles.columnHeader}>
                  <span>{t('projectFilter.pmColumn')}</span>
                  {pmFilter.length > 0 && (
                    <span className={styles.columnBadge}>{pmFilter.length}</span>
                  )}
                </div>
                <div className={styles.searchContainer}>
                  <span className={styles.searchIcon}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder={t('common.search')}
                    value={pmSearch}
                    onChange={(e) => setPmSearch(e.target.value)}
                  />
                </div>
                <div className={styles.optionsList}>
                  {filteredPMs.length > 0 ? (
                    filteredPMs.map(pm => {
                      const isSelected = pmFilter.includes(pm.id);
                      return (
                        <div
                          key={pm.id}
                          className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                          onClick={() => togglePm(pm.id)}
                        >
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={isSelected}
                            onChange={() => togglePm(pm.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          {pm.photoUrl ? (
                            <img src={pm.photoUrl} alt={pm.name} className={styles.optionPhoto} />
                          ) : (
                            <div className={styles.optionPhotoPlaceholder}>
                              {pm.name.charAt(0)}
                            </div>
                          )}
                          <span className={styles.optionName}>{pm.name}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div className={styles.noResults}>
                      {pmSearch ? t('common.noResults') : t('projectFilter.noPMsAvailable')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Divider */}
            {availablePMs.length > 0 && availableProjectTypes.length > 0 && (
              <div className={styles.divider} />
            )}

            {/* Project Type Column */}
            {availableProjectTypes.length > 0 && (
              <div className={styles.column}>
                <div className={styles.columnHeader}>
                  <span>{t('projectFilter.typeColumn')}</span>
                  {projectTypeFilter.length > 0 && (
                    <span className={styles.columnBadge}>{projectTypeFilter.length}</span>
                  )}
                </div>
                <div className={styles.searchContainer}>
                  <span className={styles.searchIcon}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder={t('common.search')}
                    value={typeSearch}
                    onChange={(e) => setTypeSearch(e.target.value)}
                  />
                </div>
                <div className={styles.optionsList}>
                  {filteredTypes.length > 0 ? (
                    filteredTypes.map(type => {
                      const isSelected = projectTypeFilter.includes(type.label);
                      return (
                        <div
                          key={type.label}
                          className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                          onClick={() => toggleType(type.label)}
                        >
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={isSelected}
                            onChange={() => toggleType(type.label)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span
                            className={styles.colorDot}
                            style={{ backgroundColor: type.color }}
                          />
                          <span className={styles.optionName}>{type.label}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div className={styles.noResults}>
                      {typeSearch ? t('common.noResults') : t('projectFilter.noTypesAvailable')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer with Clear Button */}
          {hasActiveFilter && (
            <div className={styles.footer} style={{ padding: '8px 12px' }}>
              <button
                className={styles.clearButton}
                onClick={clearAllFilters}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-subtle)',
                  fontSize: 12,
                  fontWeight: 500,
                  padding: '4px 8px',
                  width: 'auto',
                }}
              >
                {t('projectFilter.clear')}
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};
