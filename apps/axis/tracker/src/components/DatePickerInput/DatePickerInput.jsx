import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { format, startOfDay } from 'date-fns';
import { useLocale } from '../../hooks/useLocale';
import { useStableT } from '../../i18n/useStableT';
import { DatePicker } from '@vibe/core/next';
import { LayerProvider } from '@vibe/core';
import { computePortalAnchor } from '../../utils/dropdownAnchor';
import logger from '../../utils/logger';
import styles from './DatePickerInput.module.css';

const POPUP_HEIGHT = 340;

const CalendarIcon = () => (
    <svg className={styles.calendarIcon} viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1V3a1 1 0 1 0-2 0v1H7V3a1 1 0 0 0-1-1zM4 8h12v8H4V8z" />
    </svg>
);

const DatePickerInput = ({ label, date, onDateChange }) => {
    const { dateFnsLocale, dir } = useLocale();
    const t = useStableT();
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0 });
    const triggerRef = useRef(null);
    const popupRef = useRef(null);
    const layerRef = useRef(null);

    const updatePosition = useCallback(() => {
        if (!triggerRef.current) return;
        setPosition(computePortalAnchor({
            triggerRect: triggerRef.current.getBoundingClientRect(),
            dir,
            popupHeight: POPUP_HEIGHT,
        }));
    }, [dir]);

    // מיקום ראשוני + עדכון בגלילה/שינוי גודל
    useEffect(() => {
        if (!isOpen) return;
        updatePosition();

        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();

        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [isOpen, updatePosition]);

    // סגירה בלחיצה מחוץ לאזור
    useEffect(() => {
        if (!isOpen) return;

        const handleMouseDown = (e) => {
            try {
                const target = e.target;
                if (triggerRef.current?.contains(target)) return;
                if (popupRef.current?.contains(target)) return;
                // אלמנטים של דרופדאונים של Vibe
                if (target.closest?.('.monday-style-dialog-content-wrapper')) return;
                if (target.closest?.('.monday-style-menu-dialog-container')) return;
                if (target.closest?.('[data-testid="datepicker-popup-container"]')) return;
                setIsOpen(false);
            } catch (error) {
                logger.error('DatePickerInput', 'outside-click handler failed', error);
            }
        };

        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [isOpen]);

    // MutationObserver לתיקון מיקום דרופדאונים של חודש/שנה
    useEffect(() => {
        if (!isOpen || !layerRef.current) return;

        const observer = new MutationObserver(() => {
            try {
                const container = layerRef.current;
                if (!container) return;

                const dialogs = container.querySelectorAll('.monday-style-dialog-content-wrapper');
                dialogs.forEach((dialog) => {
                    const activeTrigger = container.querySelector('[aria-expanded="true"]');
                    if (!activeTrigger) return;

                    const containerRect = container.getBoundingClientRect();
                    const triggerRect = activeTrigger.getBoundingClientRect();

                    const relativeTop = triggerRect.bottom - containerRect.top;
                    const baseStyle = {
                        position: 'absolute',
                        transform: 'none',
                        inset: 'auto',
                        top: `${relativeTop}px`,
                        bottom: 'auto',
                        zIndex: '100001',
                    };
                    if (dir === 'rtl') {
                        const relativeRight = containerRect.right - triggerRect.right;
                        Object.assign(dialog.style, baseStyle, {
                            right: `${relativeRight}px`,
                            left: 'auto',
                        });
                    } else {
                        const relativeLeft = triggerRect.left - containerRect.left;
                        Object.assign(dialog.style, baseStyle, {
                            left: `${relativeLeft}px`,
                            right: 'auto',
                        });
                    }
                });
            } catch (error) {
                logger.error('DatePickerInput', 'MutationObserver positioning failed', error);
            }
        });

        observer.observe(layerRef.current, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [isOpen, dir]);

    const handleDateSelect = useCallback((newDate) => {
        onDateChange(newDate);
        setIsOpen(false);
    }, [onDateChange]);

    const handleTodayClick = useCallback(() => {
        onDateChange(startOfDay(new Date()));
        setIsOpen(false);
    }, [onDateChange]);

    const formattedDate = date ? format(date, 'd MMM yyyy', { locale: dateFnsLocale }) : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
                onClick={() => setIsOpen((prev) => !prev)}
            >
                <CalendarIcon />
                <span className={styles.triggerLabel}>{label}</span>
                {formattedDate
                    ? <span className={styles.triggerDate}>{formattedDate}</span>
                    : <span className={styles.triggerPlaceholder}>{t('common.datePicker.placeholder')}</span>
                }
            </button>

            {isOpen && createPortal(
                <div
                    ref={popupRef}
                    className={styles.popup}
                    style={position}
                >
                    <div ref={layerRef} className={styles.layerContainer}>
                        <LayerProvider layerRef={layerRef}>
                            <DatePicker
                                date={date}
                                onDateChange={handleDateSelect}
                                locale={dateFnsLocale}
                            />
                        </LayerProvider>
                    </div>
                    <button
                        type="button"
                        className={styles.todayBtn}
                        onClick={handleTodayClick}
                    >
                        {t('common.datePicker.today')}
                    </button>
                </div>,
                document.body
            )}
        </>
    );
};

export default DatePickerInput;
