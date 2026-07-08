import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './SearchableSelect.module.css';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import { computeDropdownPosition } from '../../utils/dropdownAnchor';

const SearchableSelect = ({ options, value, onChange, placeholder, isLoading, disabled, showSearch = true }) => {
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

  // סינון האפשרויות לפי החיפוש (רק אם יש חיפוש)
  const filteredOptions = showSearch
    ? options.filter(option =>
        option.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : options;

  const selectedOption = options.find(o => o.id === value);

  const handleSelect = (option) => {
    onChange(option.id);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {/* הטריגר (הכפתור הראשי) */}
      <div
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
      >
        <span className={`${styles.triggerText} ${!selectedOption ? styles.triggerTextPlaceholder : ''}`}>
          {selectedOption ? selectedOption.name : (isLoading ? t('common.loading') : placeholder)}
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
          {/* שדה החיפוש - רק אם showSearch הוא true */}
          {showSearch && (
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
              </div>
            </div>
          )}

          {/* רשימת האפשרויות */}
          <div className={styles.optionsList}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <div
                  key={option.id}
                  className={`${styles.option} ${value === option.id ? styles.optionSelected : ''} ${option.disabled ? styles.optionDisabled : ''}`}
                  onClick={() => !option.disabled && handleSelect(option)}
                  aria-disabled={!!option.disabled}
                >
                  {option.name}
                  {value === option.id && (
                    <span className={styles.optionIndicator}></span>
                  )}
                </div>
              ))
            ) : (
              <div className={styles.noResults}>
                {showSearch
                  ? t('common.dropdown.noResultsFor', { term: searchTerm })
                  : t('common.dropdown.noOptions')
                }
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;

