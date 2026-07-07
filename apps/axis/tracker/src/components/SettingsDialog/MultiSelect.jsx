import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './SearchableSelect.module.css';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import { computeDropdownPosition } from '../../utils/dropdownAnchor';

const MultiSelect = ({ options, value = [], onChange, placeholder, isLoading, disabled }) => {
  const t = useStableT();
  const { dir } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState({ top: 'auto', bottom: 'auto' });
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  // חישוב מיקום ה-dropdown
  const calculateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPosition(computeDropdownPosition({ triggerRect: rect, dir }));
  }, [dir]);

  useEffect(() => {
    if (isOpen) {
      calculateDropdownPosition();

      // עדכון מיקום בעת גלילה או שינוי גודל
      const handleScroll = () => {
        calculateDropdownPosition();
      };

      const handleResize = () => {
        calculateDropdownPosition();
      };

      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [isOpen, calculateDropdownPosition]);

  // סגירת הדרופדאון בלחיצה מחוץ לרכיב
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // סינון האפשרויות לפי החיפוש
  const filteredOptions = options.filter(option =>
    option.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedOptions = options.filter(o => value.includes(o.id));

  const handleSelect = (optionId) => {
    const newValue = value.includes(optionId)
      ? value.filter(id => id !== optionId) // הסרה
      : [...value, optionId]; // הוספה
    onChange(newValue);
  };

  const getDisplayText = () => {
    if (selectedOptions.length === 0) {
      return isLoading ? t('common.loading') : placeholder;
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0].name;
    }
    return t('common.multiselect.selectedCount', { count: selectedOptions.length });
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {/* הטריגר (הכפתור הראשי) */}
      <div
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
      >
        <span className={`${styles.triggerText} ${selectedOptions.length === 0 ? styles.triggerTextPlaceholder : ''}`}>
          {getDisplayText()}
        </span>
        <div className={styles.triggerIcon}>
          {isLoading ? "⏳" : (isOpen ? "▲" : "▼")}
        </div>
      </div>

      {/* הרשימה הנפתחת */}
      {isOpen && !disabled && containerRef.current && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          style={{
            position: 'fixed',
            ...dropdownPosition,
          }}
        >
          {/* שדה החיפוש */}
          <div className={styles.searchContainer}>
            <div className={styles.searchWrapper}>
              <input
                autoFocus
                type="text"
                className={styles.searchInput}
                placeholder={t('common.dropdown.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className={styles.searchIcon}>
                🔍
              </div>
            </div>
          </div>

          {/* רשימת האפשרויות */}
          <div className={styles.optionsList}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = value.includes(option.id);
                return (
                  <div
                    key={option.id}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                    onClick={() => handleSelect(option.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleSelect(option.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginInline: '8px' }}
                    />
                    {option.name}
                    {isSelected && (
                      <span className={styles.optionIndicator}></span>
                    )}
                  </div>
                );
              })
            ) : (
              <div className={styles.noResults}>
                {t('common.dropdown.noResultsFor', { term: searchTerm })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelect;

