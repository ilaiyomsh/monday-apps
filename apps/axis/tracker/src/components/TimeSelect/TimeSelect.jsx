import React, { useEffect, useRef, useState, useCallback } from 'react';
import styles from './TimeSelect.module.css';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import { computeDropdownPosition } from '../../utils/dropdownAnchor';

/**
 * רכיב Dropdown לזמנים
 */
const TimeSelect = ({
    times,
    selectedTime,
    onSelectTime,
    isLoading,
    disabled,
    placeholder
}) => {
    const t = useStableT();
    const { dir } = useLocale();
    const resolvedPlaceholder = placeholder ?? t('common.timeSelect.placeholder');
    const [isOpen, setIsOpen] = useState(false);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 'auto', bottom: 'auto', width: 'auto' });
    const [inputValue, setInputValue] = useState(selectedTime || '');
    const containerRef = useRef(null);
    const dropdownRef = useRef(null);
    const timesListRef = useRef(null);
    const inputRef = useRef(null);

    // חישוב מיקום ה-dropdown
    const calculateDropdownPosition = useCallback(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setDropdownPosition(computeDropdownPosition({
            triggerRect: rect,
            dir,
            width: 100, // רוחב קבוע של 100px
        }));
    }, [dir]);

    useEffect(() => {
        if (isOpen) {
            calculateDropdownPosition();
            
            // גלילה אוטומטית לפריט שנבחר
            if (timesListRef.current && selectedTime) {
                const selectedIndex = times.findIndex(t => t.value === selectedTime || t.label === selectedTime);
                if (selectedIndex !== -1) {
                    // נחכה קצת כדי שה-dropdown יוצג קודם
                    setTimeout(() => {
                        const selectedElement = timesListRef.current.children[selectedIndex];
                        if (selectedElement) {
                            selectedElement.scrollIntoView({ block: 'start', behavior: 'auto' });
                        }
                    }, 0);
                }
            }
            
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
    }, [isOpen, selectedTime, times, calculateDropdownPosition]);

    // עדכון inputValue כש-selectedTime משתנה מבחוץ
    useEffect(() => {
        setInputValue(selectedTime || '');
    }, [selectedTime]);

    // סגירת הדרופדאון בלחיצה מחוץ לרכיב
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // פונקציה לבדיקת תקינות ועגול ל-30 דקות
    const validateAndRoundTime = (value) => {
        if (!value || value.trim() === '') return null;
        
        // בדיקה שהפורמט תקין (HH:mm או H:mm)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
        if (!timeRegex.test(value)) return null;
        
        const [hours, minutes] = value.split(':').map(Number);
        
        // עיגול ל-15 דקות הקרוב
        const roundedMinutes = Math.round(minutes / 15) * 15;
        let roundedHours = hours;
        let finalMinutes = roundedMinutes;
        
        if (roundedMinutes === 60) {
            roundedHours = (hours + 1) % 24;
            finalMinutes = 0;
        }
        
        const roundedTime = `${roundedHours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}`;
        
        // בדיקה שהזמן נמצא ברשימת הזמנים הזמינים
        const isValidTime = times.some(t => t.value === roundedTime || t.label === roundedTime);
        return isValidTime ? roundedTime : null;
    };

    const handleSelect = (timeValue) => {
        onSelectTime(timeValue);
        setInputValue(timeValue);
        setIsOpen(false);
    };

    const handleInputChange = (e) => {
        const value = e.target.value;
        let newValue = value;
        
        // אם המשתמש הקליד 2 ספרות ללא נקודתיים, מוסיפים נקודתיים ומעבירים פוקוס
        if (value.length === 2 && !value.includes(':')) {
            newValue = value + ':';
            setInputValue(newValue);
            // מעבר אוטומטי לחלק הדקות (לאחר ה-:)
            setTimeout(() => {
                if (inputRef.current) {
                    const cursorPosition = 3; // מיקום אחרי ה-:
                    inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
                }
            }, 0);
        } else {
            setInputValue(newValue);
        }
        
        // אם הערך תקין, מעדכן מיד
        const validated = validateAndRoundTime(newValue);
        if (validated) {
            onSelectTime(validated);
        }
    };

    const handleInputBlur = (e) => {
        // בדיקה אם הלחיצה הייתה על פריט ב-dropdown
        // אם כן, לא נסגור את ה-dropdown (ה-blur יתבצע אבל הבחירה כבר תתבצע)
        if (dropdownRef.current && dropdownRef.current.contains(e.relatedTarget)) {
            return;
        }
        
        // בעת איבוד פוקוס, מאמת ומעגל
        const validated = validateAndRoundTime(e.target.value);
        if (validated) {
            setInputValue(validated);
            onSelectTime(validated);
        } else if (e.target.value) {
            // אם הערך לא תקין, מחזיר לערך הקודם
            setInputValue(selectedTime || '');
        }
        
        // נשתמש ב-setTimeout כדי לאפשר ל-click event להתבצע קודם
        setTimeout(() => {
            setIsOpen(false);
        }, 200);
    };

    const handleInputFocus = () => {
        if (!disabled && !isLoading) {
            setIsOpen(true);
        }
    };

    const handleIconClick = (e) => {
        e.stopPropagation();
        if (!disabled && !isLoading) {
            if (inputRef.current) {
                inputRef.current.focus();
            }
            setIsOpen(!isOpen);
        }
    };

    return (
        <div className={styles.container} ref={containerRef}>
            {/* הטריגר - Input עם Dropdown */}
            <div className={`${styles.trigger} ${disabled ? styles.disabled : ''}`}>
                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleInputBlur}
                    onFocus={handleInputFocus}
                    placeholder={isLoading ? t('common.loading') : resolvedPlaceholder}
                    disabled={disabled || isLoading}
                    className={styles.input}
                    maxLength={5}
                />
                <div 
                    className={styles.triggerIcon}
                    onClick={handleIconClick}
                >
                    {isLoading ? "⏳" : (isOpen ? "▲" : "▼")}
                </div>
            </div>

            {/* הרשימה הנפתחת */}
            {isOpen && !disabled && (
                <div
                    ref={dropdownRef}
                    className={styles.dropdown}
                    style={dropdownPosition}
                >
                    {/* רשימת זמנים */}
                    <div className={styles.timesList} ref={timesListRef}>
                        {times.length > 0 ? (
                            times.map((time) => {
                                const isSelected = selectedTime === time.value || selectedTime === time.label;
                                return (
                                    <div
                                        key={time.value || time.label}
                                        className={`${styles.timeItem} ${isSelected ? styles.selected : ''}`}
                                        onMouseDown={(e) => {
                                            e.preventDefault(); // מונע את ה-blur event של ה-input
                                            handleSelect(time.value || time.label);
                                        }}
                                    >
                                        {time.label || time.value}
                                    </div>
                                );
                            })
                        ) : (
                            <div className={styles.emptyState}>
                                {t('common.timeSelect.noTimes')}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimeSelect;

