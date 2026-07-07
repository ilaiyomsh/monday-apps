import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isSameMonth } from 'date-fns';
import { useLocale } from '../hooks/useLocale';

export default function CustomDatePicker({ selectedDate, onDateSelect, onClose }) {
    const { isLtr, dateFnsLocale } = useLocale();
    const [currentMonth, setCurrentMonth] = useState(selectedDate || new Date());

    // חישוב הימים להצגה (כולל ימים מהחודש הקודם/הבא למילוי השבוע)
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const startDate = startOfWeek(monthStart, { locale: dateFnsLocale });
    const endDate = endOfWeek(monthEnd, { locale: dateFnsLocale });
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    // שמות הימים בשבוע — נגזרים מ-date-fns לפי השפה. width:'narrow' = אות
    // אחת ('א'/'S'). מסדרים לפי startOfWeek של ה-locale (0 = יום ראשון בעברית/אנגלית).
    const weekDays = useMemo(() => {
        const startsOn = dateFnsLocale.options?.weekStartsOn ?? 0;
        return Array.from({ length: 7 }, (_, i) =>
            dateFnsLocale.localize.day((startsOn + i) % 7, { width: 'narrow' })
        );
    }, [dateFnsLocale]);

    const handleDateClick = (day) => {
        onDateSelect(day);
        if (onClose) {
            onClose();
        }
    };

    const handlePrevMonth = () => {
        setCurrentMonth(subMonths(currentMonth, 1));
    };

    const handleNextMonth = () => {
        setCurrentMonth(addMonths(currentMonth, 1));
    };

    return (
        <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            minWidth: '280px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            direction: isLtr ? 'ltr' : 'rtl'
        }}>
            {/* כותרת עם חודש ושנה וכפתורי ניווט */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--color-bg-hover-neutral)'
            }}>
                <button
                    onClick={handlePrevMonth}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '18px',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        color: 'var(--color-text)'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--color-bg-hover-neutral)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                >
                    ‹
                </button>
                
                <div style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--color-text)'
                }}>
                    {format(currentMonth, 'MMMM yyyy', { locale: dateFnsLocale })}
                </div>
                
                <button
                    onClick={handleNextMonth}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '18px',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        color: 'var(--color-text)'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--color-bg-hover-neutral)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                >
                    ›
                </button>
            </div>

            {/* שורת ימי השבוע */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px',
                marginBottom: '8px'
            }}>
                {weekDays.map((day, idx) => (
                    <div
                        key={idx}
                        style={{
                            textAlign: 'center',
                            fontSize: '12px',
                            fontWeight: '600',
                            color: 'var(--color-text-secondary)',
                            padding: '4px'
                        }}
                    >
                        {day}
                    </div>
                ))}
            </div>

            {/* Grid של הימים */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: '4px'
            }}>
                {days.map((day, index) => {
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const isToday = isSameDay(day, new Date());

                    return (
                        <button
                            key={index}
                            onClick={() => handleDateClick(day)}
                            style={{
                                padding: '8px',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                backgroundColor: isSelected ? 'var(--color-primary)' : isToday ? 'var(--color-bg-hover-neutral)' : 'transparent',
                                color: isSelected ? 'var(--color-text-inverse)' : !isCurrentMonth ? 'var(--color-text-disabled-soft)' : 'var(--color-text)',
                                fontWeight: isSelected || isToday ? '600' : '400',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => {
                                if (!isSelected) {
                                    e.target.style.backgroundColor = 'var(--color-bg-hover-neutral)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isSelected) {
                                    e.target.style.backgroundColor = isToday ? 'var(--color-bg-hover-neutral)' : 'transparent';
                                }
                            }}
                        >
                            {format(day, 'd')}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

