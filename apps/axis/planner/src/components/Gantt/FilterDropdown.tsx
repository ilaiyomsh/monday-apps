import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGantt } from '../../hooks/useGantt';
import { useLocale } from '../../hooks/useLocale';
import type { TimeframeOption, UtilizationColor } from './GanttContext';
import styles from './ProjectFilterDropdown.module.css';

const DROPDOWN_WIDTH = 260;
const VIEWPORT_PADDING = 8;

const TIMEFRAME_VALUES: { value: TimeframeOption; key: string }[] = [
  { value: 'ending_this_week', key: 'filter.timeframe.endingThisWeek' },
  { value: 'ending_this_month', key: 'filter.timeframe.endingThisMonth' },
];

const UTILIZATION_VALUES: { value: UtilizationColor; key: string; color: string }[] = [
  { value: 'red', key: 'filter.utilization.red', color: 'var(--color-danger)' },
  { value: 'yellow', key: 'filter.utilization.yellow', color: 'var(--color-warning)' },
  { value: 'blue', key: 'filter.utilization.blue', color: 'var(--color-info)' },
  { value: 'green', key: 'filter.utilization.green', color: 'var(--color-success)' },
];

export const FilterDropdown: React.FC = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const {
    timeframeFilter, setTimeframeFilter,
    utilizationFilter, setUtilizationFilter,
    hidePastAllocations, setHidePastAllocations,
  } = useGantt();

  // Rule 3: the toggle is now a pure show/hide checkbox — past data is always
  // loaded in the background, so there's no fetch to spin on here. Past-fetch
  // progress / error now lives on the load circles (LoadCell skeleton + retry).

  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Anchor under the trigger's start edge (right in RTL, left in LTR), then clamp
  // so the panel stays within the viewport horizontally.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const desiredLeft = locale.isRtl ? rect.right - DROPDOWN_WIDTH : rect.left;
    const maxLeft = window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_PADDING;
    const clampedLeft = Math.max(VIEWPORT_PADDING, Math.min(desiredLeft, maxLeft));
    setDropdownPos({ top: rect.bottom + 4, left: clampedLeft });
  }, [locale.isRtl]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, updatePosition]);

  const activeFiltersCount =
    (timeframeFilter.length > 0 ? 1 : 0) +
    (utilizationFilter.length > 0 ? 1 : 0) +
    (hidePastAllocations ? 1 : 0);
  const hasActiveFilter = activeFiltersCount > 0;

  const clearFilters = () => {
    setTimeframeFilter([]);
    setUtilizationFilter([]);
    setHidePastAllocations(false);
  };

  const toggleTimeframe = (value: TimeframeOption) => {
    setTimeframeFilter(
      timeframeFilter.includes(value)
        ? timeframeFilter.filter(v => v !== value)
        : [...timeframeFilter, value]
    );
  };

  const toggleUtilization = (color: UtilizationColor) => {
    setUtilizationFilter(
      utilizationFilter.includes(color)
        ? utilizationFilter.filter(c => c !== color)
        : [...utilizationFilter, color]
    );
  };

  const triggerClasses = [
    styles.trigger,
    hasActiveFilter ? styles.triggerActive : '',
    isOpen ? styles.triggerOpen : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.filterContainer}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={triggerClasses}
      >
        <span className={styles.filterIcon}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </span>
        <span className={styles.triggerText}>{t('filter.button')}</span>
        {activeFiltersCount > 0 && (
          <span className={styles.badge}>{activeFiltersCount}</span>
        )}
        <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          data-testid="filter-dropdown-popover"
          dir={locale.dir}
          style={{ position: 'fixed', width: DROPDOWN_WIDTH, top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className={styles.column}>
            {/* Timeframe Section */}
            <div className={styles.columnHeader}>
              <span>{t('filter.timeframe.label')}</span>
              {timeframeFilter.length > 0 && (
                <span className={styles.columnBadge}>{timeframeFilter.length}</span>
              )}
            </div>
            <div className={styles.optionsList}>
              {TIMEFRAME_VALUES.map(opt => {
                const isSelected = timeframeFilter.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                    onClick={() => toggleTimeframe(opt.value)}
                  >
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isSelected}
                      onChange={() => toggleTimeframe(opt.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className={styles.optionName}>{t(opt.key)}</span>
                  </div>
                );
              })}
            </div>

            {/* Utilization Section */}
            <div className={styles.columnHeader}>
              <span>{t('filter.utilization.label')}</span>
              {utilizationFilter.length > 0 && (
                <span className={styles.columnBadge}>{utilizationFilter.length}</span>
              )}
            </div>
            <div className={styles.optionsList}>
              {UTILIZATION_VALUES.map(opt => {
                const isSelected = utilizationFilter.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                    onClick={() => toggleUtilization(opt.value)}
                  >
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isSelected}
                      onChange={() => toggleUtilization(opt.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span
                      className={styles.colorDot}
                      style={{ backgroundColor: opt.color }}
                    />
                    <span className={styles.optionName}>{t(opt.key)}</span>
                  </div>
                );
              })}
            </div>

            {/* Hide past allocations */}
            <div className={styles.optionsList} style={{ borderTop: '1px solid var(--color-border-faint)' }}>
              <div
                className={`${styles.option} ${hidePastAllocations ? styles.optionSelected : ''}`}
                onClick={() => setHidePastAllocations(!hidePastAllocations)}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={hidePastAllocations}
                  onChange={(e) => setHidePastAllocations(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className={styles.optionName}>{t('filter.hidePast')}</span>
              </div>
            </div>
          </div>

          {hasActiveFilter && (
            <div className={styles.footer} style={{ padding: '8px 12px' }}>
              <button
                className={`${styles.clearButton} text-xs font-medium`}
                onClick={clearFilters}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-subtle)',
                  padding: '4px 8px',
                  width: 'auto',
                }}
              >
                {t('filter.clear')}
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};
